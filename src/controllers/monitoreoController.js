// src/controllers/monitoreoController.js
import { pool } from "../config/db.js";
import logger   from "../config/logger.js";
import os       from "os";

const startTime = Date.now();

// ── Helper ────────────────────────────────────────────────────────────────────
async function safeQuery(client, sql, params = []) {
  try {
    const r = await client.query(sql, params);
    return r.rows;
  } catch (err) {
    logger.warn(`[monitoreo] query falló: ${err.message}`);
    return [];
  }
}

// ── Asegurar tabla de historial ───────────────────────────────────────────────
async function ensureHistorialTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monitoreo_historial (
      id           SERIAL PRIMARY KEY,
      tipo         VARCHAR(20) NOT NULL,   -- 'vacuum' | 'reindex'
      tabla        VARCHAR(200),
      alcance      VARCHAR(20) DEFAULT 'individual',  -- 'individual' | 'global'
      duracion_ms  INTEGER,
      exitoso      BOOLEAN DEFAULT TRUE,
      error_msg    TEXT,
      id_admin     INTEGER,
      ejecutado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function registrarHistorial(tipo, tabla, alcance, duracion_ms, exitoso, error_msg, id_admin) {
  try {
    await ensureHistorialTable();
    await pool.query(`
      INSERT INTO monitoreo_historial (tipo, tabla, alcance, duracion_ms, exitoso, error_msg, id_admin)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [tipo, tabla, alcance, duracion_ms, exitoso, error_msg ?? null, id_admin ?? null]);
  } catch (err) {
    logger.warn(`[monitoreo] No se pudo registrar historial: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/resumen
// ══════════════════════════════════════════════════════════════════════════════
export async function getResumen(req, res) {
  const client = await pool.connect();
  try {
    const [dbSize, cacheHit, conexiones, totalTablas, totalFilas, bloat, txRate] =
      await Promise.all([
        safeQuery(client, `SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
                                  pg_database_size(current_database()) AS bytes`),
        safeQuery(client, `SELECT ROUND(
            sum(heap_blks_hit)::numeric /
            NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100, 2
          ) AS ratio FROM pg_statio_user_tables`),
        safeQuery(client, `SELECT count(*) AS total,
            sum(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS activas,
            sum(CASE WHEN state = 'idle'   THEN 1 ELSE 0 END) AS inactivas
          FROM pg_stat_activity WHERE datname = current_database()`),
        safeQuery(client, `SELECT count(*) AS total FROM information_schema.tables
          WHERE table_schema = 'public'`),
        safeQuery(client, `SELECT sum(n_live_tup)::bigint AS total FROM pg_stat_user_tables`),
        safeQuery(client, `SELECT count(*) AS total FROM pg_stat_user_indexes
          WHERE idx_scan = 0 AND indexrelname NOT LIKE '%pkey%'`),
        safeQuery(client, `SELECT xact_commit + xact_rollback AS tx_total,
            xact_commit AS commits, xact_rollback AS rollbacks
          FROM pg_stat_database WHERE datname = current_database()`),
      ]);

    const uptimeMs      = Date.now() - startTime;
    const memTotal      = os.totalmem();
    const memLibre      = os.freemem();
    const memUsada      = memTotal - memLibre;

    res.json({
      success: true,
      data: {
        bd: {
          size:   dbSize[0]?.size  ?? "—",
          bytes:  dbSize[0]?.bytes ?? 0,
          tablas: parseInt(totalTablas[0]?.total ?? "0"),
          filas:  parseInt(totalFilas[0]?.total  ?? "0"),
        },
        rendimiento: {
          cache_hit_ratio:      parseFloat(cacheHit[0]?.ratio   ?? "0"),
          conexiones_total:     parseInt(conexiones[0]?.total    ?? "0"),
          conexiones_activas:   parseInt(conexiones[0]?.activas  ?? "0"),
          conexiones_inactivas: parseInt(conexiones[0]?.inactivas ?? "0"),
          tx_total:     parseInt(txRate[0]?.tx_total  ?? "0"),
          tx_commits:   parseInt(txRate[0]?.commits   ?? "0"),
          tx_rollbacks: parseInt(txRate[0]?.rollbacks ?? "0"),
        },
        indices: { sin_uso: parseInt(bloat[0]?.total ?? "0") },
        servidor: {
          uptime:       `${Math.floor(uptimeMs/3600000)}h ${Math.floor((uptimeMs%3600000)/60000)}m`,
          uptime_ms:    uptimeMs,
          mem_total_mb: Math.round(memTotal / 1048576),
          mem_usada_mb: Math.round(memUsada / 1048576),
          mem_pct:      Math.round((memUsada / memTotal) * 100),
          node_version: process.version,
          plataforma:   process.platform,
        },
      },
    });
  } catch (err) {
    logger.error(`[monitoreo] getResumen: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener resumen" });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/tablas
// ══════════════════════════════════════════════════════════════════════════════
export async function getTablas(req, res) {
  const client = await pool.connect();
  try {
    const rows = await safeQuery(client, `
      SELECT
        t.relname                                        AS nombre,
        s.n_live_tup::bigint                             AS filas_vivas,
        s.n_dead_tup::bigint                             AS filas_muertas,
        pg_size_pretty(pg_total_relation_size(t.oid))   AS size_total,
        pg_total_relation_size(t.oid)                   AS bytes_total,
        pg_size_pretty(pg_relation_size(t.oid))         AS size_tabla,
        pg_size_pretty(pg_indexes_size(t.oid))          AS size_indices,
        s.seq_scan                                       AS scans_secuenciales,
        s.idx_scan                                       AS scans_por_indice,
        s.n_tup_ins                                      AS inserciones,
        s.n_tup_upd                                      AS actualizaciones,
        s.n_tup_del                                      AS eliminaciones,
        s.last_vacuum,
        s.last_autovacuum,
        s.last_analyze
      FROM pg_class t
      JOIN pg_stat_user_tables s ON s.relname = t.relname
      WHERE t.relkind = 'r' AND t.relnamespace = 'public'::regnamespace
      ORDER BY bytes_total DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error(`[monitoreo] getTablas: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener tablas" });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/queries-lentas
// ══════════════════════════════════════════════════════════════════════════════
export async function getQueriesLentas(req, res) {
  const client = await pool.connect();
  try {
    const rows = await safeQuery(client, `
      SELECT LEFT(query, 120) AS query, calls,
        ROUND(mean_exec_time::numeric, 2) AS tiempo_promedio_ms,
        ROUND(total_exec_time::numeric, 2) AS tiempo_total_ms,
        rows
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND query NOT ILIKE '%pg_stat%'
      ORDER BY mean_exec_time DESC LIMIT 10
    `);
    if (rows.length > 0) return res.json({ success: true, data: rows, fuente: "pg_stat_statements" });

    const fallback = await safeQuery(client, `
      SELECT LEFT(query, 120) AS query, state,
        EXTRACT(EPOCH FROM (now() - query_start))::int AS duracion_seg
      FROM pg_stat_activity
      WHERE state != 'idle' AND query NOT ILIKE '%pg_stat%' AND query_start IS NOT NULL
      ORDER BY query_start ASC LIMIT 10
    `);
    res.json({ success: true, data: fallback, fuente: "pg_stat_activity" });
  } catch (err) {
    logger.error(`[monitoreo] getQueriesLentas: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener queries" });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/indices
// ══════════════════════════════════════════════════════════════════════════════
export async function getIndices(req, res) {
  const client = await pool.connect();
  try {
    const [usados, sinUso, faltantes] = await Promise.all([
      safeQuery(client, `
        SELECT indexrelname AS indice, relname AS tabla, idx_scan AS usos,
          pg_size_pretty(pg_relation_size(indexrelid)) AS tamanio
        FROM pg_stat_user_indexes WHERE idx_scan > 0
        ORDER BY idx_scan DESC LIMIT 15
      `),
      safeQuery(client, `
        SELECT indexrelname AS indice, relname AS tabla,
          pg_size_pretty(pg_relation_size(indexrelid)) AS tamanio,
          pg_relation_size(indexrelid) AS bytes
        FROM pg_stat_user_indexes
        WHERE idx_scan = 0 AND indexrelname NOT LIKE '%pkey%' AND indexrelname NOT LIKE '%unique%'
        ORDER BY bytes DESC LIMIT 10
      `),
      safeQuery(client, `
        SELECT relname AS nombre, seq_scan, idx_scan,
          n_live_tup AS filas, 0 AS scans_por_indice,
          0 AS scans_secuenciales, 0 AS inserciones,
          0 AS actualizaciones, 0 AS eliminaciones
        FROM pg_stat_user_tables
        WHERE seq_scan > 100 AND (idx_scan = 0 OR seq_scan > idx_scan * 3) AND n_live_tup > 500
        ORDER BY seq_scan DESC LIMIT 10
      `),
    ]);
    res.json({ success: true, data: { usados, sin_uso: sinUso, posibles_faltantes: faltantes } });
  } catch (err) {
    logger.error(`[monitoreo] getIndices: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener índices" });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/conexiones
// ══════════════════════════════════════════════════════════════════════════════
export async function getConexiones(req, res) {
  const client = await pool.connect();
  try {
    const [activas, maxConex, porEstado] = await Promise.all([
      safeQuery(client, `
        SELECT pid, usename AS usuario, application_name AS aplicacion, state,
          LEFT(query, 80) AS query,
          EXTRACT(EPOCH FROM (now() - query_start))::int AS duracion_seg,
          wait_event_type, wait_event
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
        ORDER BY query_start DESC NULLS LAST LIMIT 20
      `),
      safeQuery(client, `SHOW max_connections`),
      safeQuery(client, `
        SELECT state, count(*) AS total FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY state ORDER BY total DESC
      `),
    ]);
    res.json({
      success: true,
      data: { conexiones: activas, max_conexiones: parseInt(maxConex[0]?.max_connections ?? "100"), por_estado: porEstado },
    });
  } catch (err) {
    logger.error(`[monitoreo] getConexiones: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener conexiones" });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/alertas
// ══════════════════════════════════════════════════════════════════════════════
export async function getAlertas(req, res) {
  const client = await pool.connect();
  try {
    const alertas = [];

    const cache = await safeQuery(client, `
      SELECT ROUND(sum(heap_blks_hit)::numeric /
        NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100, 2) AS ratio
      FROM pg_statio_user_tables
    `);
    const cacheRatio = parseFloat(cache[0]?.ratio ?? "100");
    if (cacheRatio < 95)
      alertas.push({ nivel:"critico", tipo:"cache", titulo:"Caché ineficiente",
        descripcion:`El ratio es ${cacheRatio}% — el ${(100-cacheRatio).toFixed(1)}% de las lecturas van a disco. Recomendado >99%. En Neon free tier es normal por la RAM limitada; en producción se resuelve aumentando shared_buffers.`, valor:cacheRatio });
    else if (cacheRatio < 99)
      alertas.push({ nivel:"advertencia", tipo:"cache", titulo:"Eficiencia de caché mejorable",
        descripcion:`El ratio es ${cacheRatio}% — el ${(100-cacheRatio).toFixed(1)}% de lecturas van a disco. Lo óptimo es >99%. Considera aumentar shared_buffers.`, valor:cacheRatio });

    const conex    = await safeQuery(client, `SELECT count(*) AS activas FROM pg_stat_activity WHERE datname = current_database()`);
    const maxConex = await safeQuery(client, `SHOW max_connections`);
    const activas  = parseInt(conex[0]?.activas ?? "0");
    const maxC     = parseInt(maxConex[0]?.max_connections ?? "100");
    const pct      = Math.round((activas / maxC) * 100);
    if (pct > 85)
      alertas.push({ nivel:"critico", tipo:"conexiones", titulo:"Conexiones cerca del límite",
        descripcion:`${activas} de ${maxC} conexiones usadas (${pct}%).`, valor:pct });
    else if (pct > 70)
      alertas.push({ nivel:"advertencia", tipo:"conexiones", titulo:"Uso de conexiones elevado",
        descripcion:`${activas} de ${maxC} conexiones (${pct}%).`, valor:pct });

    const deadTup = await safeQuery(client, `
      SELECT relname, n_dead_tup, n_live_tup,
        ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 1) AS pct_muertos
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 1000 AND n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) > 0.1
      ORDER BY n_dead_tup DESC LIMIT 5
    `);
    for (const t of deadTup)
      alertas.push({ nivel:"advertencia", tipo:"vacuum",
        titulo:`Tabla "${t.relname}" necesita VACUUM`,
        descripcion:`${t.n_dead_tup} filas muertas (${t.pct_muertos}%). Ejecutar VACUUM ANALYZE.`,
        valor:parseFloat(t.pct_muertos), tabla:t.relname });

    // Bloqueos activos
    const bloqueos = await safeQuery(client, `
      SELECT count(*) AS total FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = current_database()
    `);
    if (parseInt(bloqueos[0]?.total ?? "0") > 0)
      alertas.push({ nivel:"critico", tipo:"bloqueo",
        titulo:`${bloqueos[0].total} proceso(s) bloqueado(s) detectado(s)`,
        descripcion:"Hay procesos esperando por bloqueos de tablas o filas. Revisa la pestaña Bloqueos.",
        valor:parseInt(bloqueos[0].total) });

    const idxSinUso = await safeQuery(client, `
      SELECT indexrelname, pg_relation_size(indexrelid) AS bytes
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0 AND indexrelname NOT LIKE '%pkey%'
      ORDER BY bytes DESC LIMIT 5
    `);
    if (idxSinUso.length > 0)
      alertas.push({ nivel:"info", tipo:"indices",
        titulo:`${idxSinUso.length} índice(s) sin uso detectados`,
        descripcion:`Considera eliminarlos para liberar espacio: ${idxSinUso.map(i => i.indexrelname).join(", ")}`,
        valor:idxSinUso.length });

    const memPct = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
    if (memPct > 90)
      alertas.push({ nivel:"critico", tipo:"memoria", titulo:"Memoria del servidor crítica",
        descripcion:`Uso de RAM al ${memPct}%.`, valor:memPct });
    else if (memPct > 75)
      alertas.push({ nivel:"advertencia", tipo:"memoria", titulo:"Uso de memoria elevado",
        descripcion:`Uso de RAM al ${memPct}%.`, valor:memPct });

    if (alertas.length === 0)
      alertas.push({ nivel:"ok", tipo:"general", titulo:"Sistema funcionando correctamente",
        descripcion:"No se detectaron problemas de rendimiento.", valor:100 });

    res.json({ success:true, data:alertas, total:alertas.length });
  } catch (err) {
    logger.error(`[monitoreo] getAlertas: ${err.message}`);
    res.status(500).json({ success:false, message:"Error al obtener alertas" });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/bloqueos  ← NUEVO
// Detecta bloqueos y deadlocks en tiempo real
// ══════════════════════════════════════════════════════════════════════════════
export async function getBloqueos(req, res) {
  const client = await pool.connect();
  try {
    const [bloqueos, deadlocks, esperando] = await Promise.all([
      // Procesos actualmente bloqueados
      safeQuery(client, `
        SELECT
          blocked.pid                        AS pid_bloqueado,
          blocked.usename                    AS usuario,
          LEFT(blocked.query, 100)           AS query_bloqueada,
          EXTRACT(EPOCH FROM (now() - blocked.query_start))::int AS espera_seg,
          blocking.pid                       AS pid_bloqueante,
          blocking.usename                   AS usuario_bloqueante,
          LEFT(blocking.query, 100)          AS query_bloqueante,
          blocked.wait_event_type,
          blocked.wait_event
        FROM pg_stat_activity blocked
        JOIN pg_stat_activity blocking
          ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
        WHERE blocked.datname = current_database()
        ORDER BY espera_seg DESC
      `),
      // Historial de deadlocks de la BD
      safeQuery(client, `
        SELECT deadlocks, conflicts, temp_files,
          temp_bytes, blk_read_time, blk_write_time
        FROM pg_stat_database WHERE datname = current_database()
      `),
      // Tipos de eventos de espera
      safeQuery(client, `
        SELECT wait_event_type, wait_event, count(*) AS total
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event IS NOT NULL
          AND state != 'idle'
        GROUP BY wait_event_type, wait_event
        ORDER BY total DESC LIMIT 10
      `),
    ]);

    res.json({
      success: true,
      data: {
        bloqueos_activos: bloqueos,
        estadisticas_bd:  deadlocks[0] ?? {},
        eventos_espera:   esperando,
        total_bloqueados: bloqueos.length,
      },
    });
  } catch (err) {
    logger.error(`[monitoreo] getBloqueos: ${err.message}`);
    res.status(500).json({ success:false, message:"Error al obtener bloqueos" });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/configuracion  ← NUEVO
// Parámetros clave de PostgreSQL con evaluación
// ══════════════════════════════════════════════════════════════════════════════
export async function getConfiguracion(req, res) {
  const client = await pool.connect();
  try {
    // Parámetros clave del servidor
    const params = [
      "shared_buffers", "work_mem", "maintenance_work_mem",
      "max_connections", "effective_cache_size", "checkpoint_completion_target",
      "wal_buffers", "default_statistics_target", "random_page_cost",
      "effective_io_concurrency", "max_worker_processes", "max_parallel_workers",
      "log_min_duration_statement", "autovacuum", "autovacuum_vacuum_threshold",
      "autovacuum_analyze_threshold",
    ];

    const rows = await safeQuery(client, `
      SELECT name, setting, unit, category, short_desc, min_val, max_val, boot_val
      FROM pg_settings
      WHERE name = ANY($1)
      ORDER BY category, name
    `, [params]);

    // Versión de PostgreSQL
    const version = await safeQuery(client, `SELECT version() AS v`);

    // Extensiones instaladas
    const extensiones = await safeQuery(client, `
      SELECT name, default_version, installed_version, comment
      FROM pg_available_extensions
      WHERE installed_version IS NOT NULL
      ORDER BY name
    `);

    // Evaluar configuración
    const evaluaciones = {};
    for (const r of rows) {
      let estado = "ok", recomendacion = null;
      if (r.name === "shared_buffers") {
        const mb = parseInt(r.setting) * (r.unit === "8kB" ? 8 : 1) / 1024;
        if (mb < 128) { estado = "advertencia"; recomendacion = "Aumentar a al menos 256MB (25% de RAM disponible)"; }
      }
      if (r.name === "max_connections") {
        const n = parseInt(r.setting);
        if (n > 200) { estado = "advertencia"; recomendacion = "Valores altos consumen más memoria. Considera usar PgBouncer."; }
      }
      if (r.name === "log_min_duration_statement") {
        const ms = parseInt(r.setting);
        if (ms === -1) { estado = "info"; recomendacion = "Considera habilitarlo (ej: 1000ms) para detectar queries lentas."; }
      }
      if (r.name === "autovacuum" && r.setting === "off") {
        estado = "critico"; recomendacion = "Autovacuum desactivado — activarlo es crítico para la salud de la BD.";
      }
      evaluaciones[r.name] = { estado, recomendacion };
    }

    res.json({
      success: true,
      data: { parametros: rows, evaluaciones, version: version[0]?.v ?? "—", extensiones },
    });
  } catch (err) {
    logger.error(`[monitoreo] getConfiguracion: ${err.message}`);
    res.status(500).json({ success:false, message:"Error al obtener configuración" });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/herramientas  ← NUEVO
// Catálogo de herramientas de monitoreo con estado
// ══════════════════════════════════════════════════════════════════════════════
export async function getHerramientas(req, res) {
  const client = await pool.connect();
  try {
    // Verificar qué vistas y extensiones están disponibles
    const [pgStatStatements, pgStatio, pgStatActivity, pgStatUserTables,
           pgStatUserIndexes, pgStatDatabase, pgLocks, pgBlocking] = await Promise.all([
      safeQuery(client, `SELECT count(*) AS c FROM pg_stat_statements LIMIT 1`),
      safeQuery(client, `SELECT count(*) AS c FROM pg_statio_user_tables LIMIT 1`),
      safeQuery(client, `SELECT count(*) AS c FROM pg_stat_activity LIMIT 1`),
      safeQuery(client, `SELECT count(*) AS c FROM pg_stat_user_tables LIMIT 1`),
      safeQuery(client, `SELECT count(*) AS c FROM pg_stat_user_indexes LIMIT 1`),
      safeQuery(client, `SELECT count(*) AS c FROM pg_stat_database LIMIT 1`),
      safeQuery(client, `SELECT count(*) AS c FROM pg_locks LIMIT 1`),
      safeQuery(client, `SELECT pg_blocking_pids(1) AS test`),
    ]);

    const herramientas = [
      {
        nombre:      "pg_stat_statements",
        tipo:        "extensión",
        categoria:   "Análisis de Queries",
        disponible:  pgStatStatements.length > 0,
        descripcion: "Registra estadísticas de ejecución de todas las sentencias SQL. Permite identificar las queries más lentas y frecuentes del sistema.",
        metricas:    ["Tiempo promedio de ejecución", "Número de llamadas", "Filas afectadas", "Tiempo total acumulado"],
        uso_en_panel:"Pestaña Queries — top 10 más lentas",
        sql_ejemplo: "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;",
      },
      {
        nombre:      "pg_stat_activity",
        tipo:        "vista del sistema",
        categoria:   "Conexiones y Procesos",
        disponible:  pgStatActivity.length > 0,
        descripcion: "Muestra una fila por cada proceso servidor activo. Incluye el estado, la query en ejecución, el usuario y los eventos de espera en tiempo real.",
        metricas:    ["Estado de la conexión", "Query en ejecución", "Tiempo de espera", "Evento de bloqueo"],
        uso_en_panel:"Pestaña Conexiones y Bloqueos",
        sql_ejemplo: "SELECT pid, state, query, wait_event FROM pg_stat_activity WHERE datname = current_database();",
      },
      {
        nombre:      "pg_statio_user_tables",
        tipo:        "vista del sistema",
        categoria:   "I/O y Cache",
        disponible:  pgStatio.length > 0,
        descripcion: "Estadísticas de I/O por tabla. Permite calcular el cache hit ratio comparando lecturas desde memoria (heap_blks_hit) vs disco (heap_blks_read).",
        metricas:    ["Cache hit ratio", "Bloques leídos de disco", "Bloques leídos desde cache", "I/O de índices"],
        uso_en_panel:"Pestaña Resumen — Cache Hit Ratio",
        sql_ejemplo: "SELECT relname, heap_blks_hit, heap_blks_read FROM pg_statio_user_tables;",
      },
      {
        nombre:      "pg_stat_user_tables",
        tipo:        "vista del sistema",
        categoria:   "Estado de Tablas",
        disponible:  pgStatUserTables.length > 0,
        descripcion: "Estadísticas de acceso y mantenimiento por tabla. Incluye conteo de scans secuenciales vs. por índice, filas vivas/muertas y fechas de VACUUM/ANALYZE.",
        metricas:    ["Filas vivas y muertas", "Scans secuenciales", "Scans por índice", "Última ejecución de VACUUM/ANALYZE"],
        uso_en_panel:"Pestaña Tablas — detalle completo",
        sql_ejemplo: "SELECT relname, n_live_tup, n_dead_tup, last_vacuum FROM pg_stat_user_tables;",
      },
      {
        nombre:      "pg_stat_user_indexes",
        tipo:        "vista del sistema",
        categoria:   "Índices",
        disponible:  pgStatUserIndexes.length > 0,
        descripcion: "Estadísticas de uso de índices. Permite detectar índices sin uso (idx_scan = 0) que desperdician espacio, y los más utilizados para optimización.",
        metricas:    ["Número de usos del índice", "Filas leídas mediante índice", "Tamaño del índice"],
        uso_en_panel:"Pestaña Índices — usados y sin uso",
        sql_ejemplo: "SELECT indexrelname, idx_scan, idx_tup_read FROM pg_stat_user_indexes ORDER BY idx_scan DESC;",
      },
      {
        nombre:      "pg_stat_database",
        tipo:        "vista del sistema",
        categoria:   "Estadísticas Globales",
        disponible:  pgStatDatabase.length > 0,
        descripcion: "Estadísticas globales por base de datos. Incluye transacciones confirmadas, rollbacks, deadlocks acumulados y estadísticas de I/O.",
        metricas:    ["Total commits y rollbacks", "Deadlocks históricos", "Tiempo de I/O", "Conflictos de replicación"],
        uso_en_panel:"Pestaña Resumen — transacciones y Bloqueos — deadlocks",
        sql_ejemplo: "SELECT xact_commit, xact_rollback, deadlocks FROM pg_stat_database WHERE datname = current_database();",
      },
      {
        nombre:      "pg_locks",
        tipo:        "vista del sistema",
        categoria:   "Bloqueos",
        disponible:  pgLocks.length > 0,
        descripcion: "Muestra información sobre los bloqueos activos en el servidor. Fundamental para detectar y resolver deadlocks y contención de recursos.",
        metricas:    ["Tipo de bloqueo", "Objeto bloqueado", "Modo de bloqueo", "Estado (granted/waiting)"],
        uso_en_panel:"Pestaña Bloqueos — procesos bloqueados",
        sql_ejemplo: "SELECT pid, locktype, mode, granted FROM pg_locks WHERE NOT granted;",
      },
      {
        nombre:      "pg_blocking_pids()",
        tipo:        "función del sistema",
        categoria:   "Bloqueos",
        disponible:  pgBlocking.length > 0,
        descripcion: "Función que retorna los PIDs que están bloqueando a un proceso dado. Simplifica enormemente la detección de cadenas de bloqueo.",
        metricas:    ["PID bloqueante", "Cadenas de bloqueo", "Deadlock circular"],
        uso_en_panel:"Pestaña Bloqueos — quién bloquea a quién",
        sql_ejemplo: "SELECT pid, pg_blocking_pids(pid) AS blocked_by FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;",
      },
      {
        nombre:      "VACUUM ANALYZE",
        tipo:        "comando SQL",
        categoria:   "Mantenimiento",
        disponible:  true,
        descripcion: "VACUUM recupera espacio ocupado por filas muertas (dead tuples). ANALYZE actualiza las estadísticas del planificador de queries para optimizar los planes de ejecución.",
        metricas:    ["Filas muertas eliminadas", "Espacio recuperado", "Estadísticas actualizadas"],
        uso_en_panel:"Pestañas Tablas y Alertas — botón VACUUM",
        sql_ejemplo: "VACUUM ANALYZE nombre_tabla;",
      },
      {
        nombre:      "REINDEX",
        tipo:        "comando SQL",
        categoria:   "Mantenimiento",
        disponible:  true,
        descripcion: "Reconstruye uno o más índices. Necesario cuando un índice está corrupto o muy inflado (bloated) por muchas actualizaciones/eliminaciones.",
        metricas:    ["Índice reconstruido", "Espacio optimizado", "Tiempo de reconstrucción"],
        uso_en_panel:"Pestaña Índices — botón REINDEX",
        sql_ejemplo: "REINDEX TABLE nombre_tabla;",
      },
    ];

    res.json({ success:true, data: herramientas });
  } catch (err) {
    logger.error(`[monitoreo] getHerramientas: ${err.message}`);
    res.status(500).json({ success:false, message:"Error al obtener herramientas" });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/monitoreo/historial  ← NUEVO
// ══════════════════════════════════════════════════════════════════════════════
export async function getHistorial(req, res) {
  try {
    await ensureHistorialTable();
    const rows = await pool.query(`
      SELECT h.id, h.tipo, h.tabla, h.alcance, h.duracion_ms,
             h.exitoso, h.error_msg, h.ejecutado_en,
             u.nombre_completo AS admin_nombre
      FROM monitoreo_historial h
      LEFT JOIN usuarios u ON h.id_admin = u.id_usuario
      ORDER BY h.ejecutado_en DESC
      LIMIT 100
    `);
    res.json({ success:true, data:rows.rows });
  } catch (err) {
    logger.error(`[monitoreo] getHistorial: ${err.message}`);
    res.status(500).json({ success:false, message:"Error al obtener historial" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/monitoreo/vacuum/:tabla
// ══════════════════════════════════════════════════════════════════════════════
export async function vacuumTabla(req, res) {
  const { tabla } = req.params;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tabla))
    return res.status(400).json({ success:false, message:"Nombre de tabla inválido" });

  const client = await pool.connect();
  try {
    const existe = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [tabla]);
    if (!existe.rows.length)
      return res.status(404).json({ success:false, message:`Tabla "${tabla}" no encontrada` });

    const t0 = Date.now();
    await client.query("COMMIT");
    await client.query(`VACUUM ANALYZE "${tabla}"`);
    const duracion = Date.now() - t0;

    const stats = await client.query(
      `SELECT n_live_tup AS filas_vivas, n_dead_tup AS filas_muertas, last_vacuum, last_analyze
       FROM pg_stat_user_tables WHERE relname = $1`, [tabla]);

    await registrarHistorial("vacuum", tabla, "individual", duracion, true, null, req.user?.id_usuario);
    logger.info(`[monitoreo] VACUUM ANALYZE "${tabla}" — ${duracion}ms | admin=${req.user?.id_usuario}`);

    res.json({ success:true, message:`VACUUM ANALYZE en "${tabla}" completado`,
      duracion_ms:duracion, stats:stats.rows[0] ?? null });
  } catch (err) {
    await registrarHistorial("vacuum", tabla, "individual", 0, false, err.message, req.user?.id_usuario);
    logger.error(`[monitoreo] vacuumTabla "${tabla}": ${err.message}`);
    res.status(500).json({ success:false, message:`Error al ejecutar VACUUM: ${err.message}` });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/monitoreo/vacuum-all
// ══════════════════════════════════════════════════════════════════════════════
export async function vacuumAll(req, res) {
  const client = await pool.connect();
  try {
    const tablas = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    if (!tablas.rows.length)
      return res.json({ success:true, message:"No hay tablas para procesar", resultados:[] });

    const t0 = Date.now();
    const resultados = [];
    await client.query("COMMIT");

    for (const { tablename } of tablas.rows) {
      const tTabla = Date.now();
      try {
        await client.query(`VACUUM ANALYZE "${tablename}"`);
        resultados.push({ tabla:tablename, ok:true, duracion:Date.now()-tTabla });
      } catch (err) {
        resultados.push({ tabla:tablename, ok:false, error:err.message, duracion:Date.now()-tTabla });
      }
    }

    const duracionTotal = Date.now() - t0;
    const exitosas      = resultados.filter(r => r.ok).length;

    await registrarHistorial("vacuum", null, "global", duracionTotal, exitosas > 0, null, req.user?.id_usuario);
    logger.info(`[monitoreo] VACUUM GLOBAL: ${exitosas} OK, ${duracionTotal}ms | admin=${req.user?.id_usuario}`);

    res.json({ success:true, message:`VACUUM ANALYZE global: ${exitosas} tablas procesadas`,
      duracion_ms:duracionTotal, tablas_ok:exitosas, tablas_error:resultados.filter(r=>!r.ok).length, resultados });
  } catch (err) {
    logger.error(`[monitoreo] vacuumAll: ${err.message}`);
    res.status(500).json({ success:false, message:`Error en VACUUM global: ${err.message}` });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/monitoreo/reindex/:tabla  ← NUEVO
// ══════════════════════════════════════════════════════════════════════════════
export async function reindexTabla(req, res) {
  const { tabla } = req.params;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tabla))
    return res.status(400).json({ success:false, message:"Nombre de tabla inválido" });

  const client = await pool.connect();
  try {
    const existe = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [tabla]);
    if (!existe.rows.length)
      return res.status(404).json({ success:false, message:`Tabla "${tabla}" no encontrada` });

    // Tamaño antes
    const antes = await client.query(
      `SELECT pg_indexes_size(quote_ident($1)::regclass) AS bytes`, [tabla]);

    const t0 = Date.now();
    await client.query("COMMIT");
    await client.query(`REINDEX TABLE "${tabla}"`);
    const duracion = Date.now() - t0;

    // Tamaño después
    const despues = await client.query(
      `SELECT pg_indexes_size(quote_ident($1)::regclass) AS bytes`, [tabla]);

    const bytesAntes   = parseInt(antes.rows[0]?.bytes ?? "0");
    const bytesDespues = parseInt(despues.rows[0]?.bytes ?? "0");
    const ahorrado     = bytesAntes - bytesDespues;

    await registrarHistorial("reindex", tabla, "individual", duracion, true, null, req.user?.id_usuario);
    logger.info(`[monitoreo] REINDEX "${tabla}" — ${duracion}ms | admin=${req.user?.id_usuario}`);

    res.json({
      success:     true,
      message:     `REINDEX en "${tabla}" completado`,
      duracion_ms: duracion,
      bytes_antes: bytesAntes,
      bytes_despues: bytesDespues,
      bytes_ahorrados: ahorrado,
    });
  } catch (err) {
    await registrarHistorial("reindex", tabla, "individual", 0, false, err.message, req.user?.id_usuario);
    logger.error(`[monitoreo] reindexTabla "${tabla}": ${err.message}`);
    res.status(500).json({ success:false, message:`Error al ejecutar REINDEX: ${err.message}` });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/monitoreo/kill-pid/:pid  ← NUEVO
// Termina una conexión bloqueada por su PID
// ══════════════════════════════════════════════════════════════════════════════
export async function killPid(req, res) {
  const pid = parseInt(req.params.pid);
  if (isNaN(pid) || pid <= 0)
    return res.status(400).json({ success:false, message:"PID inválido" });

  const client = await pool.connect();
  try {
    // Verificar que el proceso existe y NO es el nuestro
    const proc = await client.query(`
      SELECT pid, usename AS usuario, application_name AS app,
             state, LEFT(query, 100) AS query,
             EXTRACT(EPOCH FROM (now() - query_start))::int AS duracion_seg
      FROM pg_stat_activity
      WHERE pid = $1 AND pid <> pg_backend_pid()
        AND datname = current_database()
    `, [pid]);

    if (!proc.rows.length)
      return res.status(404).json({ success:false, message:`PID ${pid} no encontrado o no terminable` });

    const proceso = proc.rows[0];

    // Intentar terminación suave primero (pg_terminate_backend)
    const result = await client.query(`SELECT pg_terminate_backend($1) AS ok`, [pid]);
    const terminado = result.rows[0]?.ok === true;

    if (!terminado)
      return res.status(500).json({ success:false, message:`No se pudo terminar el PID ${pid}. Puede requerir permisos de superusuario.` });

    logger.info(`[monitoreo] Kill PID ${pid} (${proceso.usuario}) — admin=${req.user?.id_usuario}`);

    res.json({
      success:  true,
      message:  `Conexión PID ${pid} terminada correctamente`,
      proceso: {
        pid,
        usuario:    proceso.usuario,
        app:        proceso.app,
        state:      proceso.state,
        query:      proceso.query,
        duracion_seg: proceso.duracion_seg,
      },
    });
  } catch (err) {
    logger.error(`[monitoreo] killPid ${pid}: ${err.message}`);
    res.status(500).json({ success:false, message:`Error al terminar conexión: ${err.message}` });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/admin/monitoreo/indice/:nombre  ← NUEVO
// Elimina un índice sin uso
// ══════════════════════════════════════════════════════════════════════════════
export async function eliminarIndice(req, res) {
  const { nombre } = req.params;

  // Solo caracteres seguros para nombres de índice
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nombre))
    return res.status(400).json({ success:false, message:"Nombre de índice inválido" });

  const client = await pool.connect();
  try {
    // Verificar que existe y tiene idx_scan = 0 (realmente sin uso)
    const idx = await client.query(`
      SELECT i.indexrelname AS nombre, i.relname AS tabla,
             i.idx_scan, pg_relation_size(i.indexrelid) AS bytes,
             pg_size_pretty(pg_relation_size(i.indexrelid)) AS tamanio
      FROM pg_stat_user_indexes i
      WHERE i.indexrelname = $1
    `, [nombre]);

    if (!idx.rows.length)
      return res.status(404).json({ success:false, message:`Índice "${nombre}" no encontrado` });

    const indice = idx.rows[0];

    // Seguridad: no eliminar si tiene usos (por si el admin lo envía mal)
    if (parseInt(indice.idx_scan) > 0)
      return res.status(400).json({
        success:false,
        message:`El índice "${nombre}" tiene ${indice.idx_scan} usos activos. Solo se pueden eliminar índices con 0 usos.`,
      });

    // No eliminar primary keys ni unique constraints
    const esClave = await client.query(`
      SELECT 1 FROM pg_constraint
      WHERE conindid = (SELECT oid FROM pg_class WHERE relname = $1)
        AND contype IN ('p', 'u')
    `, [nombre]);

    if (esClave.rows.length)
      return res.status(400).json({ success:false, message:`"${nombre}" es una constraint (PK o UNIQUE) y no puede eliminarse desde aquí.` });

    const bytesLiberados = parseInt(indice.bytes);

    await client.query(`DROP INDEX IF EXISTS "${nombre}"`);

    logger.info(`[monitoreo] DROP INDEX "${nombre}" (${indice.tamanio}, tabla: ${indice.tabla}) — admin=${req.user?.id_usuario}`);

    res.json({
      success:          true,
      message:          `Índice "${nombre}" eliminado correctamente`,
      tabla:            indice.tabla,
      bytes_liberados:  bytesLiberados,
      tamanio_liberado: indice.tamanio,
    });
  } catch (err) {
    logger.error(`[monitoreo] eliminarIndice "${nombre}": ${err.message}`);
    res.status(500).json({ success:false, message:`Error al eliminar índice: ${err.message}` });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/monitoreo/analizar-ia  ← NUEVO
// Manda métricas a Claude y devuelve análisis y recomendaciones
// ══════════════════════════════════════════════════════════════════════════════
export async function analizarConIA(req, res) {
  const client = await pool.connect();
  try {
    // Recopilar todas las métricas actuales
    const [cacheHit, tablas, conexiones, indices, bloqueos, txRate, version] = await Promise.all([
      safeQuery(client, `SELECT ROUND(sum(heap_blks_hit)::numeric / NULLIF(sum(heap_blks_hit)+sum(heap_blks_read),0)*100,2) AS ratio FROM pg_statio_user_tables`),
      safeQuery(client, `SELECT relname, n_live_tup, n_dead_tup, seq_scan, idx_scan, pg_size_pretty(pg_total_relation_size(relid)) AS size FROM pg_stat_user_tables ORDER BY n_dead_tup DESC, seq_scan DESC LIMIT 10`),
      safeQuery(client, `SELECT state, count(*) AS total FROM pg_stat_activity WHERE datname=current_database() GROUP BY state`),
      safeQuery(client, `SELECT indexrelname, relname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_stat_user_indexes WHERE idx_scan=0 AND indexrelname NOT LIKE '%pkey%' ORDER BY pg_relation_size(indexrelid) DESC LIMIT 10`),
      safeQuery(client, `SELECT count(*) AS bloqueados FROM pg_stat_activity WHERE wait_event_type='Lock' AND datname=current_database()`),
      safeQuery(client, `SELECT xact_commit, xact_rollback, deadlocks FROM pg_stat_database WHERE datname=current_database()`),
      safeQuery(client, `SELECT version() AS v`),
    ]);

    const memPct = Math.round(((os.totalmem()-os.freemem())/os.totalmem())*100);

    // Construir resumen de métricas para el prompt
    const metricas = {
      version_postgres: version[0]?.v ?? "desconocida",
      cache_hit_ratio:  cacheHit[0]?.ratio ?? "N/A",
      memoria_servidor_pct: memPct,
      conexiones: conexiones,
      bloqueos_activos: parseInt(bloqueos[0]?.bloqueados ?? "0"),
      transacciones: txRate[0] ?? {},
      top_tablas_problematicas: tablas,
      indices_sin_uso: indices,
    };

    const prompt = `Eres un experto en administración de bases de datos PostgreSQL. Analiza estas métricas de rendimiento de una base de datos de una galería de arte (Galería Altar) y genera un reporte profesional en español.

MÉTRICAS ACTUALES:
${JSON.stringify(metricas, null, 2)}

Genera un análisis con este formato exacto en JSON (sin markdown, solo JSON puro):
{
  "estado_general": "excelente|bueno|regular|critico",
  "puntuacion": <número del 0 al 100>,
  "resumen": "<2-3 oraciones resumiendo el estado general>",
  "hallazgos": [
    {
      "nivel": "critico|advertencia|info|ok",
      "categoria": "<categoria>",
      "titulo": "<titulo corto>",
      "detalle": "<explicación técnica en español>",
      "accion": "<acción recomendada concreta>"
    }
  ],
  "recomendaciones_prioritarias": [
    "<recomendación 1 con acción específica>",
    "<recomendación 2>",
    "<recomendación 3>"
  ],
  "optimizaciones_sql": [
    {
      "descripcion": "<qué hace este SQL>",
      "sql": "<query SQL ejecutable>"
    }
  ]
}`;

    // Llamar a Claude API
    const iaRes = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-opus-4-5",
        max_tokens: 2000,
        messages:   [{ role:"user", content:prompt }],
      }),
    });

    if (!iaRes.ok) {
      const errBody = await iaRes.text();
      logger.error(`[monitoreo] Claude API error: ${iaRes.status} — ${errBody}`);
      return res.status(502).json({ success:false, message:"Error al conectar con el servicio de IA. Verifica ANTHROPIC_API_KEY." });
    }

    const iaJson = await iaRes.json();
    const rawText = iaJson.content?.[0]?.text ?? "{}";

    let analisis;
    try {
      analisis = JSON.parse(rawText);
    } catch {
      // Si no es JSON puro, extraerlo
      const match = rawText.match(/\{[\s\S]*\}/);
      analisis = match ? JSON.parse(match[0]) : { error:"No se pudo parsear la respuesta" };
    }

    logger.info(`[monitoreo] Análisis IA ejecutado — admin=${req.user?.id_usuario}, estado=${analisis.estado_general}`);

    res.json({
      success:         true,
      analisis,
      metricas_usadas: metricas,
      generado_en:     new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[monitoreo] analizarConIA: ${err.message}`);
    res.status(500).json({ success:false, message:`Error en análisis IA: ${err.message}` });
  } finally { client.release(); }
}