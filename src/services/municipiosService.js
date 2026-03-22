import { pool, pools } from "../config/db.js";

export const countMunicipiosHidalgo = async () => {
  const result = await pool.query(
    "SELECT COUNT(*) FROM municipios WHERE id_estado = 13",
  );
  return parseInt(result.rows[0].count);
};
