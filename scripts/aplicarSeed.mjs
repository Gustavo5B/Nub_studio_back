// =========================================================
//  APLICA migrations/2026-07-15_seed_completo.sql a Neon (COMMIT).
//  Todo va en una transacción: si algo falla, hace ROLLBACK solo.
//     node scripts/aplicarSeed.mjs
// =========================================================
import 'dotenv/config'; import pkg from 'pg'; const {Pool}=pkg;
import {readFileSync} from 'node:fs';
const sql=readFileSync('migrations/2026-07-15_seed_completo.sql','utf8');
const pool=new Pool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,
 database:process.env.DB_NAME,port:parseInt(process.env.DB_PORT,10)||5432,ssl:{rejectUnauthorized:false},
 connectionTimeoutMillis:20000,statement_timeout:900000,application_name:'nub_seed_apply'});
const c=await pool.connect();
c.on('notice',n=>console.log('  ·',n.message));
const t0=Date.now();
try{
  // Antes
  const {rows:a}=await c.query(`SELECT
    (SELECT COUNT(*)::int FROM artistas) artistas,(SELECT COUNT(*)::int FROM obras) obras,
    (SELECT COUNT(*)::int FROM usuarios) usuarios,(SELECT COUNT(*)::int FROM ventas) ventas`);
  console.log('ANTES :',JSON.stringify(a[0]));

  await c.query('BEGIN');
  await c.query(sql);
  await c.query('COMMIT');
  console.log(`\n✓ APLICADO Y COMMITEADO en ${((Date.now()-t0)/1000).toFixed(1)}s\n`);

  const {rows:d}=await c.query(`SELECT
    (SELECT COUNT(*)::int FROM artistas) artistas,(SELECT COUNT(*)::int FROM obras) obras,
    (SELECT COUNT(*)::int FROM usuarios) usuarios,(SELECT COUNT(*)::int FROM ventas) ventas`);
  console.log('DESPUÉS:',JSON.stringify(d[0]));
  const {rows:s}=await c.query(`SELECT
    (SELECT COUNT(*)::int FROM artistas WHERE correo LIKE 'artista_seed_%') artistas_seed,
    (SELECT COUNT(*)::int FROM obras WHERE slug LIKE 'seed-obra-%') obras_seed,
    (SELECT COUNT(*)::int FROM usuarios WHERE correo LIKE 'cliente_seed_%') clientes_seed,
    (SELECT COUNT(*)::int FROM colecciones WHERE slug LIKE 'seed-col-%') colecciones_seed,
    (SELECT COUNT(*)::int FROM favoritos f JOIN usuarios u ON u.id_usuario=f.id_usuario WHERE u.correo LIKE 'cliente_seed_%') favoritos_seed,
    (SELECT COUNT(*)::int FROM ventas v JOIN usuarios u ON u.id_usuario=v.id_cliente WHERE u.correo LIKE 'cliente_seed_%') ventas_seed,
    (SELECT COUNT(*)::int FROM blog_posts WHERE slug LIKE 'seed-post-%') posts_seed`);
  console.log('\nSEED APLICADO:'); console.table(s[0]);
}catch(e){
  try{await c.query('ROLLBACK')}catch{}
  console.error('\n✗ FALLÓ (rollback hecho):',e.message);
  if(e.where) console.error('  en:',e.where.split('\n')[0]);
  process.exitCode=1;
}finally{ c.release(); await pool.end(); }
