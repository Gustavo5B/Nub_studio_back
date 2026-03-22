import { pool, pools } from "../config/db.js";

export const getSobreNosotros = async () => {
  const result = await pool.query("SELECT * FROM sobre_nosotros LIMIT 1");
  return result.rows[0];
};

export const getTrayectoria = async () => {
  const result = await pool.query("SELECT * FROM trayectoria ORDER BY año ASC");
  return result.rows;
};

export const updateSobreNosotros = async (data) => {
  const { mision, vision, historia, logros, valores, descripcion_region } =
    data;
  const result = await pool.query(
    `UPDATE sobre_nosotros SET
      mision = $1, vision = $2, historia = $3,
      logros = $4, valores = $5, descripcion_region = $6,
      updated_at = NOW()
    WHERE id = 1 RETURNING *`,
    [mision, vision, historia, logros, valores, descripcion_region],
  );
  return result.rows[0];
};

export const updateTrayectoria = async (items) => {
  await pool.query("DELETE FROM trayectoria WHERE sobre_nosotros_id = 1");
  for (const item of items) {
    await pool.query(
      "INSERT INTO trayectoria (sobre_nosotros_id, año, titulo, descripcion) VALUES ($1, $2, $3, $4)",
      [1, item.año, item.titulo, item.descripcion],
    );
  }
};
