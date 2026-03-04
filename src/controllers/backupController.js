import { pool } from "../config/db.js";
import logger from "../config/logger.js";

// =========================================================
// ORDEN DE TABLAS — respeta foreign keys
// Las tablas sin dependencias van primero
// =========================================================
const TABLAS_ORDEN = [
  // — Sin dependencias —
  "estados_mexico",
  "municipios",
  "categorias",
  "tecnicas",
  "etiquetas",
  "tipos_marco",
  "tipos_certificado",
  "paqueterias",
  "tamaños_disponibles",
  "configuracion_sistema",
  "preguntas_frecuentes",

  // — Usuarios base —
  "usuarios",
  "sesiones_activas",
  "historial_login",
  "codigos_recuperacion",
  "codigos_2fa_email",
  "direcciones",
  "metodos_pago",

  // — Artistas —
  "artistas",
  "artistas_datos_bancarios",
  "artistas_metodos_envio",
  "artistas_portafolio",
  "artistas_redes_sociales",
  "artistas_zonas_envio",

  // — Obras —
  "obras",
  "imagenes_obras",
  "obras_etiquetas",
  "obras_marcos",
  "obras_tamaños",
  "historial_cambios_obras",
  "inventario",

  // — Certificados —
  "certificados_autenticidad",
  "certificados_fotos_detalle",
  "certificados_historial",

  // — Blog —
  "blog_posts",
  "blog_etiquetas",
  "blog_imagenes",
  "blog_posts_etiquetas",

  // — Ventas y comercio —
  "carritos",
  "ventas",
  "comisiones",
  "conversaciones_venta",
  "favoritos",
  "testimonios",

  // — Soporte y mensajería —
  "mensajes",
  "mensajes_adjuntos",
  "tickets_soporte",
];

// =========================================================
// HELPERS
// =========================================================

/**
 * Escapa un valor para SQL:
 *   null       → NULL
 *   boolean    → TRUE / FALSE
 *   number     → número tal cual
 *   Date       → 'YYYY-MM-DD HH:MM:SS'
 *   string     → 'texto con comillas escapadas'
 *   object     → 'JSON escapado'
 */
const escaparValor = (val) => {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean")  return val ? "TRUE" : "FALSE";
  if (typeof val === "number")   return val;
  if (val instanceof Date)       return `'${val.toISOString().replace("T", " ").replace("Z", "")}'`;
  if (typeof val === "object")   return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
};

/**
 * Genera el bloque INSERT para una tabla.
 * Si no hay filas devuelve un comentario vacío.
 */
const generarInserts = (tabla, filas) => {
  if (!filas || filas.length === 0) {
    return `-- (sin datos en ${tabla})\n`;
  }

  const columnas = Object.keys(filas[0]);
  const colStr   = columnas.map((c) => `"${c}"`).join(", ");

  const valores = filas
    .map((fila) => {
      const vals = columnas.map((col) => escaparValor(fila[col])).join(", ");
      return `  (${vals})`;
    })
    .join(",\n");

  return (
    `INSERT INTO "${tabla}" (${colStr}) VALUES\n` +
    `${valores}\n` +
    `ON CONFLICT DO NOTHING;\n`
  );
};

/**
 * Obtiene el valor máximo de la secuencia de una tabla
 * para resetear el serial/sequence después del restore.
 */
const generarResetSequence = async (tabla) => {
  try {
    // Detectar columnas serial/bigserial
    const res = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = $1
         AND column_default LIKE 'nextval%'
       LIMIT 1`,
      [tabla]
    );
    if (res.rows.length === 0) return "";

    const col      = res.rows[0].column_name;
    const seqRes   = await pool.query(
      `SELECT pg_get_serial_sequence('public."${tabla}"', '${col}') AS seq`
    );
    const seqName  = seqRes.rows[0]?.seq;
    if (!seqName) return "";

    return `SELECT setval('${seqName}', COALESCE((SELECT MAX("${col}") FROM "${tabla}"), 1));\n`;
  } catch {
    return "";
  }
};

// =========================================================
// GENERAR RESPALDO COMPLETO
// GET /api/admin/backup
// Solo admins
// =========================================================
export const generarBackup = async (req, res) => {
  const inicio = Date.now();
  logger.info(`[backup] Iniciado por admin=${req.user?.id_usuario}`);

  try {
    const ahora     = new Date();
    const fechaStr  = ahora.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName  = `nub-studio-backup-${fechaStr}.sql`;

    // ── Cabecera del archivo ────────────────────────────
    let sql = "";
    sql += `-- =============================================\n`;
    sql += `-- Nu-B Studio — Respaldo de base de datos\n`;
    sql += `-- Fecha:   ${ahora.toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}\n`;
    sql += `-- Tablas:  ${TABLAS_ORDEN.length}\n`;
    sql += `-- Admin:   ${req.user?.id_usuario}\n`;
    sql += `-- =============================================\n\n`;
    sql += `SET client_encoding = 'UTF8';\n`;
    sql += `SET standard_conforming_strings = on;\n\n`;

    let totalFilas = 0;

    // ── Procesar cada tabla en orden ────────────────────
    for (const tabla of TABLAS_ORDEN) {
      try {
        // Verificar que la tabla existe
        const existe = await pool.query(
          `SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
          [tabla]
        );
        if (existe.rows.length === 0) {
          sql += `-- TABLA "${tabla}" no encontrada — omitida\n\n`;
          continue;
        }

        const result = await pool.query(`SELECT * FROM "${tabla}" ORDER BY 1`);
        const filas  = result.rows;
        totalFilas  += filas.length;

        sql += `-- ---------------------------------------------\n`;
        sql += `-- Tabla: ${tabla} (${filas.length} filas)\n`;
        sql += `-- ---------------------------------------------\n`;
        sql += generarInserts(tabla, filas);

        const resetSeq = await generarResetSequence(tabla);
        if (resetSeq) sql += resetSeq;

        sql += `\n`;
      } catch (tablaErr) {
        logger.warn(`[backup] Error en tabla "${tabla}": ${tablaErr.message}`);
        sql += `-- ERROR al exportar tabla "${tabla}": ${tablaErr.message}\n\n`;
      }
    }

    // ── Pie del archivo ─────────────────────────────────
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    sql += `-- =============================================\n`;
    sql += `-- Respaldo completado\n`;
    sql += `-- Total filas: ${totalFilas}\n`;
    sql += `-- Duración:    ${duracion}s\n`;
    sql += `-- =============================================\n`;

    logger.info(`[backup] Completado — ${totalFilas} filas, ${duracion}s, admin=${req.user?.id_usuario}`);

    // ── Enviar como descarga ────────────────────────────
    res.setHeader("Content-Type", "application/sql");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", Buffer.byteLength(sql, "utf8"));
    res.send(sql);

  } catch (error) {
    logger.error(`[backup] Error crítico: ${error.message} | ${error.stack}`);
    res.status(500).json({ success: false, message: "Error al generar el respaldo" });
  }
};