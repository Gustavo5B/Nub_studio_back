// =========================================================
// DURACIÓN DE LA SESIÓN SEGÚN EL ROL
// El cliente solo compra y guarda favoritos: con 7 días no tiene que iniciar sesión cada
// día en la app. Artistas y administradores manejan obras, ventas y datos de otras
// personas, así que su sesión sigue durando 24 horas.
// La sesión se puede cortar antes desde el servidor (cerrar sesión, cerrar otras sesiones,
// cambiar la contraseña o eliminar la cuenta) porque cada una vive en sesiones_activas.
// =========================================================
const DURACION_POR_ROL = {
  cliente: '7d',
};

const DURACION_POR_DEFECTO = '24h';

/** Valor para `expiresIn` de jsonwebtoken. Sin rol se usa la duración corta. */
export const duracionSesion = (rol) => DURACION_POR_ROL[rol] ?? DURACION_POR_DEFECTO;
