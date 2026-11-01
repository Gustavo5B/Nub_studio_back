// =========================================================
// REPORTAR UN COMENTARIO DEL BLOG
// POST /api/blog/comentarios/:id/reportar   (cliente o artista)
//
// Google Play pide que las apps con contenido de usuarios permitan
// reportar el contenido ofensivo. Al reportar, el comentario vuelve a
// estado 'pendiente': deja de mostrarse y entra a la cola de moderación
// que el administrador ya revisa en la web (aprobar o rechazar).
// No se puede reportar un comentario propio.
// =========================================================
import { pool } from "../config/db.js";
import logger from "../config/logger.js";

export const reportarComentario = async (req, res) => {
  const idUsuario = req.user?.id_usuario;
  const idComentario = Number(req.params.id);

  if (!idUsuario) return res.status(401).json({ success: false, message: "No autenticado" });
  if (!Number.isInteger(idComentario) || idComentario <= 0) {
    return res.status(400).json({ success: false, message: "Comentario no válido" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id_comentario, id_usuario, estado FROM blog_comentarios WHERE id_comentario = $1 AND eliminado = false LIMIT 1",
      [idComentario],
    );
    const comentario = rows[0];
    if (!comentario) {
      return res.status(404).json({ success: false, message: "Comentario no encontrado" });
    }
    if (comentario.id_usuario === idUsuario) {
      return res
        .status(400)
        .json({ success: false, message: "No puedes reportar tu propio comentario" });
    }

    // Si ya estaba en revisión (o rechazado) no se cambia nada.
    if (comentario.estado === "aprobado") {
      await pool.query(
        "UPDATE blog_comentarios SET estado = 'pendiente' WHERE id_comentario = $1 AND estado = 'aprobado'",
        [idComentario],
      );
    }

    logger.info(`Comentario ${idComentario} reportado por usuario ${idUsuario}; queda en revisión`);
    return res.json({
      success: true,
      message: "Gracias. Ocultamos el comentario mientras lo revisamos.",
    });
  } catch (error) {
    logger.error(`Error reportarComentario ${req.params.id}: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "No se pudo enviar el reporte. Intenta más tarde." });
  }
};
