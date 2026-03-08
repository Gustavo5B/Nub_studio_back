// controllers/backupController.js
import { pool }         from "../config/db.js";
import { createClient } from "@supabase/supabase-js";
import crypto           from "crypto";
import cron             from "node-cron";

const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET      = "backups";
const MAX_BACKUPS = 3;

// ── Descubrir y ordenar tablas (topological sort por FK) ──────────────────────
async function descubrirTablas(client) {
  const { rows: tablas } = await client.query(`
    SELECT tablename AS nombre FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT IN ('schema_migrations','spatial_ref_sys','geography_columns','geometry_columns')
    ORDER BY tablename
  `);
  if (!tablas.length) return [];
  const nombres = tablas.map(t => t.nombre);
  const { rows: fks } = await client.query(`
    SELECT DISTINCT tc.table_name AS tabla_origen, ccu.table_name AS tabla_destino
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      AND ccu.table_name != tc.table_name
  `);
  const nombreSet = new Set(nombres);
  const grafo = {}, inDegree = {};
  for (const n of nombres) { grafo[n] = []; inDegree[n] = 0; }
  for (const { tabla_origen, tabla_destino } of fks) {
    if (nombreSet.has(tabla_origen) && nombreSet.has(tabla_destino) && tabla_destino !== tabla_origen) {
      grafo[tabla_destino].push(tabla_origen);
      inDegree[tabla_origen]++;
    }
  }
  const cola = nombres.filter(n => inDegree[n] === 0).sort();
  const orden = [];
  while (cola.length) {
    cola.sort();
    const actual = cola.shift();
    orden.push(actual);
    for (const dep of grafo[actual]) { if (--inDegree[dep] === 0) cola.push(dep); }
  }
  const enOrden = new Set(orden);
  for (const n of nombres) { if (!enOrden.has(n)) orden.push(n); }
  return orden;
}

// ── Resolver qué tablas respaldar, respetando orden topológico ────────────────
// tablasDeseadas = null | [] → todas las tablas (backup completo)
// tablasDeseadas = ["obras","artistas"] → solo esas, en orden correcto
async function resolverTablas(client, tablasDeseadas) {
  const todasOrdenadas = await descubrirTablas(client);
  if (!tablasDeseadas || !tablasDeseadas.length) return todasOrdenadas;
  const set = new Set(tablasDeseadas);
  return todasOrdenadas.filter(t => set.has(t));
}

function escaparValor(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number")  return String(val);
  if (val instanceof Date)      return `'${val.toISOString()}'`;
  const str = String(val).replace(/\\/g,"\\\\").replace(/'/g,"''").replace(/\0/g,"\\0");
  return `'${str}'`;
}

async function obtenerEsquemaTabla(client, tabla) {
  try {
    const colRes = await client.query(`
      SELECT c.column_name, c.data_type, c.character_maximum_length,
        c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default, c.udt_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = $1 ORDER BY c.ordinal_position
    `, [tabla]);
    if (!colRes.rows.length) return null;
    const conRes = await client.query(`
      SELECT tc.constraint_name, tc.constraint_type,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public' AND tc.table_name = $1
        AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
      GROUP BY tc.constraint_name, tc.constraint_type
    `, [tabla]);
    const fkRes = await client.query(`
      SELECT tc.constraint_name, kcu.column_name,
        ccu.table_name AS foreign_table, ccu.column_name AS foreign_column,
        rc.delete_rule, rc.update_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'
    `, [tabla]);
    const cols = colRes.rows.map(col => {
      const def = col.column_default || "";
      if (def.startsWith("nextval(")) return `  "${col.column_name}" ${col.data_type === "bigint" ? "BIGSERIAL" : "SERIAL"}`;
      let tipo =
        col.udt_name === "varchar" || col.data_type === "character varying"
          ? `VARCHAR${col.character_maximum_length ? `(${col.character_maximum_length})` : ""}`
        : col.data_type === "numeric" ? `NUMERIC${col.numeric_precision ? `(${col.numeric_precision},${col.numeric_scale ?? 0})` : ""}`
        : col.udt_name === "int4" || col.data_type === "integer" ? "INTEGER"
        : col.udt_name === "int8" || col.data_type === "bigint"  ? "BIGINT"
        : col.udt_name === "bool" || col.data_type === "boolean" ? "BOOLEAN"
        : col.data_type === "text" ? "TEXT"
        : col.data_type === "timestamp without time zone" ? "TIMESTAMP"
        : col.data_type === "timestamp with time zone"    ? "TIMESTAMPTZ"
        : col.data_type === "date"  ? "DATE"
        : col.data_type === "jsonb" ? "JSONB"
        : col.data_type === "json"  ? "JSON"
        : col.data_type === "uuid"  ? "UUID"
        : col.udt_name.startsWith("_") ? col.udt_name.slice(1).toUpperCase() + "[]"
        : col.data_type.toUpperCase();
      let linea = `  "${col.column_name}" ${tipo}`;
      if (col.is_nullable === "NO") linea += " NOT NULL";
      if (def) linea += ` DEFAULT ${def}`;
      return linea;
    });
    const pks = conRes.rows.filter(c => c.constraint_type === "PRIMARY KEY");
    if (pks.length) cols.push(`  CONSTRAINT "${pks[0].constraint_name}" PRIMARY KEY (${pks[0].columns.split(", ").map(c => `"${c}"`).join(", ")})`);
    conRes.rows.filter(c => c.constraint_type === "UNIQUE").forEach(u =>
      cols.push(`  CONSTRAINT "${u.constraint_name}" UNIQUE (${u.columns.split(", ").map(c => `"${c}"`).join(", ")})`)
    );
    fkRes.rows.forEach(fk => {
      let l = `  CONSTRAINT "${fk.constraint_name}" FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table}" ("${fk.foreign_column}")`;
      if (fk.delete_rule && fk.delete_rule !== "NO ACTION") l += ` ON DELETE ${fk.delete_rule}`;
      if (fk.update_rule && fk.update_rule !== "NO ACTION") l += ` ON UPDATE ${fk.update_rule}`;
      cols.push(l);
    });
    return `CREATE TABLE IF NOT EXISTS "${tabla}" (\n${cols.join(",\n")}\n);`;
  } catch (err) { return `-- ERROR esquema ${tabla}: ${err.message}`; }
}

async function obtenerIndices(client, tabla) {
  try {
    const res = await client.query(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
        AND indexname NOT IN (
          SELECT constraint_name FROM information_schema.table_constraints
          WHERE table_name = $1 AND table_schema = 'public'
        )
    `, [tabla]);
    return res.rows.map(r => r.indexdef + ";").join("\n");
  } catch { return ""; }
}

async function resetSecuencia(client, tabla) {
  try {
    const res = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_default LIKE 'nextval%'
    `, [tabla]);
    if (!res.rows.length) return "";
    const col = res.rows[0].column_name;
    return `SELECT setval('public.${tabla}_${col}_seq', COALESCE((SELECT MAX("${col}") FROM "${tabla}"), 1));`;
  } catch { return ""; }
}

function checksum(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

async function subirAStorage(nombreArchivo, buffer) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(nombreArchivo, buffer, { contentType: "application/octet-stream", upsert: false });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const { data, error: urlError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(nombreArchivo, 60 * 60 * 24 * 7);
  if (urlError) throw new Error(`Signed URL: ${urlError.message}`);
  return data.signedUrl;
}

async function limpiarBackupsAntiguos(client) {
  try {
    const { rows: antiguos } = await client.query(`
      SELECT id, nombre_archivo FROM backups_historial
      WHERE url_archivo IS NOT NULL
        AND id NOT IN (
          SELECT id FROM backups_historial
          WHERE url_archivo IS NOT NULL
          ORDER BY fecha DESC LIMIT $1
        )
    `, [MAX_BACKUPS]);
    if (!antiguos.length) return;
    const archivos = antiguos.map(r => r.nombre_archivo).filter(Boolean);
    if (archivos.length) {
      const { error } = await supabase.storage.from(BUCKET).remove(archivos);
      if (error) console.warn("Storage remove warning:", error.message);
    }
    await client.query(`DELETE FROM backups_historial WHERE id = ANY($1::int[])`, [antiguos.map(r => r.id)]);
    console.log(`[backup] Limpieza: ${antiguos.length} backup(s) eliminado(s)`);
  } catch (err) {
    console.warn("[backup] Error en limpieza:", err.message);
  }
}

async function guardarHistorial(client, adminId, stats) {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS backups_historial (
        id SERIAL PRIMARY KEY,
        id_admin INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
        fecha TIMESTAMPTZ DEFAULT NOW(),
        tablas INTEGER, filas_total INTEGER, tamanio_bytes BIGINT,
        duracion_ms INTEGER, checksum_md5 VARCHAR(32),
        nombre_archivo VARCHAR(200), url_archivo TEXT
      )
    `);
    await client.query(`ALTER TABLE backups_historial ADD COLUMN IF NOT EXISTS url_archivo TEXT`).catch(() => {});
    await client.query(`
      INSERT INTO backups_historial
        (id_admin, tablas, filas_total, tamanio_bytes, duracion_ms, checksum_md5, nombre_archivo, url_archivo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [adminId, stats.tablas, stats.filas, stats.bytes, stats.ms, stats.md5, stats.archivo, stats.url]);
  } catch (err) { console.warn("Historial backup no guardado:", err.message); }
}

// ── Core: construir SQL para un set de tablas ─────────────────────────────────
async function construirSQL(client, tablasSeleccionadas, label = "Respaldo completo") {
  const ahora = new Date();
  let sql = "", filasTotal = 0, tablasOk = 0;
  const esquemas = {};

  sql += `-- =============================================\n-- Nu-B Studio — ${label}\n-- Fecha: ${ahora.toLocaleString("es-MX")}\n-- Tablas: ${tablasSeleccionadas.join(", ")}\n-- =============================================\n\n`;
  sql += `SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\nSET check_function_bodies = false;\nSET client_min_messages = warning;\n\n`;
  sql += `-- =============================================\n-- SECCIÓN 1: ESQUEMA\n-- =============================================\n\n`;

  for (const tabla of tablasSeleccionadas) {
    const esq = await obtenerEsquemaTabla(client, tabla);
    if (!esq) continue;
    esquemas[tabla] = true;
    sql += `-- Tabla: ${tabla}\nDROP TABLE IF EXISTS "${tabla}" CASCADE;\n${esq}\n\n`;
    const idx = await obtenerIndices(client, tabla);
    if (idx) sql += idx + "\n\n";
  }

  sql += `-- =============================================\n-- SECCIÓN 2: DATOS\n-- =============================================\n\n`;
  for (const tabla of tablasSeleccionadas) {
    if (!esquemas[tabla]) continue;
    let conteo = 0;
    try { const r = await client.query(`SELECT COUNT(*) FROM "${tabla}"`); conteo = parseInt(r.rows[0].count, 10); }
    catch { sql += `-- Tabla: ${tabla} (no accesible)\n\n`; continue; }
    tablasOk++;
    sql += `-- Tabla: ${tabla} (${conteo} filas)\n`;
    if (!conteo) { sql += `-- (sin datos)\n`; }
    else {
      try {
        const colRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [tabla]);
        const cols = colRes.rows.map(r => `"${r.column_name}"`);
        const LOTE = 500;
        for (let off = 0; off < conteo; off += LOTE) {
          const data = await client.query(`SELECT * FROM "${tabla}" ORDER BY 1 LIMIT ${LOTE} OFFSET ${off}`);
          if (!data.rows.length) break;
          sql += `INSERT INTO "${tabla}" (${cols.join(", ")}) VALUES\n`;
          sql += data.rows.map(row => `  (${Object.values(row).map(escaparValor).join(", ")})`).join(",\n");
          sql += `\nON CONFLICT DO NOTHING;\n`;
        }
        filasTotal += conteo;
      } catch (err) { sql += `-- ERROR datos ${tabla}: ${err.message}\n`; }
    }
    const seq = await resetSecuencia(client, tabla);
    if (seq) sql += seq + "\n";
    sql += "\n";
  }

  const md5 = checksum(sql), bytes = Buffer.byteLength(sql, "utf8");
  sql += `-- Tablas: ${tablasOk} | Filas: ${filasTotal} | MD5: ${md5}\n`;
  return { sql, filasTotal, tablasOk, md5, bytes };
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR: Generar backup  POST /api/admin/backup
//
// Body opcional: { tablas: ["obras", "artistas", ...] }
//   Sin body / tablas vacío  → backup COMPLETO de toda la base
//   Con tablas               → backup SELECTIVO solo de esas tablas
// ══════════════════════════════════════════════════════════════════════════════
async function generarBackup(req, res) {
  const t0      = Date.now();
  const adminId = req.user?.id_usuario ?? req.user?.sub ?? null;
  const { tablas: tablasBody } = req.body || {};

  const client = await pool.connect();
  try {
    // resolverTablas respeta orden topológico y aplica el filtro si viene
    const tablasABackup = await resolverTablas(client, tablasBody);
    if (!tablasABackup.length)
      return res.status(400).json({ success: false, message: "No se encontraron tablas válidas" });

    const esSelectivo = Array.isArray(tablasBody) && tablasBody.length > 0;
    const label  = esSelectivo
      ? `Respaldo selectivo (${tablasABackup.length} tablas)`
      : "Respaldo completo";
    const ahora  = new Date();
    const ts     = ahora.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const archivo = esSelectivo
      ? `nub-studio-backup-selectivo-${ts}.sql`
      : `nub-studio-backup-${ts}.sql`;

    const { sql, filasTotal, tablasOk, md5, bytes } = await construirSQL(client, tablasABackup, label);
    const ms  = Date.now() - t0;
    const buf = Buffer.from(sql, "utf8");

    let urlArchivo = null;
    try { urlArchivo = await subirAStorage(archivo, buf); console.log(`[backup] Subido: ${archivo}`); }
    catch (err) { console.warn("[backup] No se pudo subir:", err.message); }

    await guardarHistorial(client, adminId, { tablas: tablasOk, filas: filasTotal, bytes, ms, md5, archivo, url: urlArchivo });

    // Limpieza automática solo en backups completos
    if (!esSelectivo) await limpiarBackupsAntiguos(client);

    res.setHeader("Content-Type",        "application/sql");
    res.setHeader("Content-Disposition", `attachment; filename="${archivo}"`);
    res.setHeader("Content-Length",      buf.length);
    res.setHeader("X-Backup-Checksum",   md5);
    res.setHeader("X-Backup-Tables",     tablasOk);
    res.setHeader("X-Backup-Rows",       filasTotal);
    res.setHeader("X-Backup-Duration",   ms);
    if (urlArchivo) res.setHeader("X-Backup-Url", urlArchivo);
    return res.status(200).send(buf);
  } catch (err) {
    console.error("Error backup:", err);
    return res.status(500).json({ success: false, message: "Error al generar el respaldo", error: err.message });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR: Salud de tablas  GET /api/admin/backups/tablas
// ══════════════════════════════════════════════════════════════════════════════
async function obtenerSaludTablas(req, res) {
  const client = await pool.connect();
  try {
    const tablas = await descubrirTablas(client);
    const resultados = await Promise.all(tablas.map(async (tabla) => {
      try {
        const [countRes, sizeRes] = await Promise.all([
          client.query(`SELECT COUNT(*) AS filas FROM "${tabla}"`),
          client.query(`SELECT pg_relation_size($1::regclass) AS bytes`, [`public.${tabla}`]),
        ]);
        return { tabla, filas: parseInt(countRes.rows[0].filas, 10), bytes: parseInt(sizeRes.rows[0].bytes, 10) || 0 };
      } catch { return { tabla, filas: 0, bytes: 0 }; }
    }));
    resultados.sort((a, b) => b.filas - a.filas);
    return res.json({
      success: true,
      data: {
        tablas:     resultados,
        totalFilas: resultados.reduce((s, r) => s + r.filas, 0),
        totalBytes: resultados.reduce((s, r) => s + r.bytes, 0),
        numTablas:  resultados.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Error al obtener salud de tablas" });
  } finally { client.release(); }
}

// ── Helper: crear / migrar tabla config cron ──────────────────────────────────
async function ensureConfigCronTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_config_cron (
      id             SERIAL PRIMARY KEY,
      activo         BOOLEAN DEFAULT FALSE,
      frecuencia     VARCHAR(20) DEFAULT 'diario',
      hora           INTEGER DEFAULT 2,
      dia_semana     INTEGER DEFAULT 1,
      tablas         JSONB DEFAULT NULL,
      ultimo_cron    TIMESTAMPTZ,
      proximo_cron   TIMESTAMPTZ,
      id_admin       INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
      actualizado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Migración: agregar columna tablas si viene de versión anterior
  await pool.query(`ALTER TABLE backup_config_cron ADD COLUMN IF NOT EXISTS tablas JSONB DEFAULT NULL`).catch(() => {});
  // Registro por defecto
  await pool.query(`
    INSERT INTO backup_config_cron (activo, frecuencia, hora, dia_semana)
    SELECT FALSE, 'diario', 2, 1
    WHERE NOT EXISTS (SELECT 1 FROM backup_config_cron)
  `);
}

let cronJob = null;

function calcularProximoCron(frecuencia, hora, diaSemana) {
  const ahora = new Date(), prox = new Date();
  prox.setHours(hora, 0, 0, 0);
  if (frecuencia === "diario") {
    if (prox <= ahora) prox.setDate(prox.getDate() + 1);
  } else if (frecuencia === "semanal") {
    const hoy  = ahora.getDay();
    let diff   = (diaSemana - hoy + 7) % 7;
    if (diff === 0 && prox <= ahora) diff = 7;
    prox.setDate(prox.getDate() + diff);
  } else if (frecuencia === "mensual") {
    prox.setDate(1);
    if (prox <= ahora) { prox.setMonth(prox.getMonth() + 1); prox.setDate(1); }
  }
  return prox;
}

function buildCronExpression(frecuencia, hora, diaSemana) {
  if (frecuencia === "semanal") return `0 ${hora} * * ${diaSemana}`;
  if (frecuencia === "mensual") return `0 ${hora} 1 * *`;
  return `0 ${hora} * * *`;
}

// ── Ejecutar backup automático ────────────────────────────────────────────────
// Lee la columna `tablas` del config para decidir completo vs selectivo
async function ejecutarBackupAutomatico() {
  console.log("[cron] Iniciando backup automático...");
  const client = await pool.connect();
  try {
    const { rows } = await pool.query(`SELECT tablas FROM backup_config_cron LIMIT 1`);
    const tablasConfig = rows[0]?.tablas ?? null; // null = completo

    const tablasABackup = await resolverTablas(client, tablasConfig);
    const esSelectivo   = Array.isArray(tablasConfig) && tablasConfig.length > 0;
    const label = esSelectivo
      ? `Backup automático selectivo (${tablasABackup.length} tablas)`
      : "Backup automático completo";

    const ahora   = new Date();
    const ts      = ahora.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const archivo = `nub-studio-backup-auto-${ts}.sql`;
    const t0      = Date.now();

    const { sql, filasTotal, tablasOk, md5, bytes } = await construirSQL(client, tablasABackup, label);
    const ms  = Date.now() - t0;
    const buf = Buffer.from(sql, "utf8");

    let urlArchivo = null;
    try { urlArchivo = await subirAStorage(archivo, buf); }
    catch (err) { console.warn("[cron] Storage:", err.message); }

    await guardarHistorial(client, null, { tablas: tablasOk, filas: filasTotal, bytes, ms, md5, archivo, url: urlArchivo });
    await limpiarBackupsAntiguos(client);
    await pool.query(`UPDATE backup_config_cron SET ultimo_cron = NOW() WHERE id = 1`);
    console.log(`[cron] OK: ${archivo} | ${tablasOk} tablas | ${filasTotal} filas | ${ms}ms`);
  } catch (err) {
    console.error("[cron] Error:", err.message);
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR: Obtener config cron  GET /api/admin/backups/cron
// ══════════════════════════════════════════════════════════════════════════════
async function obtenerConfigCron(req, res) {
  try {
    await ensureConfigCronTable();
    const { rows } = await pool.query(`SELECT * FROM backup_config_cron LIMIT 1`);
    const config   = rows[0] || { activo: false, frecuencia: "diario", hora: 2, dia_semana: 1, tablas: null };
    return res.json({
      success: true,
      data: {
        id:                config.id,
        activo:            config.activo && cronJob !== null,
        frecuencia:        config.frecuencia,
        hora:              config.hora,
        dia_semana:        config.dia_semana,
        tablas:            config.tablas ?? null,
        ultima_ejecucion:  config.ultimo_cron ?? null,
        proxima_ejecucion: config.activo
          ? calcularProximoCron(config.frecuencia, config.hora, config.dia_semana)
          : null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Error al obtener configuración" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR: Guardar config cron  POST /api/admin/backups/cron
// Body: { activo, frecuencia, hora, dia_semana, tablas }
//   tablas: null | [] → cron hará backup completo
//   tablas: ["obras","artistas"] → cron hará backup selectivo
// ══════════════════════════════════════════════════════════════════════════════
async function guardarConfigCron(req, res) {
  const adminId = req.user?.id_usuario ?? null;
  const { activo, frecuencia, hora, dia_semana, tablas } = req.body || {};

  if (!["diario","semanal","mensual"].includes(frecuencia))
    return res.status(400).json({ success: false, message: "Frecuencia inválida" });
  if (hora < 0 || hora > 23)
    return res.status(400).json({ success: false, message: "Hora inválida (0-23)" });

  // Array vacío equivale a "backup completo" → guardar null
  const tablasAGuardar = Array.isArray(tablas) && tablas.length > 0 ? tablas : null;

  try {
    await ensureConfigCronTable();
    await pool.query(`
      UPDATE backup_config_cron SET
        activo         = $1,
        frecuencia     = $2,
        hora           = $3,
        dia_semana     = $4,
        tablas         = $5,
        id_admin       = $6,
        actualizado_en = NOW()
      WHERE id = 1
    `, [activo, frecuencia, hora, dia_semana ?? 1, tablasAGuardar ? JSON.stringify(tablasAGuardar) : null, adminId]);

    if (cronJob) { cronJob.stop(); cronJob = null; }
    if (activo) {
      const expr = buildCronExpression(frecuencia, hora, dia_semana ?? 1);
      cronJob    = cron.schedule(expr, ejecutarBackupAutomatico, { timezone: "America/Mexico_City" });
      console.log(`[cron] Programado: ${expr} — ${tablasAGuardar ? `${tablasAGuardar.length} tablas` : "completo"}`);
    }

    const proximo = activo ? calcularProximoCron(frecuencia, hora, dia_semana ?? 1) : null;
    return res.json({
      success: true,
      message: activo ? "Backup automático activado" : "Backup automático desactivado",
      data: { activo, frecuencia, hora, dia_semana, tablas: tablasAGuardar, proxima_ejecucion: proximo },
    });
  } catch (err) {
    console.error("Error guardar config cron:", err);
    return res.status(500).json({ success: false, message: "Error al guardar configuración" });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR: Historial
// ══════════════════════════════════════════════════════════════════════════════
async function obtenerHistorial(req, res) {
  try {
    const result = await pool.query(`
      SELECT bh.id, bh.fecha, bh.tablas, bh.filas_total,
        bh.tamanio_bytes, bh.duracion_ms, bh.checksum_md5,
        bh.nombre_archivo, bh.url_archivo,
        u.nombre_completo AS admin_nombre
      FROM backups_historial bh
      LEFT JOIN usuarios u ON bh.id_admin = u.id_usuario
      WHERE bh.url_archivo IS NOT NULL
      ORDER BY bh.fecha DESC
      LIMIT $1
    `, [MAX_BACKUPS]);
    return res.json({ success: true, data: result.rows });
  } catch {
    return res.json({ success: true, data: [] });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR: Eliminar backup
// ══════════════════════════════════════════════════════════════════════════════
async function eliminarBackup(req, res) {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT nombre_archivo FROM backups_historial WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Backup no encontrado" });
    const { nombre_archivo } = rows[0];
    if (nombre_archivo) {
      const { error } = await supabase.storage.from(BUCKET).remove([nombre_archivo]);
      if (error) console.warn(`[backup] Storage remove:`, error.message);
    }
    await client.query(`DELETE FROM backups_historial WHERE id = $1`, [id]);
    return res.json({ success: true, message: "Backup eliminado correctamente" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Error al eliminar", error: err.message });
  } finally { client.release(); }
}

// ══════════════════════════════════════════════════════════════════════════════
// INIT: Restaurar cron al arrancar el servidor → importar y llamar en server.js
// ══════════════════════════════════════════════════════════════════════════════
async function iniciarCron() {
  try {
    await ensureConfigCronTable();
    const { rows } = await pool.query(`SELECT * FROM backup_config_cron LIMIT 1`);
    const config   = rows[0];
    if (!config?.activo) return;
    const expr = buildCronExpression(config.frecuencia, config.hora, config.dia_semana);
    cronJob    = cron.schedule(expr, ejecutarBackupAutomatico, { timezone: "America/Mexico_City" });
    console.log(`[cron] Restaurado: ${expr} — ${config.tablas ? `${config.tablas.length} tablas selectivas` : "backup completo"}`);
  } catch (err) {
    console.warn("[cron] No se pudo restaurar:", err.message);
  }
}

export {
  generarBackup,
  obtenerSaludTablas,
  obtenerHistorial,
  eliminarBackup,
  obtenerConfigCron,
  guardarConfigCron,
  iniciarCron,
};