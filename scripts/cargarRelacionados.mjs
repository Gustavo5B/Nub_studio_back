// =========================================================
//  Crea la tabla blog_posts_relacionados (si no existe) y carga
//  en ella los pares precalculados por el notebook
//  (notebooks/blog_posts_relacionados.csv).
//     node scripts/cargarRelacionados.mjs
//  Es idempotente: vacía la tabla y la vuelve a llenar desde el CSV.
// =========================================================
import 'dotenv/config';
import pkg from 'pg';
import { readFileSync } from 'node:fs';
const { Pool } = pkg;

const SQL = readFileSync('migrations/2026-07-17_blog_posts_relacionados.sql', 'utf8');
const CSV = readFileSync('notebooks/blog_posts_relacionados.csv', 'utf8');

// Parseo simple del CSV: id_post,id_post_relacionado,score
const filas = CSV.trim().split('\n').slice(1).map((linea) => {
  const [a, b, s] = linea.split(',');
  return [parseInt(a, 10), parseInt(b, 10), parseFloat(s)];
}).filter(([a, b, s]) => Number.isInteger(a) && Number.isInteger(b) && !Number.isNaN(s));

const pool = new Pool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10) || 5432,
  ssl: { rejectUnauthorized: false }, application_name: 'nub_cargar_relacionados',
});
const c = await pool.connect();
try {
  await c.query('BEGIN');
  await c.query(SQL);                              // crea tabla + índice + grants
  await c.query('TRUNCATE blog_posts_relacionados');

  // Inserta todo de una con unnest (3 arrays paralelos)
  const A = filas.map((f) => f[0]);
  const B = filas.map((f) => f[1]);
  const S = filas.map((f) => f[2]);
  await c.query(
    `INSERT INTO blog_posts_relacionados (id_post, id_post_relacionado, score)
     SELECT * FROM unnest($1::int[], $2::int[], $3::numeric[])
     ON CONFLICT DO NOTHING`,
    [A, B, S]
  );

  const { rows } = await c.query('SELECT COUNT(*)::int n, COUNT(DISTINCT id_post)::int posts FROM blog_posts_relacionados');
  await c.query('COMMIT');
  console.log(`✓ Tabla lista y cargada: ${rows[0].n} pares para ${rows[0].posts} posts`);
} catch (e) {
  await c.query('ROLLBACK');
  console.error('✗ Error, se hizo ROLLBACK:', e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
