// src/controllers/reportesController.js
import { pool } from "../config/db.js";
import logger   from "../config/logger.js";
import ExcelJS  from "exceljs";

// ─── helper: estilo encabezado Excel ─────────────────────────────────────────
function applyHeaderStyle(ws, hex = "FF840E") {
  const row = ws.getRow(1);
  row.height = 22;
  row.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex.replace("#", "")}` } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
  });
}

// =========================================================
// KPIs
// =========================================================
export const getKPIs = async (req, res) => {
  try {
    const [ingresos, vendidas, ticket, comPend, artActivos, obrasActivas] =
      await Promise.all([
        pool.query(`SELECT COALESCE(SUM(total), 0)::numeric AS valor FROM ventas WHERE estado != 'cancelado'`),
        pool.query(`SELECT COUNT(*)::int AS valor FROM ventas WHERE estado != 'cancelado'`),
        pool.query(`SELECT COALESCE(AVG(total), 0)::numeric AS valor FROM ventas WHERE estado != 'cancelado'`),
        pool.query(`SELECT COALESCE(SUM(monto_comision), 0)::numeric AS valor FROM comisiones WHERE estado = 'pendiente'`),
        pool.query(`SELECT COUNT(*)::int AS valor FROM artistas WHERE activo = TRUE AND eliminado IS NOT TRUE`),
        pool.query(`SELECT COUNT(*)::int AS valor FROM obras WHERE estado = 'publicada' AND activa = TRUE AND eliminada IS NOT TRUE`),
      ]);

    res.json({
      success: true,
      data: {
        ingresos_totales:      parseFloat(ingresos.rows[0].valor),
        obras_vendidas:        parseInt(vendidas.rows[0].valor),
        ticket_promedio:       parseFloat(ticket.rows[0].valor),
        comisiones_pendientes: parseFloat(comPend.rows[0].valor),
        artistas_activos:      parseInt(artActivos.rows[0].valor),
        obras_activas:         parseInt(obrasActivas.rows[0].valor),
      },
    });
  } catch (error) {
    logger.error(`Error en getKPIs reportes: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener KPIs" });
  }
};

// =========================================================
// VENTAS POR MES — año actual
// =========================================================
export const getVentasPorMes = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(fecha_venta, 'Mon')       AS mes,
        EXTRACT(MONTH FROM fecha_venta)   AS mes_num,
        COUNT(*)::int                     AS cantidad,
        COALESCE(SUM(total), 0)::numeric  AS total
      FROM ventas
      WHERE EXTRACT(YEAR FROM fecha_venta) = EXTRACT(YEAR FROM CURRENT_DATE)
        AND estado != 'cancelado'
      GROUP BY mes, mes_num
      ORDER BY mes_num ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error en getVentasPorMes: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener ventas por mes" });
  }
};

// =========================================================
// INGRESOS VS COMISIONES — año actual
// =========================================================
export const getIngresosVsComisiones = async (req, res) => {
  try {
    const [ventas, comisiones] = await Promise.all([
      pool.query(`
        SELECT
          TO_CHAR(fecha_venta, 'Mon')                    AS mes,
          EXTRACT(MONTH FROM fecha_venta)                AS mes_num,
          COALESCE(SUM(total), 0)::numeric               AS ingresos,
          COALESCE(SUM(comision_plataforma), 0)::numeric AS comision_plataforma,
          COALESCE(SUM(total_artista), 0)::numeric       AS neto_artistas
        FROM ventas
        WHERE EXTRACT(YEAR FROM fecha_venta) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND estado != 'cancelado'
        GROUP BY mes, mes_num ORDER BY mes_num ASC
      `),
      pool.query(`
        SELECT
          TO_CHAR(fecha_calculo, 'Mon')                         AS mes,
          EXTRACT(MONTH FROM fecha_calculo)                     AS mes_num,
          COALESCE(SUM(monto_comision), 0)::numeric             AS monto_comision,
          COALESCE(SUM(monto_neto_artista), 0)::numeric         AS monto_neto_artista
        FROM comisiones
        WHERE EXTRACT(YEAR FROM fecha_calculo) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND estado != 'cancelada'
        GROUP BY mes, mes_num ORDER BY mes_num ASC
      `),
    ]);

    const map = {};
    ventas.rows.forEach(r => {
      map[r.mes_num] = {
        mes:                 r.mes,
        ingresos:            parseFloat(r.ingresos),
        comision_plataforma: parseFloat(r.comision_plataforma),
        neto_artistas:       parseFloat(r.neto_artistas),
        monto_comision:      0,
      };
    });
    comisiones.rows.forEach(r => {
      if (map[r.mes_num]) {
        map[r.mes_num].monto_comision = parseFloat(r.monto_comision);
      } else {
        map[r.mes_num] = {
          mes:                 r.mes,
          ingresos:            0,
          comision_plataforma: 0,
          neto_artistas:       parseFloat(r.monto_neto_artista),
          monto_comision:      parseFloat(r.monto_comision),
        };
      }
    });

    const data = Object.entries(map)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v);

    res.json({ success: true, data });
  } catch (error) {
    logger.error(`Error en getIngresosVsComisiones: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener ingresos vs comisiones" });
  }
};

// =========================================================
// TOP 10 OBRAS — por ingresos
// =========================================================
export const getTopObras = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.id_obra, o.titulo, o.imagen_principal,
        a.nombre_artistico                   AS artista,
        COUNT(v.id_venta)::int               AS total_ventas,
        COALESCE(SUM(v.total), 0)::numeric   AS ingresos
      FROM ventas v
      INNER JOIN obras    o ON v.id_obra    = o.id_obra
      INNER JOIN artistas a ON v.id_artista = a.id_artista
      WHERE v.estado != 'cancelado'
      GROUP BY o.id_obra, o.titulo, o.imagen_principal, a.nombre_artistico
      ORDER BY ingresos DESC
      LIMIT 10
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error en getTopObras: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener top obras" });
  }
};

// =========================================================
// TOP 10 ARTISTAS — por comisiones generadas
// =========================================================
export const getTopArtistas = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id_artista, a.nombre_completo, a.nombre_artistico, a.foto_perfil,
        a.porcentaje_comision,
        COUNT(DISTINCT c.id_venta)::int                                                             AS ventas_totales,
        COALESCE(SUM(c.monto_comision), 0)::numeric                                                 AS comisiones_generadas,
        COALESCE(SUM(c.monto_neto_artista), 0)::numeric                                             AS neto_artista,
        COALESCE(SUM(CASE WHEN c.estado = 'pagada'    THEN c.monto_comision ELSE 0 END),0)::numeric AS comisiones_pagadas,
        COALESCE(SUM(CASE WHEN c.estado = 'pendiente' THEN c.monto_comision ELSE 0 END),0)::numeric AS comisiones_pendientes
      FROM comisiones c
      INNER JOIN artistas a ON c.id_artista = a.id_artista
      WHERE c.estado != 'cancelada'
      GROUP BY a.id_artista, a.nombre_completo, a.nombre_artistico, a.foto_perfil, a.porcentaje_comision
      ORDER BY comisiones_generadas DESC
      LIMIT 10
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error en getTopArtistas: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener top artistas" });
  }
};

// =========================================================
// EXPORTAR VENTAS .xlsx
// =========================================================
export const exportarVentas = async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const params = [];
    let filtroFecha = "";
    if (desde) { params.push(desde); filtroFecha += ` AND v.fecha_venta >= $${params.length}`; }
    if (hasta) { params.push(hasta); filtroFecha += ` AND v.fecha_venta <= $${params.length}`; }

    const result = await pool.query(`
      SELECT
        v.id_venta,
        TO_CHAR(v.fecha_venta, 'DD/MM/YYYY HH24:MI') AS fecha,
        o.titulo                                      AS obra,
        a.nombre_artistico                            AS artista,
        u.nombre_completo                             AS cliente,
        u.correo                                      AS correo_cliente,
        v.subtotal, v.iva, v.costo_envio, v.total,
        v.estado::text                                AS estado,
        v.estado_pago, v.estado_envio,
        mp.nombre                                     AS metodo_pago
      FROM ventas v
      INNER JOIN obras        o  ON v.id_obra       = o.id_obra
      INNER JOIN artistas     a  ON v.id_artista    = a.id_artista
      INNER JOIN usuarios     u  ON v.id_cliente    = u.id_usuario
      LEFT  JOIN metodos_pago mp ON v.id_metodo_pago = mp.id_metodo_pago
      WHERE v.estado != 'cancelado' ${filtroFecha}
      ORDER BY v.fecha_venta DESC
    `, params);

    const wb = new ExcelJS.Workbook();
    wb.creator = "GaleríaAltar";
    const ws = wb.addWorksheet("Ventas");
    ws.columns = [
      { header: "ID Venta",     key: "id_venta",      width: 10 },
      { header: "Fecha",        key: "fecha",          width: 20 },
      { header: "Obra",         key: "obra",           width: 36 },
      { header: "Artista",      key: "artista",        width: 28 },
      { header: "Cliente",      key: "cliente",        width: 28 },
      { header: "Correo",       key: "correo_cliente", width: 32 },
      { header: "Subtotal",     key: "subtotal",       width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "IVA",          key: "iva",            width: 12, style: { numFmt: '"$"#,##0.00' } },
      { header: "Envío",        key: "costo_envio",    width: 12, style: { numFmt: '"$"#,##0.00' } },
      { header: "Total (MXN)",  key: "total",          width: 16, style: { numFmt: '"$"#,##0.00' } },
      { header: "Estado",       key: "estado",         width: 16 },
      { header: "Estado Pago",  key: "estado_pago",    width: 16 },
      { header: "Estado Envío", key: "estado_envio",   width: 16 },
      { header: "Método Pago",  key: "metodo_pago",    width: 20 },
    ];
    applyHeaderStyle(ws, "FF840E");
    result.rows.forEach(r => ws.addRow(r));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="ventas-${new Date().toISOString().split("T")[0]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error(`Error en exportarVentas: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al exportar ventas" });
  }
};

// =========================================================
// EXPORTAR FINANCIERO .xlsx — por mes
// =========================================================
export const exportarFinanciero = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(fecha_venta, 'Mon YYYY')               AS periodo,
        EXTRACT(YEAR  FROM fecha_venta)::int           AS anio,
        EXTRACT(MONTH FROM fecha_venta)::int           AS mes_num,
        COUNT(*)::int                                  AS num_ventas,
        COALESCE(SUM(subtotal), 0)::numeric            AS subtotal,
        COALESCE(SUM(iva), 0)::numeric                 AS iva,
        COALESCE(SUM(costo_envio), 0)::numeric         AS envio,
        COALESCE(SUM(total), 0)::numeric               AS ingresos_brutos,
        COALESCE(SUM(comision_plataforma), 0)::numeric AS comision_plataforma,
        COALESCE(SUM(total_artista), 0)::numeric       AS neto_artistas
      FROM ventas
      WHERE estado != 'cancelado'
      GROUP BY periodo, anio, mes_num
      ORDER BY anio DESC, mes_num DESC
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = "GaleríaAltar";
    const ws = wb.addWorksheet("Financiero");
    ws.columns = [
      { header: "Período",             key: "periodo",             width: 16 },
      { header: "# Ventas",            key: "num_ventas",          width: 12 },
      { header: "Subtotal",            key: "subtotal",            width: 16, style: { numFmt: '"$"#,##0.00' } },
      { header: "IVA",                 key: "iva",                 width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Envíos",              key: "envio",               width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Ingresos Brutos",     key: "ingresos_brutos",     width: 18, style: { numFmt: '"$"#,##0.00' } },
      { header: "Comisión Plataforma", key: "comision_plataforma", width: 22, style: { numFmt: '"$"#,##0.00' } },
      { header: "Neto Artistas",       key: "neto_artistas",       width: 18, style: { numFmt: '"$"#,##0.00' } },
    ];
    applyHeaderStyle(ws, "8D4CCD");
    result.rows.forEach(r => ws.addRow(r));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="financiero-${new Date().toISOString().split("T")[0]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error(`Error en exportarFinanciero: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al exportar financiero" });
  }
};

// =========================================================
// EXPORTAR ARTISTAS .xlsx
// =========================================================
export const exportarArtistas = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.nombre_completo, a.nombre_artistico, a.correo, a.ciudad,
        a.porcentaje_comision, a.estado,
        TO_CHAR(a.fecha_registro, 'DD/MM/YYYY') AS fecha_registro,
        COUNT(DISTINCT o.id_obra) FILTER (WHERE o.activa = TRUE AND o.estado = 'publicada')::int AS obras_activas,
        COUNT(DISTINCT v.id_venta)::int AS ventas_totales,
        COALESCE(SUM(c.monto_comision), 0)::numeric AS comisiones_totales,
        COALESCE(SUM(CASE WHEN c.estado = 'pagada'    THEN c.monto_comision ELSE 0 END),0)::numeric AS comisiones_pagadas,
        COALESCE(SUM(CASE WHEN c.estado = 'pendiente' THEN c.monto_comision ELSE 0 END),0)::numeric AS comisiones_pendientes,
        COALESCE(SUM(c.monto_neto_artista), 0)::numeric AS neto_acumulado
      FROM artistas a
      LEFT JOIN obras      o ON a.id_artista = o.id_artista AND o.eliminada IS NOT TRUE
      LEFT JOIN ventas     v ON a.id_artista = v.id_artista AND v.estado != 'cancelado'
      LEFT JOIN comisiones c ON a.id_artista = c.id_artista AND c.estado != 'cancelada'
      WHERE a.eliminado IS NOT TRUE
      GROUP BY a.nombre_completo, a.nombre_artistico, a.correo, a.ciudad,
               a.porcentaje_comision, a.estado, a.fecha_registro
      ORDER BY comisiones_totales DESC
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = "GaleríaAltar";
    const ws = wb.addWorksheet("Artistas");
    ws.columns = [
      { header: "Nombre Completo",       key: "nombre_completo",       width: 28 },
      { header: "Nombre Artístico",      key: "nombre_artistico",      width: 28 },
      { header: "Correo",                key: "correo",                width: 32 },
      { header: "Ciudad",                key: "ciudad",                width: 20 },
      { header: "% Comisión",            key: "porcentaje_comision",   width: 14 },
      { header: "Estado",                key: "estado",                width: 14 },
      { header: "Registro",              key: "fecha_registro",        width: 14 },
      { header: "Obras Activas",         key: "obras_activas",         width: 14 },
      { header: "Ventas Totales",        key: "ventas_totales",        width: 14 },
      { header: "Comisiones Generadas",  key: "comisiones_totales",    width: 22, style: { numFmt: '"$"#,##0.00' } },
      { header: "Comisiones Pagadas",    key: "comisiones_pagadas",    width: 22, style: { numFmt: '"$"#,##0.00' } },
      { header: "Comisiones Pendientes", key: "comisiones_pendientes", width: 24, style: { numFmt: '"$"#,##0.00' } },
      { header: "Neto Acumulado",        key: "neto_acumulado",        width: 18, style: { numFmt: '"$"#,##0.00' } },
    ];
    applyHeaderStyle(ws, "CC59AD");
    result.rows.forEach(r => ws.addRow(r));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="artistas-${new Date().toISOString().split("T")[0]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error(`Error en exportarArtistas: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al exportar artistas" });
  }
};

// =========================================================
// EXPORTAR CATÁLOGO OBRAS .xlsx
// =========================================================
export const exportarCatalogoObras = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.id_obra, o.titulo,
        a.nombre_artistico                                    AS artista,
        cat.nombre                                            AS categoria,
        tec.nombre                                            AS tecnica,
        o.anio_creacion, o.precio_base,
        COALESCE(MIN(ot.precio_base), o.precio_base)::numeric AS precio_minimo,
        COALESCE(MAX(ot.precio_base), o.precio_base)::numeric AS precio_maximo,
        o.estado, o.activa, o.destacada, o.vistas,
        TO_CHAR(o.fecha_creacion, 'DD/MM/YYYY') AS fecha_creacion
      FROM obras o
      INNER JOIN artistas   a   ON o.id_artista   = a.id_artista
      INNER JOIN categorias cat ON o.id_categoria = cat.id_categoria
      LEFT  JOIN tecnicas   tec ON o.id_tecnica   = tec.id_tecnica
      LEFT  JOIN obras_tamaños ot ON o.id_obra    = ot.id_obra AND ot.activo = TRUE
      WHERE o.eliminada IS NOT TRUE
      GROUP BY o.id_obra, o.titulo, a.nombre_artistico, cat.nombre, tec.nombre,
               o.anio_creacion, o.precio_base, o.estado, o.activa, o.destacada,
               o.vistas, o.fecha_creacion
      ORDER BY o.fecha_creacion DESC
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = "GaleríaAltar";
    const ws = wb.addWorksheet("Catálogo Obras");
    ws.columns = [
      { header: "ID",          key: "id_obra",        width: 8  },
      { header: "Título",      key: "titulo",          width: 40 },
      { header: "Artista",     key: "artista",         width: 28 },
      { header: "Categoría",   key: "categoria",       width: 20 },
      { header: "Técnica",     key: "tecnica",         width: 20 },
      { header: "Año",         key: "anio_creacion",   width: 8  },
      { header: "Precio Base", key: "precio_base",     width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Precio Mín",  key: "precio_minimo",   width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Precio Máx",  key: "precio_maximo",   width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Estado",      key: "estado",          width: 14 },
      { header: "Activa",      key: "activa",          width: 10 },
      { header: "Destacada",   key: "destacada",       width: 10 },
      { header: "Vistas",      key: "vistas",          width: 10 },
      { header: "Fecha Alta",  key: "fecha_creacion",  width: 14 },
    ];
    applyHeaderStyle(ws, "FF840E");
    result.rows.forEach(r => ws.addRow({
      ...r,
      activa:    r.activa    ? "Sí" : "No",
      destacada: r.destacada ? "Sí" : "No",
    }));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="catalogo-obras-${new Date().toISOString().split("T")[0]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error(`Error en exportarCatalogoObras: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al exportar catálogo" });
  }
};

// =========================================================
// EXPORTAR PLANTILLA OBRAS .xlsx  (2 hojas: Obras + Catálogos)
// GET /api/reportes/exportar/obras-plantilla
// =========================================================
export const exportarObrasPlantilla = async (req, res) => {
  try {
    const [artistas, categorias, tecnicas, obras] = await Promise.all([
      pool.query(`
        SELECT nombre_artistico, nombre_completo
        FROM artistas WHERE eliminado IS NOT TRUE ORDER BY nombre_artistico
      `),
      pool.query(`SELECT nombre FROM categorias ORDER BY nombre`),
      pool.query(`SELECT nombre FROM tecnicas WHERE activa = TRUE ORDER BY nombre`),
      pool.query(`
        SELECT
          o.id_obra, o.titulo,
          a.nombre_artistico                                     AS artista,
          c.nombre                                               AS categoria,
          COALESCE(t.nombre, o.tecnica)                         AS tecnica,
          o.anio_creacion, o.descripcion, o.precio_base,
          o.dimensiones_alto                                    AS alto_cm,
          o.dimensiones_ancho                                   AS ancho_cm,
          o.dimensiones_profundidad                             AS profundidad_cm,
          CASE WHEN o.permite_marco   THEN 'Sí' ELSE 'No' END  AS permite_marco,
          CASE WHEN o.con_certificado THEN 'Sí' ELSE 'No' END  AS con_certificado,
          o.estado,
          CASE WHEN o.destacada THEN 'Sí' ELSE 'No' END        AS destacada,
          o.imagen_principal
        FROM obras o
        INNER JOIN artistas   a ON o.id_artista   = a.id_artista
        INNER JOIN categorias c ON o.id_categoria = c.id_categoria
        LEFT  JOIN tecnicas   t ON o.id_tecnica   = t.id_tecnica
        WHERE o.eliminada IS NOT TRUE
        ORDER BY o.fecha_creacion DESC
      `),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = "GaleríaAltar";
    wb.created = new Date();

    // ── Hoja 1: Obras ──────────────────────────────────────────
    const wsObras = wb.addWorksheet("Obras");
    wsObras.columns = [
      { header: "id_obra",          key: "id_obra",          width: 10 },
      { header: "titulo",           key: "titulo",           width: 40 },
      { header: "artista",          key: "artista",          width: 28 },
      { header: "categoria",        key: "categoria",        width: 22 },
      { header: "tecnica",          key: "tecnica",          width: 22 },
      { header: "anio_creacion",    key: "anio_creacion",    width: 14 },
      { header: "descripcion",      key: "descripcion",      width: 50 },
      { header: "precio_base",      key: "precio_base",      width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "alto_cm",          key: "alto_cm",          width: 10 },
      { header: "ancho_cm",         key: "ancho_cm",         width: 10 },
      { header: "profundidad_cm",   key: "profundidad_cm",   width: 14 },
      { header: "permite_marco",    key: "permite_marco",    width: 14 },
      { header: "con_certificado",  key: "con_certificado",  width: 16 },
      { header: "estado",           key: "estado",           width: 14 },
      { header: "destacada",        key: "destacada",        width: 12 },
      { header: "imagen_principal", key: "imagen_principal", width: 50 },
    ];
    applyHeaderStyle(wsObras, "FF840E");
    obras.rows.forEach(r => wsObras.addRow(r));

    if (obras.rows.length === 0) {
      const hint = wsObras.addRow([
        "", "← Vacío = nueva obra", "← Ver hoja Catálogos", "← Ver hoja Catálogos",
        "← Opcional", "", "", "← Sin símbolo $", "", "", "",
        "Sí o No", "Sí o No", "pendiente / publicada", "Sí o No", "← URL o vacío",
      ]);
      hint.font = { italic: true, color: { argb: "FF999999" }, size: 9 };
    }

    wsObras.views = [{ state: "frozen", ySplit: 1 }];

    // ── Hoja 2: Catálogos (referencia) ─────────────────────────
    const wsCat = wb.addWorksheet("Catálogos");
    wsCat.columns = [
      { header: "Artistas (nombre_artistico)", key: "artista",   width: 32 },
      { header: "Categorías",                  key: "categoria", width: 24 },
      { header: "Técnicas",                    key: "tecnica",   width: 24 },
    ];

    const catHeader = wsCat.getRow(1);
    catHeader.height = 22;
    catHeader.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C2C2C" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    const maxRows = Math.max(artistas.rows.length, categorias.rows.length, tecnicas.rows.length);
    for (let i = 0; i < maxRows; i++) {
      wsCat.addRow({
        artista:   artistas.rows[i]?.nombre_artistico || artistas.rows[i]?.nombre_completo || "",
        categoria: categorias.rows[i]?.nombre || "",
        tecnica:   tecnicas.rows[i]?.nombre  || "",
      });
    }

    try {
      await wsCat.protect("galeria-altar-ro", {
        selectLockedCells:   true,
        selectUnlockedCells: true,
      });
    } catch (_) { /* compatibilidad */ }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="obras-plantilla-${new Date().toISOString().split("T")[0]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error(`Error en exportarObrasPlantilla: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al exportar plantilla de obras" });
  }
};

// =========================================================
// IMPORTAR OBRAS .xlsx
// POST /api/reportes/importar/obras  (multipart, campo: archivo)
// =========================================================
export const importarObras = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No se recibió ningún archivo" });
  }

  const id_usuario = req.user?.id_usuario ?? 1;

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);

    const ws = wb.getWorksheet("Obras") || wb.worksheets[0];
    if (!ws) {
      return res.status(400).json({ success: false, message: "El Excel no contiene la hoja 'Obras'" });
    }

    const [artistas, categorias, tecnicas] = await Promise.all([
      pool.query(`SELECT id_artista, nombre_artistico, nombre_completo FROM artistas WHERE eliminado IS NOT TRUE`),
      pool.query(`SELECT id_categoria, nombre FROM categorias`),
      pool.query(`SELECT id_tecnica, nombre FROM tecnicas WHERE activa = TRUE`),
    ]);

    const mapArtista   = new Map(artistas.rows.map(r => [(r.nombre_artistico || r.nombre_completo).toLowerCase().trim(), r.id_artista]));
    const mapCategoria = new Map(categorias.rows.map(r => [r.nombre.toLowerCase().trim(), r.id_categoria]));
    const mapTecnica   = new Map(tecnicas.rows.map(r => [r.nombre.toLowerCase().trim(), r.id_tecnica]));

    const COLS = {
      id_obra: 1, titulo: 2, artista: 3, categoria: 4, tecnica: 5,
      anio_creacion: 6, descripcion: 7, precio_base: 8,
      alto_cm: 9, ancho_cm: 10, profundidad_cm: 11,
      permite_marco: 12, con_certificado: 13, estado: 14,
      destacada: 15, imagen_principal: 16,
    };

    const getCell = (row, col) => {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.result !== undefined) return v.result;  // fórmula
  if (typeof v === "object" && v.hyperlink !== undefined) return v.hyperlink; // hipervínculo
  if (typeof v === "object" && v.text !== undefined) return v.text;     // rich text
  return v;
};
    const toBoolean = (val, def = true) => {
      if (val === null || val === undefined) return def;
      return ["sí", "si", "yes", "true", "1"].includes(String(val).toLowerCase().trim());
    };
    const toNum = (val) => { const n = parseFloat(val); return isNaN(n) ? null : n; };

    const resultados = [];
    const ESTADOS_VALIDOS = ["pendiente", "publicada", "rechazada", "agotada"];

    for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
      const row    = ws.getRow(rowNum);
      const titulo = String(getCell(row, COLS.titulo) ?? "").trim();
      if (!titulo) continue;

      const rowInfo = { fila: rowNum, titulo, accion: null, errores: [] };

      const artistaRaw   = String(getCell(row, COLS.artista)   ?? "").trim();
      const categoriaRaw = String(getCell(row, COLS.categoria) ?? "").trim();
      const tecnicaRaw   = String(getCell(row, COLS.tecnica)   ?? "").trim();

      const id_artista   = mapArtista.get(artistaRaw.toLowerCase());
      const id_categoria = mapCategoria.get(categoriaRaw.toLowerCase());
      const id_tecnica   = tecnicaRaw ? (mapTecnica.get(tecnicaRaw.toLowerCase()) ?? null) : null;

      if (!id_artista)   rowInfo.errores.push(`Artista "${artistaRaw}" no encontrado`);
      if (!id_categoria) rowInfo.errores.push(`Categoría "${categoriaRaw}" no encontrada`);

      if (rowInfo.errores.length > 0) {
        rowInfo.accion = "error";
        resultados.push(rowInfo);
        continue;
      }

      const estadoRaw = String(getCell(row, COLS.estado) ?? "").toLowerCase().trim();
      const estado    = ESTADOS_VALIDOS.includes(estadoRaw) ? estadoRaw : "pendiente";

      const datos = {
        titulo, id_artista, id_categoria, id_tecnica,
        anio_creacion:           toNum(getCell(row, COLS.anio_creacion)),
        descripcion:             String(getCell(row, COLS.descripcion) ?? "").trim() || null,
        precio_base:             toNum(getCell(row, COLS.precio_base)),
        dimensiones_alto:        toNum(getCell(row, COLS.alto_cm)),
        dimensiones_ancho:       toNum(getCell(row, COLS.ancho_cm)),
        dimensiones_profundidad: toNum(getCell(row, COLS.profundidad_cm)),
        permite_marco:           toBoolean(getCell(row, COLS.permite_marco), true),
        con_certificado:         toBoolean(getCell(row, COLS.con_certificado), false),
        estado,
        activa:                  estado === "publicada",
        destacada:               toBoolean(getCell(row, COLS.destacada), false),
        imagen_principal:        String(getCell(row, COLS.imagen_principal) ?? "").trim() || null,
      };

      const idObra = toNum(getCell(row, COLS.id_obra));

      try {
        if (idObra) {
          // UPDATE
          const upd = await pool.query(`
            UPDATE obras SET
              titulo=$1, id_artista=$2, id_categoria=$3, id_tecnica=$4,
              anio_creacion=$5, descripcion=$6, precio_base=$7,
              dimensiones_alto=$8, dimensiones_ancho=$9, dimensiones_profundidad=$10,
              permite_marco=$11, con_certificado=$12,
              estado=$13, activa=$14, destacada=$15,
              imagen_principal = COALESCE($16, imagen_principal),
              id_usuario_actualizacion=$17,
              fecha_actualizacion = NOW()
            WHERE id_obra=$18 AND eliminada IS NOT TRUE
            RETURNING id_obra
          `, [
            datos.titulo, datos.id_artista, datos.id_categoria, datos.id_tecnica,
            datos.anio_creacion, datos.descripcion, datos.precio_base,
            datos.dimensiones_alto, datos.dimensiones_ancho, datos.dimensiones_profundidad,
            datos.permite_marco, datos.con_certificado,
            datos.estado, datos.activa, datos.destacada,
            datos.imagen_principal, id_usuario, idObra,
          ]);

          if (upd.rows.length === 0) {
            rowInfo.errores.push(`id_obra ${idObra} no existe o está eliminada`);
            rowInfo.accion = "error";
          } else {
            rowInfo.accion  = "actualizada";
            rowInfo.id_obra = idObra;
          }
        } else {
          // INSERT
          let slug = datos.titulo
            .toLowerCase().trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

          const slugCheck = await pool.query("SELECT id_obra FROM obras WHERE slug = $1 LIMIT 1", [slug]);
          if (slugCheck.rows.length > 0) slug = `${slug}-${Date.now()}`;

          const ins = await pool.query(`
            INSERT INTO obras (
              titulo, slug, descripcion,
              id_categoria, id_artista, id_tecnica,
              anio_creacion, imagen_principal, precio_base,
              dimensiones_alto, dimensiones_ancho, dimensiones_profundidad,
              permite_marco, con_certificado, destacada,
              estado, activa, id_usuario_creacion
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            RETURNING id_obra
          `, [
            datos.titulo, slug, datos.descripcion,
            datos.id_categoria, datos.id_artista, datos.id_tecnica,
            datos.anio_creacion, datos.imagen_principal, datos.precio_base,
            datos.dimensiones_alto, datos.dimensiones_ancho, datos.dimensiones_profundidad,
            datos.permite_marco, datos.con_certificado, datos.destacada,
            datos.estado, datos.activa, id_usuario,
          ]);

          rowInfo.accion  = "insertada";
          rowInfo.id_obra = ins.rows[0].id_obra;
        }
      } catch (dbErr) {
        rowInfo.errores.push(`Error BD: ${dbErr.message}`);
        rowInfo.accion = "error";
      }

      resultados.push(rowInfo);
    }

    const resumen = {
      total:        resultados.length,
      insertadas:   resultados.filter(r => r.accion === "insertada").length,
      actualizadas: resultados.filter(r => r.accion === "actualizada").length,
      errores:      resultados.filter(r => r.accion === "error").length,
    };

    logger.info(`[importarObras] ${resumen.insertadas} insertadas, ${resumen.actualizadas} actualizadas, ${resumen.errores} errores | admin=${id_usuario}`);

    return res.json({ success: true, resumen, detalle: resultados });
  } catch (error) {
    logger.error(`Error en importarObras: ${error.message}`);
    return res.status(500).json({ success: false, message: "Error al procesar el archivo: " + error.message });
  }
};

// =========================================================
// EXPORTAR PLANTILLA ARTISTAS .xlsx  (2 hojas: Artistas + Referencia)
// GET /api/reportes/exportar/artistas-plantilla
// =========================================================
export const exportarArtistasPlantilla = async (req, res) => {
  try {
    const artistas = await pool.query(`
      SELECT
        a.id_artista,
        a.nombre_completo,
        a.nombre_artistico,
        a.correo,
        a.telefono,
        a.ciudad,
        a.pais,
        a.porcentaje_comision,
        a.estado,
        CASE WHEN a.activo THEN 'Sí' ELSE 'No' END AS activo,
        a.biografia
      FROM artistas a
      WHERE a.eliminado IS NOT TRUE
      ORDER BY a.nombre_completo ASC
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = "GaleríaAltar";
    wb.created = new Date();

    // ── Hoja 1: Artistas ───────────────────────────────────────
    const wsArtistas = wb.addWorksheet("Artistas");
    wsArtistas.columns = [
      { header: "id_artista",          key: "id_artista",          width: 12 },
      { header: "nombre_completo",     key: "nombre_completo",     width: 32 },
      { header: "nombre_artistico",    key: "nombre_artistico",    width: 32 },
      { header: "correo",              key: "correo",              width: 34 },
      { header: "telefono",            key: "telefono",            width: 18 },
      { header: "ciudad",              key: "ciudad",              width: 22 },
      { header: "pais",                key: "pais",                width: 18 },
      { header: "porcentaje_comision", key: "porcentaje_comision", width: 20 },
      { header: "estado",              key: "estado",              width: 16 },
      { header: "activo",              key: "activo",              width: 12 },
      { header: "biografia",           key: "biografia",           width: 60 },
    ];

    applyHeaderStyle(wsArtistas, "CC59AD");
    artistas.rows.forEach(r => wsArtistas.addRow(r));

    if (artistas.rows.length === 0) {
      const hint = wsArtistas.addRow([
        "← Vacío = nuevo",
        "Apellido Nombre*",
        "Nombre de artista",
        "correo@ejemplo.com*",
        "+52 55 0000 0000",
        "Ciudad de México",
        "México",
        "30",
        "activo / inactivo / pendiente",
        "Sí o No",
        "Texto libre...",
      ]);
      hint.font = { italic: true, color: { argb: "FF999999" }, size: 9 };
    }

    wsArtistas.views = [{ state: "frozen", ySplit: 1 }];

    // ── Hoja 2: Referencia de valores ─────────────────────────
    const wsRef = wb.addWorksheet("Referencia");
    wsRef.columns = [
      { header: "Estados válidos",  key: "estado", width: 26 },
      { header: "activo válidos",   key: "activo", width: 16 },
      { header: "Notas de campos",  key: "nota",   width: 50 },
    ];

    const refHeader = wsRef.getRow(1);
    refHeader.height = 22;
    refHeader.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C2C2C" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    const refRows = [
      { estado: "activo",    activo: "Sí", nota: "id_artista: vacío = crear nuevo, con valor = actualizar existente" },
      { estado: "inactivo",  activo: "No", nota: "nombre_completo y correo son campos obligatorios (*)"              },
      { estado: "pendiente", activo: "",   nota: "porcentaje_comision: número sin % (ej: 30)"                        },
      { estado: "",          activo: "",   nota: "correo debe ser único en el sistema"                                },
      { estado: "",          activo: "",   nota: "biografia: texto libre, puede quedar vacío"                         },
    ];
    refRows.forEach(r => wsRef.addRow(r));

    try {
      await wsRef.protect("galeria-altar-ro", {
        selectLockedCells:   true,
        selectUnlockedCells: true,
      });
    } catch (_) { /* compatibilidad */ }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="artistas-plantilla-${new Date().toISOString().split("T")[0]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error(`Error en exportarArtistasPlantilla: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al exportar plantilla de artistas" });
  }
};

// =========================================================
// IMPORTAR ARTISTAS .xlsx
// POST /api/reportes/importar/artistas  (multipart, campo: archivo)
// =========================================================
export const importarArtistas = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No se recibió ningún archivo" });
  }

  const id_usuario = req.user?.id_usuario ?? 1;

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);

    const ws = wb.getWorksheet("Artistas") || wb.worksheets[0];
    if (!ws) {
      return res.status(400).json({ success: false, message: "El Excel no contiene la hoja 'Artistas'" });
    }

    const COLS = {
      id_artista:          1,
      nombre_completo:     2,
      nombre_artistico:    3,
      correo:              4,
      telefono:            5,
      ciudad:              6,
      pais:                7,
      porcentaje_comision: 8,
      estado:              9,
      activo:              10,
      biografia:           11,
    };

    const getCell = (row, col) => {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.result    !== undefined) return v.result;
  if (typeof v === "object" && v.hyperlink !== undefined) return v.hyperlink;
  if (typeof v === "object" && v.text      !== undefined) return v.text;
  return v;
};
    const toBoolean = (val, def = true) => {
      if (val === null || val === undefined) return def;
      return ["sí", "si", "yes", "true", "1"].includes(String(val).toLowerCase().trim());
    };

    const toNum = (val) => {
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
    };

    const toStr = (val) => {
      const s = String(val ?? "").trim();
      return s === "" ? null : s;
    };

    const ESTADOS_VALIDOS = ["activo", "inactivo", "pendiente"];
    const resultados = [];

    for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
      const row            = ws.getRow(rowNum);
      const nombreCompleto = toStr(getCell(row, COLS.nombre_completo));
      if (!nombreCompleto) continue;

      const rowInfo = { fila: rowNum, titulo: nombreCompleto, accion: null, errores: [] };

      const correo = toStr(getCell(row, COLS.correo));
      if (!correo) rowInfo.errores.push("El correo es obligatorio");

      const porcentaje = toNum(getCell(row, COLS.porcentaje_comision));
      if (porcentaje !== null && (porcentaje < 0 || porcentaje > 100)) {
        rowInfo.errores.push("porcentaje_comision debe estar entre 0 y 100");
      }

      if (rowInfo.errores.length > 0) {
        rowInfo.accion = "error";
        resultados.push(rowInfo);
        continue;
      }

      const estadoRaw = toStr(getCell(row, COLS.estado))?.toLowerCase() ?? "";
      const estado    = ESTADOS_VALIDOS.includes(estadoRaw) ? estadoRaw : "activo";

      const datos = {
        nombre_completo:     nombreCompleto,
        nombre_artistico:    toStr(getCell(row, COLS.nombre_artistico)),
        correo,
        telefono:            toStr(getCell(row, COLS.telefono)),
        ciudad:              toStr(getCell(row, COLS.ciudad)),
        pais:                toStr(getCell(row, COLS.pais)),
        porcentaje_comision: porcentaje ?? 30,
        estado,
        activo:              toBoolean(getCell(row, COLS.activo), true),
        biografia:           toStr(getCell(row, COLS.biografia)),
      };

      const idArtista = toNum(getCell(row, COLS.id_artista));

      try {
        if (idArtista) {
          // ── UPDATE ────────────────────────────────────────────
          const correoConflicto = await pool.query(
            `SELECT id_artista FROM artistas WHERE correo = $1 AND id_artista != $2 AND eliminado IS NOT TRUE LIMIT 1`,
            [datos.correo, idArtista],
          );
          if (correoConflicto.rows.length > 0) {
            rowInfo.errores.push(`El correo "${datos.correo}" ya está en uso por otro artista`);
            rowInfo.accion = "error";
            resultados.push(rowInfo);
            continue;
          }

          const upd = await pool.query(`
            UPDATE artistas SET
              nombre_completo     = $1,
              nombre_artistico    = $2,
              correo              = $3,
              telefono            = $4,
              ciudad              = $5,
              pais                = $6,
              porcentaje_comision = $7,
              estado              = $8,
              activo              = $9,
              biografia           = $10,
              fecha_actualizacion = NOW()
            WHERE id_artista = $11 AND eliminado IS NOT TRUE
            RETURNING id_artista
          `, [
            datos.nombre_completo, datos.nombre_artistico, datos.correo,
            datos.telefono, datos.ciudad, datos.pais,
            datos.porcentaje_comision, datos.estado, datos.activo,
            datos.biografia, idArtista,
          ]);

          if (upd.rows.length === 0) {
            rowInfo.errores.push(`id_artista ${idArtista} no existe o está eliminado`);
            rowInfo.accion = "error";
          } else {
            rowInfo.accion  = "actualizada";
            rowInfo.id_obra = idArtista;
          }

        } else {
          // ── INSERT ────────────────────────────────────────────
          const correoExiste = await pool.query(
            `SELECT id_artista FROM artistas WHERE correo = $1 AND eliminado IS NOT TRUE LIMIT 1`,
            [datos.correo],
          );
          if (correoExiste.rows.length > 0) {
            rowInfo.errores.push(`El correo "${datos.correo}" ya está registrado`);
            rowInfo.accion = "error";
            resultados.push(rowInfo);
            continue;
          }

          const ins = await pool.query(`
            INSERT INTO artistas (
              nombre_completo, nombre_artistico, correo,
              telefono, ciudad, pais,
              porcentaje_comision, estado, activo,
              biografia, eliminado, fecha_registro
            ) VALUES (
              $1, $2, $3,
              $4, $5, $6,
              $7, $8, $9,
              $10, FALSE, NOW()
            )
            RETURNING id_artista
          `, [
            datos.nombre_completo, datos.nombre_artistico, datos.correo,
            datos.telefono, datos.ciudad, datos.pais,
            datos.porcentaje_comision, datos.estado, datos.activo,
            datos.biografia,
          ]);

          rowInfo.accion  = "insertada";
          rowInfo.id_obra = ins.rows[0].id_artista;
        }
      } catch (dbErr) {
        rowInfo.errores.push(`Error BD: ${dbErr.message}`);
        rowInfo.accion = "error";
      }

      resultados.push(rowInfo);
    }

    const resumen = {
      total:        resultados.length,
      insertadas:   resultados.filter(r => r.accion === "insertada").length,
      actualizadas: resultados.filter(r => r.accion === "actualizada").length,
      errores:      resultados.filter(r => r.accion === "error").length,
    };

    logger.info(
      `[importarArtistas] ${resumen.insertadas} insertados, ${resumen.actualizadas} actualizados, ` +
      `${resumen.errores} errores | admin=${id_usuario}`,
    );

    return res.json({ success: true, resumen, detalle: resultados });
  } catch (error) {
    logger.error(`Error en importarArtistas: ${error.message}`);
    return res.status(500).json({ success: false, message: "Error al procesar el archivo: " + error.message });
  }
};