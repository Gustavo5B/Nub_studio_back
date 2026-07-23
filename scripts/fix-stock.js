import { pool } from '../src/config/db.js';

// Obras publicadas SIN registro de inventario
const noInv = await pool.query(`
  SELECT o.id_obra, o.titulo
  FROM obras o
  LEFT JOIN inventario i ON i.id_obra = o.id_obra
  WHERE o.activa = TRUE AND o.eliminada = FALSE AND o.estado = 'publicada'
    AND i.id_obra IS NULL
`);
console.log('Sin inventario:', noInv.rows.length);
for (const o of noInv.rows) {
  await pool.query(
    'INSERT INTO inventario (id_obra, stock_actual, stock_reservado, stock_vendido, activo) VALUES ($1, 5, 0, 0, true)',
    [o.id_obra]
  );
  console.log('✓ Inventario creado:', o.id_obra, o.titulo);
}

// Obras con stock_actual = 0
const zeroStock = await pool.query(`
  SELECT o.id_obra, o.titulo
  FROM obras o
  JOIN inventario i ON i.id_obra = o.id_obra
  WHERE o.activa = TRUE AND o.eliminada = FALSE AND o.estado = 'publicada'
    AND i.stock_actual <= 0
`);
console.log('Con stock = 0:', zeroStock.rows.length);
for (const o of zeroStock.rows) {
  await pool.query('UPDATE inventario SET stock_actual = 5, stock_reservado = 0 WHERE id_obra = $1', [o.id_obra]);
  console.log('✓ Stock actualizado:', o.id_obra, o.titulo);
}

console.log('✅ Listo');
await pool.end();
