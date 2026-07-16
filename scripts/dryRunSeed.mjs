// =========================================================
//  DRY-RUN del seed: ejecuta migrations/2026-07-15_seed_completo.sql
//  dentro de una transacción y hace ROLLBACK. NO guarda nada.
//  Sirve para validar el SQL y la coherencia antes de aplicarlo.
//     node scripts/dryRunSeed.mjs
// =========================================================
import 'dotenv/config'; import pkg from 'pg'; const {Pool}=pkg;
import {readFileSync} from 'node:fs';
const sql=readFileSync('migrations/2026-07-15_seed_completo.sql','utf8');
const pool=new Pool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,
 database:process.env.DB_NAME,port:parseInt(process.env.DB_PORT,10)||5432,ssl:{rejectUnauthorized:false},
 connectionTimeoutMillis:20000,statement_timeout:900000,application_name:'nub_dryrun'});
const c=await pool.connect();
c.on('notice',n=>console.log('  ·',n.message));
const t0=Date.now();
try{
  await c.query('BEGIN');
  await c.query(sql);
  const {rows}=await c.query(`SELECT
    (SELECT COUNT(*)::int FROM artistas WHERE correo LIKE 'artista_seed_%') artistas,
    (SELECT COUNT(*)::int FROM obras WHERE slug LIKE 'seed-obra-%') obras,
    (SELECT COUNT(*)::int FROM usuarios WHERE correo LIKE 'cliente_seed_%') clientes,
    (SELECT COUNT(*)::int FROM colecciones WHERE slug LIKE 'seed-col-%') colecciones,
    (SELECT COUNT(*)::int FROM favoritos f JOIN usuarios u ON u.id_usuario=f.id_usuario WHERE u.correo LIKE 'cliente_seed_%') favoritos,
    (SELECT COUNT(*)::int FROM carritos ca JOIN usuarios u ON u.id_usuario=ca.id_usuario WHERE u.correo LIKE 'cliente_seed_%') carritos,
    (SELECT COUNT(*)::int FROM ventas v JOIN usuarios u ON u.id_usuario=v.id_cliente WHERE u.correo LIKE 'cliente_seed_%') ventas,
    (SELECT COUNT(*)::int FROM pedidos p JOIN usuarios u ON u.id_usuario=p.id_cliente WHERE u.correo LIKE 'cliente_seed_%') pedidos,
    (SELECT COUNT(*)::int FROM blog_posts WHERE slug LIKE 'seed-post-%') posts,
    (SELECT COUNT(*)::int FROM "obras_tamaños" t JOIN obras o ON o.id_obra=t.id_obra WHERE o.slug LIKE 'seed-obra-%') tamanos,
    (SELECT COUNT(*)::int FROM liquidaciones_artistas WHERE notas='Liquidación seed') liquidaciones`);
  console.log('\n✓✓ EL SQL CORRIÓ COMPLETO SIN ERRORES en', ((Date.now()-t0)/1000).toFixed(1),'s\n');
  console.table(rows[0]);
  console.log('--- COHERENCIA (todos deben ser 0) ---');
  const q=async(l,s)=>{const{rows:r}=await c.query(s);console.log(`  ${r[0].n===0?'✓':'✗'} ${l}: ${r[0].n}`)};
  await q('obras con categoría ≠ la de su técnica',`SELECT COUNT(*)::int n FROM obras o JOIN tecnicas t ON t.id_tecnica=o.id_tecnica WHERE o.slug LIKE 'seed-obra-%' AND o.id_categoria<>t.id_categoria`);
  await q('ventas anteriores a la creación de la obra',`SELECT COUNT(*)::int n FROM ventas v JOIN obras o ON o.id_obra=v.id_obra WHERE o.slug LIKE 'seed-obra-%' AND v.fecha_venta<o.fecha_creacion`);
  await q('obras en colección de OTRO artista',`SELECT COUNT(*)::int n FROM obras o JOIN colecciones cl ON cl.id_coleccion=o.id_coleccion WHERE o.slug LIKE 'seed-obra-%' AND cl.id_artista<>o.id_artista`);
  await q('pedidos cuyo total ≠ suma de sus ventas',`SELECT COUNT(*)::int n FROM pedidos p JOIN usuarios u ON u.id_usuario=p.id_cliente WHERE u.correo LIKE 'cliente_seed_%' AND p.total<>(SELECT COALESCE(SUM(total),0) FROM ventas WHERE id_pedido=p.id_pedido)`);
  await q('direcciones con municipio de otro estado',`SELECT COUNT(*)::int n FROM direcciones d JOIN municipios m ON m.id_municipio=d.id_municipio JOIN usuarios u ON u.id_usuario=d.id_usuario WHERE u.correo LIKE 'cliente_seed_%' AND m.id_estado<>d.id_estado`);
  await q('obras sin imagen',`SELECT COUNT(*)::int n FROM obras WHERE slug LIKE 'seed-obra-%' AND imagen_principal IS NULL`);
  await q('compras de obras NO favoritas del cliente',`SELECT COUNT(*)::int n FROM ventas v JOIN usuarios u ON u.id_usuario=v.id_cliente WHERE u.correo LIKE 'cliente_seed_%' AND NOT EXISTS(SELECT 1 FROM favoritos f WHERE f.id_usuario=v.id_cliente AND f.id_obra=v.id_obra)`);
  await q('monto_artista mal calculado',`SELECT COUNT(*)::int n FROM ventas v JOIN artistas a ON a.id_artista=v.id_artista JOIN usuarios u ON u.id_usuario=v.id_cliente WHERE u.correo LIKE 'cliente_seed_%' AND v.monto_artista<>ROUND(v.subtotal*(1-COALESCE(a.porcentaje_comision,15)/100.0),2)`);
  console.log('\n--- DISTRIBUCIÓN POR CATEGORÍA (clustering) ---');
  const {rows:d}=await c.query(`SELECT c.nombre, COUNT(*)::int obras FROM obras o JOIN categorias c ON c.id_categoria=o.id_categoria WHERE o.slug LIKE 'seed-obra-%' GROUP BY c.nombre ORDER BY 2 DESC`);
  console.table(d);
}catch(e){
  console.error('\n✗ FALLÓ:', e.message);
  if(e.where) console.error('  en:', e.where.split('\n')[0]);
  if(e.detail) console.error('  detalle:', e.detail);
}finally{ await c.query('ROLLBACK'); console.log('↩ ROLLBACK — la BD quedó intacta.'); c.release(); await pool.end(); }
