// controllers/backupController.js
// Respaldo completo: esquema + datos, con historial guardado en BD

import { pool } from "../config/db.js";
import crypto   from "crypto";

// ── Descubrir y ordenar tablas automáticamente (topological sort por FK) ──
async function descubrirTablas(client) {
  const { rows: tablas } = await client.query(`
    SELECT tablename AS nombre
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT IN ('schema_migrations','spatial_ref_sys','geography_columns','geometry_columns')
    ORDER BY tablename
  `);

  if (tablas.length === 0) return [];

  const nombres = tablas.map(t => t.nombre);

  const { rows: fks } = await client.query(`
    SELECT DISTINCT
      tc.table_name  AS tabla_origen,
      ccu.table_name AS tabla_destino
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema   = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema    = 'public'
      AND ccu.table_name    != tc.table_name
  `);

  const nombreSet = new Set(nombres);
  const grafo     = {};
  const inDegree  = {};

  for (const n of nombres) { grafo[n] = []; inDegree[n] = 0; }

  for (const { tabla_origen, tabla_destino } of fks) {
    if (nombreSet.has(tabla_origen) && nombreSet.has(tabla_destino) && tabla_destino !== tabla_origen) {
      grafo[tabla_destino].push(tabla_origen);
      inDegree[tabla_origen]++;
    }
  }

  const cola  = nombres.filter(n => inDegree[n] === 0).sort();
  const orden = [];

  while (cola.length > 0) {
    cola.sort();
    const actual = cola.shift();
    orden.push(actual);
    for (const dep of grafo[actual]) {
      inDegree[dep]--;
      if (inDegree[dep] === 0) cola.push(dep);
    }
  }

  const enOrden = new Set(orden);
  for (const n of nombres) { if (!enOrden.has(n)) orden.push(n); }

  return orden;
}

// ── Escapar valores SQL ────────────────────────────────────────────────────
function escaparValor(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number")  return String(val);
  if (val instanceof Date)      return `'${val.toISOString()}'`;
  const str = String(val)
    .replace(/\\/g, "\\\\")
    .replace(/'/g,  "''")
    .replace(/\0/g, "\\0");
  return `'${str}'`;
}

// ── Obtener esquema de una tabla ───────────────────────────────────────────
async function obtenerEsquemaTabla(client, tabla) {
  try {
    const colRes = await client.query(`
      SELECT
        c.column_name, c.data_type, c.character_maximum_length,
        c.numeric_precision, c.numeric_scale, c.is_nullable,
        c.column_default, c.udt_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = $1
      ORDER BY c.ordinal_position
    `, [tabla]);

    if (colRes.rows.length === 0) return null;

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
      if (def.startsWith("nextval(")) {
        const tipo = col.data_type === "bigint" ? "BIGSERIAL" : "SERIAL";
        return `  "${col.column_name}" ${tipo}`;
      }
      let tipo =
        col.udt_name === "varchar" || col.data_type === "character varying"
          ? `VARCHAR${col.character_maximum_length ? `(${col.character_maximum_length})` : ""}`
        : col.data_type === "numeric"
          ? `NUMERIC${col.numeric_precision ? `(${col.numeric_precision},${col.numeric_scale ?? 0})` : ""}`
        : col.udt_name === "int4" || col.data_type === "integer" ? "INTEGER"
        : col.udt_name === "int8" || col.data_type === "bigint"  ? "BIGINT"
        : col.udt_name === "bool" || col.data_type === "boolean" ? "BOOLEAN"
        : col.data_type === "text"        ? "TEXT"
        : col.data_type === "timestamp without time zone" ? "TIMESTAMP"
        : col.data_type === "timestamp with time zone"    ? "TIMESTAMPTZ"
        : col.data_type === "date"   ? "DATE"
        : col.data_type === "jsonb"  ? "JSONB"
        : col.data_type === "json"   ? "JSON"
        : col.data_type === "uuid"   ? "UUID"
        : col.udt_name.startsWith("_") ? col.udt_name.slice(1).toUpperCase() + "[]"
        : col.data_type.toUpperCase();

      let linea = `  "${col.column_name}" ${tipo}`;
      if (col.is_nullable === "NO") linea += " NOT NULL";
      if (def) linea += ` DEFAULT ${def}`;
      return linea;
    });

    const pks = conRes.rows.filter(c => c.constraint_type === "PRIMARY KEY");
    if (pks.length > 0) {
      cols.push(`  CONSTRAINT "${pks[0].constraint_name}" PRIMARY KEY (${
        pks[0].columns.split(", ").map(c => `"${c}"`).join(", ")
      })`);
    }

    conRes.rows.filter(c => c.constraint_type === "UNIQUE").forEach(u => {
      cols.push(`  CONSTRAINT "${u.constraint_name}" UNIQUE (${
        u.columns.split(", ").map(c => `"${c}"`).join(", ")
      })`);
    });

    fkRes.rows.forEach(fk => {
      let l = `  CONSTRAINT "${fk.constraint_name}" FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table}" ("${fk.foreign_column}")`;
      if (fk.delete_rule && fk.delete_rule !== "NO ACTION") l += ` ON DELETE ${fk.delete_rule}`;
      if (fk.update_rule && fk.update_rule !== "NO ACTION") l += ` ON UPDATE ${fk.update_rule}`;
      cols.push(l);
    });

    return `CREATE TABLE IF NOT EXISTS "${tabla}" (\n${cols.join(",\n")}\n);`;
  } catch (err) {
    return `-- ERROR esquema ${tabla}: ${err.message}`;
  }
}

// ── Obtener índices ────────────────────────────────────────────────────────
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

// ── Reset de secuencia ─────────────────────────────────────────────────────
async function resetSecuencia(client, tabla) {
  try {
    const res = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
        AND column_default LIKE 'nextval%'
    `, [tabla]);
    if (!res.rows.length) return "";
    const col = res.rows[0].column_name;
    return `SELECT setval('public.${tabla}_${col}_seq', COALESCE((SELECT MAX("${col}") FROM "${tabla}"), 1));`;
  } catch { return ""; }
}

// ── Checksum MD5 ───────────────────────────────────────────────────────────
function checksum(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

// ── Guardar historial ──────────────────────────────────────────────────────
async function guardarHistorial(client, adminId, stats) {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS backups_historial (
        id             SERIAL PRIMARY KEY,
        id_admin       INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
        fecha          TIMESTAMPTZ DEFAULT NOW(),
        tablas         INTEGER,
        filas_total    INTEGER,
        tamanio_bytes  BIGINT,
        duracion_ms    INTEGER,
        checksum_md5   VARCHAR(32),
        nombre_archivo VARCHAR(200)
      )
    `);
    await client.query(`
      INSERT INTO backups_historial
        (id_admin, tablas, filas_total, tamanio_bytes, duracion_ms, checksum_md5, nombre_archivo)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [adminId, stats.tablas, stats.filas, stats.bytes, stats.ms, stats.md5, stats.archivo]);
  } catch (err) {
    console.warn("Historial backup no guardado:", err.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CONTROLADOR: Generar backup
// ══════════════════════════════════════════════════════════════════════════
async function generarBackup(req, res) {
  const t0 = Date.now();
  // ── FIX: leer id_usuario igual que el middleware JWT lo pone en req.user ──
  const adminId = req.user?.id_usuario ?? req.user?.sub ?? null;
  const client  = await pool.connect();

  try {
    const ahora   = new Date();
    const ts      = ahora.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const archivo = `nub-studio-backup-${ts}.sql`;

    const TABLAS_ORDEN = await descubrirTablas(client);
    console.log(`[backup] Tablas encontradas: ${TABLAS_ORDEN.length} → ${TABLAS_ORDEN.join(", ")}`);

    let sql        = "";
    let filasTotal = 0;
    let tablasOk   = 0;
    const esquemas = {};

    // Cabecera
    sql += `-- =============================================\n`;
    sql += `-- Nu-B Studio — Respaldo completo\n`;
    sql += `-- Fecha:   ${ahora.toLocaleString("es-MX")}\n`;
    sql += `-- Versión: 2.0 (esquema + datos)\n`;
    sql += `-- Admin:   ${adminId ?? "sistema"}\n`;
    sql += `-- =============================================\n\n`;
    sql += `SET client_encoding = 'UTF8';\n`;
    sql += `SET standard_conforming_strings = on;\n`;
    sql += `SET check_function_bodies = false;\n`;
    sql += `SET client_min_messages = warning;\n\n`;

    // ── SECCIÓN 1: ESQUEMA ────────────────────────────────────────────────
    sql += `-- =============================================\n`;
    sql += `-- SECCIÓN 1: ESQUEMA\n`;
    sql += `-- =============================================\n\n`;

    for (const tabla of TABLAS_ORDEN) {
      const esq = await obtenerEsquemaTabla(client, tabla);
      if (!esq) continue;
      esquemas[tabla] = true;

      sql += `-- Tabla: ${tabla}\n`;
      sql += `DROP TABLE IF EXISTS "${tabla}" CASCADE;\n`;
      sql += esq + "\n\n";

      const idx = await obtenerIndices(client, tabla);
      if (idx) sql += idx + "\n\n";
    }

    // ── SECCIÓN 2: DATOS ──────────────────────────────────────────────────
    sql += `-- =============================================\n`;
    sql += `-- SECCIÓN 2: DATOS\n`;
    sql += `-- =============================================\n\n`;

    for (const tabla of TABLAS_ORDEN) {
      if (!esquemas[tabla]) continue;

      let conteo = 0;
      try {
        const r = await client.query(`SELECT COUNT(*) FROM "${tabla}"`);
        conteo = parseInt(r.rows[0].count, 10);
      } catch {
        sql += `-- Tabla: ${tabla} (no accesible)\n\n`;
        continue;
      }

      // ── FIX: tablasOk++ fuera del if/else → cuenta TODAS las tablas ──
      tablasOk++;

      sql += `-- ---------------------------------------------\n`;
      sql += `-- Tabla: ${tabla} (${conteo} filas)\n`;
      sql += `-- ---------------------------------------------\n`;

      if (conteo === 0) {
        sql += `-- (sin datos)\n`;
      } else {
        try {
          const colRes = await client.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
          `, [tabla]);
          const cols = colRes.rows.map(r => `"${r.column_name}"`);

          const LOTE = 500;
          for (let off = 0; off < conteo; off += LOTE) {
            const data = await client.query(
              `SELECT * FROM "${tabla}" ORDER BY 1 LIMIT ${LOTE} OFFSET ${off}`
            );
            if (!data.rows.length) break;
            sql += `INSERT INTO "${tabla}" (${cols.join(", ")}) VALUES\n`;
            sql += data.rows.map(row =>
              `  (${Object.values(row).map(escaparValor).join(", ")})`
            ).join(",\n");
            sql += `\nON CONFLICT DO NOTHING;\n`;
          }
          filasTotal += conteo;
        } catch (err) {
          sql += `-- ERROR datos ${tabla}: ${err.message}\n`;
        }
      }

      const seq = await resetSecuencia(client, tabla);
      if (seq) sql += seq + "\n";
      sql += "\n";
    }

    // Pie
    const ms    = Date.now() - t0;
    const md5   = checksum(sql);
    const bytes = Buffer.byteLength(sql, "utf8");

    sql += `-- =============================================\n`;
    sql += `-- Respaldo completado\n`;
    sql += `-- Tablas:   ${tablasOk}\n`;
    sql += `-- Filas:    ${filasTotal.toLocaleString("es-MX")}\n`;
    sql += `-- Tamaño:   ${(bytes / 1024).toFixed(2)} KB\n`;
    sql += `-- Duración: ${(ms / 1000).toFixed(2)}s\n`;
    sql += `-- MD5:      ${md5}\n`;
    sql += `-- =============================================\n`;

    await guardarHistorial(client, adminId, { tablas: tablasOk, filas: filasTotal, bytes, ms, md5, archivo });

    const buf = Buffer.from(sql, "utf8");
    res.setHeader("Content-Type",        "application/sql");
    res.setHeader("Content-Disposition", `attachment; filename="${archivo}"`);
    res.setHeader("Content-Length",      buf.length);
    res.setHeader("X-Backup-Checksum",   md5);
    res.setHeader("X-Backup-Tables",     tablasOk);
    res.setHeader("X-Backup-Rows",       filasTotal);
    res.setHeader("X-Backup-Duration",   ms);

    return res.status(200).send(buf);

  } catch (err) {
    console.error("Error backup:", err);
    return res.status(500).json({ success: false, message: "Error al generar el respaldo", error: err.message });
  } finally {
    client.release();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CONTROLADOR: Obtener historial
// ══════════════════════════════════════════════════════════════════════════
async function obtenerHistorial(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        bh.id, bh.fecha, bh.tablas, bh.filas_total,
        bh.tamanio_bytes, bh.duracion_ms, bh.checksum_md5, bh.nombre_archivo,
        u.nombre_completo AS admin_nombre
      FROM backups_historial bh
      LEFT JOIN usuarios u ON bh.id_admin = u.id_usuario
      ORDER BY bh.fecha DESC
      LIMIT 20
    `);
    return res.json({ success: true, data: result.rows });
  } catch {
    return res.json({ success: true, data: [] });
  }
}

export { generarBackup, obtenerHistorial };