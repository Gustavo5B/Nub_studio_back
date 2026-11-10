// =========================================================
// CAMPOS DE CONTRASEÑA
// Los filtros de SQL injection y XSS no los revisan y nunca se escriben en el log.
// Una contraseña solo se compara o se guarda con bcrypt y siempre va a consultas con
// parámetros ($1, $2...), nunca dentro del texto SQL ni del HTML. Por eso puede llevar
// cualquier símbolo (#, --, /*) o palabras como "Delete" sin ningún riesgo.
// =========================================================
export const CAMPOS_CONTRASENA = new Set([
  'contrasena',      // registro, login y eliminar cuenta
  'password',        // registro de artista, login y activar cuenta
  'nuevaContrasena', // recuperar contraseña
  'nueva_password',  // validador de restablecer contraseña
]);

export const esCampoContrasena = (campo) => CAMPOS_CONTRASENA.has(campo);
