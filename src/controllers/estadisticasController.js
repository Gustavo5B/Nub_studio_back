// controllers/estadisticasController.js
import { pool } from "../config/db.js";
import logger   from "../config/logger.js";

// ══════════════════════════════════════════════════════════════════════════════
// MODELO MATEMÁTICO: Regresión Lineal por Mínimos Cuadrados
// y = a + bx
//   b = (n·Σxy - Σx·Σy) / (n·Σx² - (Σx)²)
//   a = (Σy - b·Σx) / n
//   R² = 1 - SSres/SStot
// ══════════════════════════════════════════════════════════════════════════════
function regresionLineal(puntos) {
  const n = puntos.length;
  if (n < 2) return { a: puntos[0]?.y ?? 0, b: 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const { x, y } of puntos) {
    sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x;
  }
  const b    = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const a    = (sumY - b * sumX) / n;
  const yMed = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of puntos) {
    ssTot += (y - yMed) ** 2;
    ssRes += (y - (a + b * x)) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { a: parseFloat(a.toFixed(4)), b: parseFloat(b.toFixed(4)), r2: parseFloat(r2.toFixed(4)) };
}

function predecir(modelo, ultimoX, n) {
  const { a, b } = modelo;
  return Array.from({ length: n }, (_, i) => {
    const x = ultimoX + i + 1;
    return { x, y: Math.max(0, Math.round(a + b * x)) };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/estadisticas/resumen
// ══════════════════════════════════════════════════════════════════════════════
export async function getResumen(req, res) {
  try {
    const [total, exitosos, fallidos, unicos, hoy, ayer] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM historial_login`),
      pool.query(`SELECT COUNT(*) AS total FROM historial_login WHERE tipo_evento = 'LOGIN_EXITOSO'`),
      pool.query(`SELECT COUNT(*) AS total FROM historial_login WHERE tipo_evento = 'LOGIN_FALLIDO'`),
      pool.query(`SELECT COUNT(DISTINCT id_usuario) AS total FROM historial_login WHERE tipo_evento = 'LOGIN_EXITOSO'`),
      pool.query(`SELECT COUNT(*) AS total FROM historial_login WHERE DATE(fecha) = CURRENT_DATE`),
      pool.query(`SELECT COUNT(*) AS total FROM historial_login WHERE DATE(fecha) = CURRENT_DATE - 1`),
    ]);
    const totalHoy  = parseInt(hoy.rows[0].total);
    const totalAyer = parseInt(ayer.rows[0].total);
    const tendencia = totalAyer === 0 ? 0 : parseFloat(((totalHoy - totalAyer) / totalAyer * 100).toFixed(1));
    res.json({
      success: true,
      data: {
        total_eventos: parseInt(total.rows[0].total),
        logins_exitosos: parseInt(exitosos.rows[0].total),
        logins_fallidos: parseInt(fallidos.rows[0].total),
        usuarios_unicos: parseInt(unicos.rows[0].total),
        accesos_hoy: totalHoy, accesos_ayer: totalAyer, tendencia_pct: tendencia,
      },
    });
  } catch (err) {
    logger.error(`[estadisticas] getResumen: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener resumen" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/estadisticas/por-hora
// ══════════════════════════════════════════════════════════════════════════════
export async function getPorHora(req, res) {
  try {
    const result = await pool.query(`
      SELECT EXTRACT(HOUR FROM fecha)::int AS hora, COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_EXITOSO')::int AS exitosos,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_FALLIDO')::int AS fallidos
      FROM historial_login GROUP BY hora ORDER BY hora ASC
    `);
    const mapa = {};
    result.rows.forEach(r => { mapa[r.hora] = r; });
    const data = Array.from({ length: 24 }, (_, h) => ({
      hora: h, label: `${String(h).padStart(2,"0")}:00`,
      total: mapa[h]?.total ?? 0, exitosos: mapa[h]?.exitosos ?? 0, fallidos: mapa[h]?.fallidos ?? 0,
    }));
    const pico = data.reduce((max, d) => d.total > max.total ? d : max, data[0]);
    res.json({ success: true, data, hora_pico: pico });
  } catch (err) {
    logger.error(`[estadisticas] getPorHora: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener datos por hora" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/estadisticas/por-dia-semana
// ══════════════════════════════════════════════════════════════════════════════
export async function getPorDiaSemana(req, res) {
  try {
    const result = await pool.query(`
      SELECT EXTRACT(DOW FROM fecha)::int AS dia_num, COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_EXITOSO')::int AS exitosos,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_FALLIDO')::int AS fallidos
      FROM historial_login GROUP BY dia_num ORDER BY dia_num ASC
    `);
    const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
    const mapa  = {};
    result.rows.forEach(r => { mapa[r.dia_num] = r; });
    const data = Array.from({ length: 7 }, (_, d) => ({
      dia_num: d, label: DIAS[d],
      total: mapa[d]?.total ?? 0, exitosos: mapa[d]?.exitosos ?? 0, fallidos: mapa[d]?.fallidos ?? 0,
    }));
    const pico = data.reduce((max, d) => d.total > max.total ? d : max, data[0]);
    res.json({ success: true, data, dia_pico: pico });
  } catch (err) {
    logger.error(`[estadisticas] getPorDiaSemana: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener datos por día" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/estadisticas/por-semana
// ══════════════════════════════════════════════════════════════════════════════
export async function getPorSemana(req, res) {
  try {
    const result = await pool.query(`
      SELECT DATE_TRUNC('week', fecha)::date AS semana, COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_EXITOSO')::int AS exitosos,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_FALLIDO')::int AS fallidos,
        COUNT(DISTINCT id_usuario)::int AS usuarios_unicos
      FROM historial_login WHERE fecha >= NOW() - INTERVAL '12 weeks'
      GROUP BY semana ORDER BY semana ASC
    `);
    const data = result.rows.map((r, i) => ({
      semana: r.semana, label: `S${i + 1}`,
      fecha_label: new Date(r.semana).toLocaleDateString("es-MX", { day:"2-digit", month:"short" }),
      total: r.total, exitosos: r.exitosos, fallidos: r.fallidos,
      usuarios_unicos: r.usuarios_unicos, x: i,
    }));
    const puntos  = data.map(d => ({ x: d.x, y: d.total }));
    const modelo  = regresionLineal(puntos);
    const ultimoX = data.length - 1;
    const predicciones = predecir(modelo, ultimoX, 4).map((p, i) => {
      const fechaBase = new Date(data[data.length - 1]?.semana ?? new Date());
      fechaBase.setDate(fechaBase.getDate() + (i + 1) * 7);
      return {
        semana: fechaBase.toISOString().split("T")[0], label: `S${data.length + i + 1}`,
        fecha_label: fechaBase.toLocaleDateString("es-MX", { day:"2-digit", month:"short" }),
        prediccion: p.y, x: p.x,
      };
    });
    res.json({
      success: true, data,
      modelo: { ...modelo, formula: `y = ${modelo.a} + ${modelo.b}x`,
        interpretacion: modelo.b >= 0 ? `Tendencia creciente: +${modelo.b} accesos/semana` : `Tendencia decreciente: ${modelo.b} accesos/semana` },
      predicciones,
    });
  } catch (err) {
    logger.error(`[estadisticas] getPorSemana: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener datos semanales" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/estadisticas/por-dia
// ══════════════════════════════════════════════════════════════════════════════
export async function getPorDia(req, res) {
  try {
    const result = await pool.query(`
      SELECT DATE(fecha) AS dia, COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_EXITOSO')::int AS exitosos,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_FALLIDO')::int AS fallidos,
        COUNT(DISTINCT id_usuario)::int AS usuarios_unicos
      FROM historial_login WHERE fecha >= NOW() - INTERVAL '30 days'
      GROUP BY dia ORDER BY dia ASC
    `);
    const data = result.rows.map((r, i) => ({
      dia: r.dia, label: new Date(r.dia).toLocaleDateString("es-MX", { day:"2-digit", month:"short" }),
      total: r.total, exitosos: r.exitosos, fallidos: r.fallidos,
      usuarios_unicos: r.usuarios_unicos, x: i,
    }));
    const puntos  = data.map(d => ({ x: d.x, y: d.total }));
    const modelo  = regresionLineal(puntos);
    const ultimoX = data.length - 1;
    const predicciones = predecir(modelo, ultimoX, 7).map((p, i) => {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() + i + 1);
      return { dia: fecha.toISOString().split("T")[0],
        label: fecha.toLocaleDateString("es-MX", { day:"2-digit", month:"short" }),
        prediccion: p.y, x: p.x };
    });
    const promedioMovil = data.map((d, i) => {
      const ventana = data.slice(Math.max(0, i - 6), i + 1);
      const avg     = ventana.reduce((s, v) => s + v.total, 0) / ventana.length;
      return { ...d, promedio_movil: parseFloat(avg.toFixed(1)) };
    });
    res.json({
      success: true, data: promedioMovil,
      modelo: { ...modelo, formula: `y = ${modelo.a} + ${modelo.b}x`,
        interpretacion: modelo.b >= 0 ? `Tendencia creciente: +${modelo.b} accesos/día` : `Tendencia decreciente: ${modelo.b} accesos/día` },
      predicciones,
    });
  } catch (err) {
    logger.error(`[estadisticas] getPorDia: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener datos diarios" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/estadisticas/distribucion
// Distribución de tipos de evento — para gráfica de pastel
// ══════════════════════════════════════════════════════════════════════════════
export async function getDistribucion(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        tipo_evento,
        COUNT(*)::int AS total,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS porcentaje
      FROM historial_login
      GROUP BY tipo_evento
      ORDER BY total DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`[estadisticas] getDistribucion: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener distribución" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/estadisticas/mapa-calor
// Matriz hora (0-23) × día de semana (0-6) con conteo de accesos
// ══════════════════════════════════════════════════════════════════════════════
export async function getMapaCalor(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        EXTRACT(DOW  FROM fecha)::int AS dia,
        EXTRACT(HOUR FROM fecha)::int AS hora,
        COUNT(*)::int                 AS total
      FROM historial_login
      GROUP BY dia, hora ORDER BY dia, hora
    `);

    const DIAS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
    const mapa  = {};
    for (let d = 0; d < 7; d++) {
      mapa[d] = {};
      for (let h = 0; h < 24; h++) mapa[d][h] = 0;
    }
    result.rows.forEach(r => { mapa[r.dia][r.hora] = r.total; });

    const maxVal = Math.max(...result.rows.map(r => r.total), 1);

    const matriz = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const total = mapa[d][h];
        matriz.push({
          dia: d, dia_label: DIAS[d],
          hora: h, hora_label: `${String(h).padStart(2,"0")}:00`,
          total, intensidad: parseFloat((total / maxVal).toFixed(3)),
        });
      }
    }

    const top5 = [...matriz]
      .filter(c => c.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    res.json({ success: true, data: matriz, max_valor: maxVal, top5 });
  } catch (err) {
    logger.error(`[estadisticas] getMapaCalor: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener mapa de calor" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/estadisticas/historial
// ══════════════════════════════════════════════════════════════════════════════
export async function getHistorial(req, res) {
  try {
    const { limite = 100, tipo } = req.query;
    const params = [];
    let   where  = "";
    if (tipo) { params.push(tipo); where = `WHERE h.tipo_evento = $1`; }
    const result = await pool.query(`
      SELECT h.id_historial, h.correo, h.tipo_evento,
        h.ip_address, h.fecha, h.detalles, u.nombre_completo
      FROM historial_login h
      LEFT JOIN usuarios u ON h.id_usuario = u.id_usuario
      ${where}
      ORDER BY h.fecha DESC
      LIMIT $${params.length + 1}
    `, [...params, parseInt(limite)]);
    res.json({ success: true, data: result.rows, total: result.rowCount });
  } catch (err) {
    logger.error(`[estadisticas] getHistorial: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener historial" });
  }
}