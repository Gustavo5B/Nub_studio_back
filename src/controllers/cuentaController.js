// =========================================================
// CUENTA DEL CLIENTE — Derecho ARCO de Cancelación
// DELETE /api/auth/cuenta   (requisito de Google Play)
//
// No borra la fila de usuarios: muchas tablas la referencian (pedidos,
// ventas, comentarios). En su lugar ANONIMIZA la cuenta:
//   - nombre, correo, teléfono y secretos se reemplazan o se vacían;
//   - la contraseña se invalida y se cierran todas las sesiones;
//   - se borran favoritos, carrito y reacciones;
//   - las direcciones sin pedidos se borran; las usadas en pedidos se
//     marcan como eliminadas (se conservan como registro de la venta).
// Las ventas y pedidos se conservan porque son registros contables.
// Si hay una venta en curso (pagada, en proceso o enviada) no se permite
// borrar hasta que termine o se cancele.
// =========================================================
import bcrypt from "bcrypt";
import { pool } from "../config/db.js";
import logger from "../config/logger.js";

const VENTAS_EN_CURSO = ["pagado", "procesando", "enviado"];

export const eliminarMiCuenta = async (req, res) => {
  const idUsuario = req.user?.id_usuario;
  const { contrasena } = req.body ?? {};

  if (!idUsuario) return res.status(401).json({ message: "No autenticado" });
  if (req.user.rol !== "cliente") {
    return res.status(403).json({
      message:
        "Las cuentas de artista y administrador se dan de baja desde soporte. Escríbenos para ayudarte.",
    });
  }
  if (!contrasena || typeof contrasena !== "string") {
    return res.status(400).json({ message: "Escribe tu contraseña para confirmar" });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT id_usuario, "contraseña_hash", eliminado FROM usuarios WHERE id_usuario = $1',
      [idUsuario],
    );
    const usuario = rows[0];
    if (!usuario || usuario.eliminado) {
      return res.status(404).json({ message: "La cuenta ya no existe" });
    }

    const coincide = usuario.contraseña_hash
      ? await bcrypt.compare(contrasena, usuario.contraseña_hash)
      : false;
    if (!coincide) {
      return res.status(401).json({ message: "La contraseña no es correcta" });
    }

    const enCurso = await client.query(
      "SELECT COUNT(*)::int AS total FROM ventas WHERE id_cliente = $1 AND estado::text = ANY($2)",
      [idUsuario, VENTAS_EN_CURSO],
    );
    if (enCurso.rows[0].total > 0) {
      return res.status(409).json({
        message:
          "Tienes un pedido en camino. Podrás eliminar tu cuenta cuando se entregue o se cancele.",
      });
    }

    await client.query("BEGIN");

    await client.query("DELETE FROM favoritos WHERE id_usuario = $1", [idUsuario]);
    await client.query("DELETE FROM carritos WHERE id_usuario = $1", [idUsuario]);
    await client.query("DELETE FROM blog_reacciones WHERE id_usuario = $1", [idUsuario]);

    // Direcciones: se borran las que no aparecen en ningún pedido o venta;
    // las demás quedan marcadas como eliminadas.
    await client.query(
      `DELETE FROM direcciones d
        WHERE d.id_usuario = $1
          AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.id_direccion_envio = d.id_direccion)
          AND NOT EXISTS (SELECT 1 FROM ventas v WHERE v.id_direccion_envio = d.id_direccion)`,
      [idUsuario],
    );
    await client.query(
      `UPDATE direcciones
          SET activa = FALSE, es_principal = FALSE, eliminada = TRUE,
              fecha_eliminacion = NOW(), fecha_actualizacion = NOW()
        WHERE id_usuario = $1`,
      [idUsuario],
    );

    await client.query(
      `UPDATE usuarios
          SET nombre_completo = 'Usuario eliminado',
              correo = 'eliminado-' || id_usuario || '@nubstudio.invalid',
              "contraseña_hash" = NULL,
              telefono = NULL,
              token_verificacion = NULL,
              token_recuperacion = NULL,
              token_expiracion = NULL,
              secret_2fa = NULL,
              requiere_2fa = FALSE,
              metodo_2fa = 'NINGUNO',
              activo = FALSE,
              estado = 'eliminado',
              eliminado = TRUE,
              fecha_eliminacion = NOW(),
              eliminado_por = id_usuario,
              fecha_actualizacion = NOW()
        WHERE id_usuario = $1`,
      [idUsuario],
    );

    // Cierra todas las sesiones, incluida la actual.
    await client.query("DELETE FROM sesiones_activas WHERE id_usuario = $1", [idUsuario]);

    await client.query("COMMIT");
    logger.info(`Cuenta eliminada (anonimizada): usuario ${idUsuario}`);
    return res.json({ message: "Tu cuenta se eliminó correctamente" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error(`Error en eliminarMiCuenta: ${error.message}`);
    return res.status(500).json({ message: "No se pudo eliminar la cuenta. Intenta más tarde." });
  } finally {
    client.release();
  }
};
