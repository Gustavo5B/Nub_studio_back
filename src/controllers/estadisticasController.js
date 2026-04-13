// controllers/estadisticasController.js
import { pool } from "../config/db.js";
import logger   from "../config/logger.js";

// ── Helper: construye WHERE + params para filtro de fechas ────────────────────
// Devuelve { where: string, params: any[], nextIdx: number }
// existingWhere: si ya hay un WHERE en la query, se añade AND en lugar de WHERE
function buildDateFilter(query, startIdx = 1, existingWhere = false) {
  const { fecha_inicio, fecha_fin } = query;
  const params = [];
  const conditions = [];
  // Comparar en hora local de México, no en UTC
  if (fecha_inicio) {
    params.push(fecha_inicio);
    conditions.push(`(fecha AT TIME ZONE 'America/Mexico_City')::date >= $${startIdx + params.length - 1}::date`);
  }
  if (fecha_fin) {
    params.push(fecha_fin);
    conditions.push(`(fecha AT TIME ZONE 'America/Mexico_City')::date <= $${startIdx + params.length - 1}::date`);
  }
  const prefix = existingWhere ? " AND " : " WHERE ";
  const clause = conditions.length === 0 ? "" : prefix + conditions.join(" AND ");
  return { where: clause, params, nextIdx: startIdx + params.length };
}

// ══════════════════════════════════════════════════════════════════════════════
// MODELO MATEMÁTICO: Crecimiento / Decrecimiento Exponencial
// Ley:       dy/dt = k·y   →   Solución: y(t) = y₀·eᵏᵗ
// Linealizar: ln(y) = ln(y₀) + k·t  →  regresión de mínimos cuadrados sobre
//             todos los puntos con y > 0  →  k y y₀ robustos
// R²         calculado en escala original (no logarítmica)
// t_duplic   ln(2) / k  si k > 0  (tiempo de duplicación)
// t_semivida ln(2) / |k|  si k < 0  (tiempo de semivida)
// ══════════════════════════════════════════════════════════════════════════════
function modeloExponencial(puntos) {
  const n = puntos.length;

  // Estadísticos de la serie original (todos los puntos)
  const yVals = puntos.map(p => p.y);
  const media = yVals.reduce((a, b) => a + b, 0) / n;
  const desvStd = Math.sqrt(yVals.reduce((s, v) => s + (v - media) ** 2, 0) / n);
  const freq = {};
  yVals.forEach(v => { freq[v] = (freq[v] ?? 0) + 1; });
  const moda = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);

  // Fallback cuando no hay suficientes datos positivos
  const puntosPos = puntos.filter(p => p.y > 0);
  if (puntosPos.length < 2) {
    const y0 = puntosPos[0]?.y ?? 1;
    return {
      y0, k: 0, fase: "estable",
      ecuacion: `y(t) = ${y0}·e^(0·t)`,
      t_caracteristico: null,
      estadisticos: { media: Number.parseFloat(media.toFixed(2)), moda, desv_std: Number.parseFloat(desvStd.toFixed(2)), r2: 0 },
      errores: [],
    };
  }

  // Mínimos cuadrados sobre ln(y) = ln(y₀) + k·t
  const np = puntosPos.length;
  let sumX = 0, sumLnY = 0, sumXLnY = 0, sumX2 = 0;
  for (const { x, y } of puntosPos) {
    const lnY = Math.log(y);
    sumX += x; sumLnY += lnY; sumXLnY += x * lnY; sumX2 += x * x;
  }
  const denom = np * sumX2 - sumX * sumX;
  const k    = denom === 0 ? 0 : (np * sumXLnY - sumX * sumLnY) / denom;
  const lnY0 = (sumLnY - k * sumX) / np;
  const y0   = Math.exp(lnY0);

  // R² en escala logarítmica — mide la calidad del ajuste lineal que sí optimizamos:
  // ln(y) = ln(y₀) + k·t. Es el R² natural para regresión exponencial linealizada.
  const lnYMed = sumLnY / np;
  let ssTotLog = 0, ssResLog = 0;
  for (const { x, y } of puntosPos) {
    const lnY     = Math.log(y);
    const lnYPred = lnY0 + k * x;
    ssTotLog += (lnY - lnYMed) ** 2;
    ssResLog += (lnY - lnYPred) ** 2;
  }
  const r2 = ssTotLog === 0 ? 1 : Math.max(0, 1 - ssResLog / ssTotLog);

  // Errores punto a punto en escala original (para tabla técnica)
  const errores = puntos.map(({ x, y }) => {
    const yMod   = y0 * Math.exp(k * x);
    const error  = y - yMod;
    // sMAPE: simétrico, acotado 0-200%, estable cuando y es pequeño
    const denom2 = (Math.abs(y) + Math.abs(yMod)) / 2;
    const errRel = denom2 > 0 ? Math.abs(error) / denom2 * 100 : null;
    return {
      x,
      y_real:         y,
      y_modelo:       Number.parseFloat(yMod.toFixed(2)),
      error:          Number.parseFloat(error.toFixed(2)),
      error_relativo: errRel === null ? null : Number.parseFloat(errRel.toFixed(2)),
    };
  });

  const kFmt  = Number.parseFloat(k.toFixed(4));
  const y0Fmt = Number.parseFloat(y0.toFixed(4));
  let fase;
  if (k > 0)      fase = "crecimiento";
  else if (k < 0) fase = "decrecimiento";
  else             fase = "estable";
  const ecuacion = `y(t) = ${y0Fmt}·e^(${kFmt}·t)`;

  // Tiempo de duplicación (k > 0) o semivida (k < 0)
  const t_caracteristico = Math.abs(k) > 0.0001
    ? Number.parseFloat((Math.log(2) / Math.abs(k)).toFixed(2))
    : null;

  return {
    y0:    y0Fmt,
    k:     kFmt,
    fase,
    ecuacion,
    t_caracteristico,
    estadisticos: {
      media:    Number.parseFloat(media.toFixed(2)),
      moda,
      desv_std: Number.parseFloat(desvStd.toFixed(2)),
      r2:       Number.parseFloat(r2.toFixed(4)),
    },
    errores,
  };
}

// maxHistorico: techo de seguridad → predicción nunca puede exceder 5× el histórico máximo.
// Evita que un k alto con pocos puntos genere valores astronómicos.
function predecir(modelo, ultimoX, n, maxHistorico = Infinity) {
  const { y0, k } = modelo;
  const techo = Math.max(1, maxHistorico) * 5;
  return Array.from({ length: n }, (_, i) => {
    const x   = ultimoX + i + 1;
    const raw = Math.max(0, y0 * Math.exp(k * x));
    const val = Math.min(raw, techo);
    return { x, y: Math.round(val) };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/estadisticas/resumen
// ══════════════════════════════════════════════════════════════════════════════
export async function getResumen(req, res) {
  try {
    const { where, params } = buildDateFilter(req.query);
    const [total, exitosos, fallidos, unicos, hoy, ayer] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM historial_login${where}`, params),
      pool.query(`SELECT COUNT(*) AS total FROM historial_login${where}${where ? " AND" : " WHERE"} tipo_evento = 'LOGIN_EXITOSO'`, params),
      pool.query(`SELECT COUNT(*) AS total FROM historial_login${where}${where ? " AND" : " WHERE"} tipo_evento = 'LOGIN_FALLIDO'`, params),
      pool.query(`SELECT COUNT(DISTINCT id_usuario) AS total FROM historial_login${where}${where ? " AND" : " WHERE"} tipo_evento = 'LOGIN_EXITOSO'`, params),
      pool.query(`SELECT COUNT(*) AS total FROM historial_login WHERE (fecha AT TIME ZONE 'America/Mexico_City')::date = (NOW() AT TIME ZONE 'America/Mexico_City')::date`),
      pool.query(`SELECT COUNT(*) AS total FROM historial_login WHERE (fecha AT TIME ZONE 'America/Mexico_City')::date = (NOW() AT TIME ZONE 'America/Mexico_City')::date - 1`),
    ]);
    const totalHoy  = Number.parseInt(hoy.rows[0].total);
    const totalAyer = Number.parseInt(ayer.rows[0].total);
    const tendencia = totalAyer === 0 ? 0 : Number.parseFloat(((totalHoy - totalAyer) / totalAyer * 100).toFixed(1));
    res.json({
      success: true,
      data: {
        total_eventos: Number.parseInt(total.rows[0].total),
        logins_exitosos: Number.parseInt(exitosos.rows[0].total),
        logins_fallidos: Number.parseInt(fallidos.rows[0].total),
        usuarios_unicos: Number.parseInt(unicos.rows[0].total),
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
    const { where, params } = buildDateFilter(req.query);
    const result = await pool.query(`
      SELECT EXTRACT(HOUR FROM fecha AT TIME ZONE 'America/Mexico_City')::int AS hora,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_EXITOSO')::int AS exitosos,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_FALLIDO')::int AS fallidos
      FROM historial_login${where} GROUP BY hora ORDER BY hora ASC
    `, params);
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
    const { where, params } = buildDateFilter(req.query);
    const result = await pool.query(`
      SELECT EXTRACT(DOW FROM fecha AT TIME ZONE 'America/Mexico_City')::int AS dia_num,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_EXITOSO')::int AS exitosos,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_FALLIDO')::int AS fallidos
      FROM historial_login${where} GROUP BY dia_num ORDER BY dia_num ASC
    `, params);
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
    const { where, params } = buildDateFilter(req.query);
    // Sin filtro personalizado → últimas 12 semanas por defecto
    const defaultWhere = where || ` WHERE fecha >= NOW() - INTERVAL '12 weeks'`;
    const result = await pool.query(`
      SELECT DATE_TRUNC('week', fecha AT TIME ZONE 'America/Mexico_City')::date AS semana,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_EXITOSO')::int AS exitosos,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_FALLIDO')::int AS fallidos,
        COUNT(DISTINCT id_usuario)::int AS usuarios_unicos
      FROM historial_login${defaultWhere}
      GROUP BY semana ORDER BY semana ASC
    `, params);
    const data = result.rows.map((r, i) => ({
      semana: r.semana, label: `S${i + 1}`,
      fecha_label: new Date(r.semana).toLocaleDateString("es-MX", { day:"2-digit", month:"short" }),
      total: r.total, exitosos: r.exitosos, fallidos: r.fallidos,
      usuarios_unicos: r.usuarios_unicos, x: i,
    }));
    const puntos       = data.map(d => ({ x: d.x, y: d.total }));
    const modelo       = modeloExponencial(puntos);
    const ultimoX      = data.length - 1;
    const maxHistorico = data.length > 0 ? Math.max(...data.map(d => d.total)) : 0;
    // Predicciones sólo con ≥ 4 semanas de datos (modelo estable)
    const predicciones = data.length >= 4
      ? predecir(modelo, ultimoX, 4, maxHistorico).map((p, i) => {
          const fechaBase = new Date(data[data.length - 1]?.semana ?? new Date());
          fechaBase.setDate(fechaBase.getDate() + (i + 1) * 7);
          return {
            semana: fechaBase.toISOString().split("T")[0], label: `S${data.length + i + 1}`,
            fecha_label: fechaBase.toLocaleDateString("es-MX", { day:"2-digit", month:"short" }),
            prediccion: p.y, x: p.x,
          };
        })
      : [];
    res.json({ success: true, data, modelo, predicciones });
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
    const { where, params } = buildDateFilter(req.query);
    // Sin filtro personalizado → últimos 30 días por defecto
    const defaultWhere = where || ` WHERE fecha >= NOW() - INTERVAL '30 days'`;
    const result = await pool.query(`
      SELECT (fecha AT TIME ZONE 'America/Mexico_City')::date AS dia,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_EXITOSO')::int AS exitosos,
        COUNT(*) FILTER (WHERE tipo_evento = 'LOGIN_FALLIDO')::int AS fallidos,
        COUNT(DISTINCT id_usuario)::int AS usuarios_unicos
      FROM historial_login${defaultWhere}
      GROUP BY dia ORDER BY dia ASC
    `, params);
    const data = result.rows.map((r, i) => ({
      dia: r.dia, label: new Date(r.dia).toLocaleDateString("es-MX", { day:"2-digit", month:"short" }),
      total: r.total, exitosos: r.exitosos, fallidos: r.fallidos,
      usuarios_unicos: r.usuarios_unicos, x: i,
    }));
    // Primero calcular media móvil de 7 días — elimina ruido diario
    const promedioMovil = data.map((d, i) => {
      const ventana = data.slice(Math.max(0, i - 6), i + 1);
      const avg     = ventana.reduce((s, v) => s + v.total, 0) / ventana.length;
      return { ...d, promedio_movil: Number.parseFloat(avg.toFixed(1)) };
    });
    // Ajustar el modelo exponencial a la media móvil, no a los datos crudos.
    // La media móvil revela la tendencia subyacente eliminando picos aislados,
    // lo que produce un R² significativamente mejor y predicciones más estables.
    const puntos       = promedioMovil.map(d => ({ x: d.x, y: d.promedio_movil }));
    const modelo       = modeloExponencial(puntos);
    const ultimoX      = data.length - 1;
    const maxHistorico = promedioMovil.length > 0 ? Math.max(...promedioMovil.map(d => d.promedio_movil)) : 0;
    // Predicciones sólo con ≥ 4 días de datos (modelo estable)
    const predicciones = promedioMovil.length >= 4
      ? predecir(modelo, ultimoX, 7, maxHistorico).map((p, i) => {
          const fecha = new Date();
          fecha.setDate(fecha.getDate() + i + 1);
          return { dia: fecha.toISOString().split("T")[0],
            label: fecha.toLocaleDateString("es-MX", { day:"2-digit", month:"short" }),
            prediccion: p.y, x: p.x };
        })
      : [];
    res.json({ success: true, data: promedioMovil, modelo, predicciones });
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
    const { where, params } = buildDateFilter(req.query);
    const result = await pool.query(`
      SELECT
        tipo_evento,
        COUNT(*)::int AS total,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS porcentaje
      FROM historial_login${where}
      GROUP BY tipo_evento
      ORDER BY total DESC
    `, params);
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
    const { where, params } = buildDateFilter(req.query);
    const result = await pool.query(`
      SELECT
        EXTRACT(DOW  FROM fecha AT TIME ZONE 'America/Mexico_City')::int AS dia,
        EXTRACT(HOUR FROM fecha AT TIME ZONE 'America/Mexico_City')::int AS hora,
        COUNT(*)::int AS total
      FROM historial_login${where}
      GROUP BY dia, hora ORDER BY dia, hora
    `, params);

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
          total, intensidad: Number.parseFloat((total / maxVal).toFixed(3)),
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
    const { limite = 500, tipo, fecha_inicio, fecha_fin } = req.query;
    const params = [];
    const conditions = [];

    if (tipo)         { params.push(tipo);         conditions.push(`h.tipo_evento = $${params.length}`); }
    if (fecha_inicio) { params.push(fecha_inicio);  conditions.push(`h.fecha >= $${params.length}::date`); }
    if (fecha_fin)    { params.push(fecha_fin);     conditions.push(`h.fecha < ($${params.length}::date + INTERVAL '1 day')`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`
      SELECT h.id_historial, h.correo, h.tipo_evento,
        h.ip_address, h.fecha, h.detalles, u.nombre_completo
      FROM historial_login h
      LEFT JOIN usuarios u ON h.id_usuario = u.id_usuario
      ${where}
      ORDER BY h.fecha DESC
      LIMIT $${params.length + 1}
    `, [...params, Number.parseInt(limite)]);
    res.json({ success: true, data: result.rows, total: result.rowCount });
  } catch (err) {
    logger.error(`[estadisticas] getHistorial: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener historial" });
  }
}