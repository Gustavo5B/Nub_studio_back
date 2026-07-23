import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port:     parseInt(process.env.DB_PORT, 10) || 5432,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    // Ver obras y su inventario actual
    const check = await client.query(`
      SELECT o.id_obra, o.titulo, i.stock_actual, i.stock_reservado
      FROM obras o
      LEFT JOIN inventario i ON i.id_obra = o.id_obra
      WHERE o.activa = TRUE AND o.eliminada = FALSE AND o.estado = 'publicada'
      ORDER BY o.id_obra
      LIMIT 20
    `);
    console.log('\n=== OBRAS ACTUALES ===');
    check.rows.forEach(r => console.log(`[${r.id_obra}] ${r.titulo?.padEnd(30)} stock: ${r.stock_actual ?? 'sin registro'}, reservado: ${r.stock_reservado ?? 0}`));

    // Actualizar stock a 5 para las primeras 6 obras que tengan inventario en 0 o nulo
    const obras = check.rows.filter(r => !r.stock_actual || parseInt(r.stock_actual) === 0).slice(0, 6);

    if (obras.length === 0) {
      console.log('\n✓ Todas las obras ya tienen stock > 0');
    } else {
      for (const obra of obras) {
        const exists = await client.query(
          'SELECT id FROM inventario WHERE id_obra = $1 LIMIT 1',
          [obra.id_obra]
        );
        if (exists.rows.length > 0) {
          await client.query(
            'UPDATE inventario SET stock_actual = 5, stock_reservado = 0 WHERE id_obra = $1',
            [obra.id_obra]
          );
        } else {
          await client.query(
            'INSERT INTO inventario (id_obra, stock_actual, stock_reservado, stock_vendido, activo) VALUES ($1, 5, 0, 0, true)',
            [obra.id_obra]
          );
        }
        console.log(`✓ Stock actualizado: [${obra.id_obra}] ${obra.titulo}`);
      }
    }

    // Verificar resultado
    const after = await client.query(`
      SELECT o.id_obra, o.titulo, i.stock_actual, i.stock_reservado
      FROM obras o
      LEFT JOIN inventario i ON i.id_obra = o.id_obra
      WHERE o.activa = TRUE AND o.eliminada = FALSE AND o.estado = 'publicada'
      ORDER BY o.id_obra
      LIMIT 20
    `);
    console.log('\n=== RESULTADO FINAL ===');
    after.rows.forEach(r => {
      const disp = Math.max(0, (parseInt(r.stock_actual) || 0) - (parseInt(r.stock_reservado) || 0));
      console.log(`[${r.id_obra}] ${r.titulo?.padEnd(30)} disponible: ${disp}`);
    });

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
