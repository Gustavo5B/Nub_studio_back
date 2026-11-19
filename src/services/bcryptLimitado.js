import bcrypt from 'bcrypt';

// =========================================================
// BCRYPT CON LÍMITE DE CONCURRENCIA (plan de mejora del rendimiento, #158 de la app móvil)
// bcrypt.compare y bcrypt.hash corren en el "threadpool" de Node (libuv), que por defecto
// tiene solo 4 hilos. Ese mismo threadpool lo usan dns.lookup y crypto.pbkdf2, que son los
// pasos para abrir una conexión nueva a PostgreSQL (buscar el host y la autenticación SCRAM).
// Con 50 logins a la vez, los 4 hilos se llenan de bcrypt y abrir una conexión espera más de
// 5 s en la fila; el pool corta a los 10 s y fallan también catálogo y pedidos.
// Aquí solo se deja usar a bcrypt una parte de los hilos; el resto espera en una fila de
// JavaScript, así siempre queda un hilo libre para abrir conexiones. La seguridad no cambia:
// el costo de bcrypt (12) es el mismo, solo se ordena el turno.
// =========================================================

const HILOS = Number.parseInt(process.env.UV_THREADPOOL_SIZE, 10) || 4;

// Siempre se dejan 2 hilos libres (mínimo 1 para bcrypt).
export const MAXIMO_BCRYPT = Math.max(1, HILOS - 2);

// Devuelve una función que corre tareas asíncronas con, como máximo, `maximo` a la vez.
// Las demás esperan su turno en el orden en que llegaron.
export const crearLimitador = (maximo) => {
  let activas = 0;
  const fila = [];

  // Al terminar, el lugar pasa directo al primero de la fila (sin bajar el contador), para
  // que nadie que llegue en ese instante se lo gane y se pase del máximo.
  const liberar = () => {
    const turno = fila.shift();
    if (turno) turno();
    else activas--;
  };

  return async (tarea) => {
    if (activas >= maximo) await new Promise((turno) => fila.push(turno));
    else activas++;
    try {
      return await tarea();
    } finally {
      liberar();
    }
  };
};

const limitar = crearLimitador(MAXIMO_BCRYPT);

// Misma forma que el paquete bcrypt para cambiar solo el import en los controladores.
export default {
  compare: (texto, hash) => limitar(() => bcrypt.compare(texto, hash)),
  hash: (texto, rondas) => limitar(() => bcrypt.hash(texto, rondas)),
};
