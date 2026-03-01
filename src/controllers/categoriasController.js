import { pool } from "../config/db.js";
import logger from "../config/logger.js";

// =========================================================
// LISTAR TODAS LAS CATEGORIAS
// =========================================================
export const listarCategorias = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id_categoria, c.nombre, c.descripcion,
        c.slug, c.icono,
        COUNT(o.id_obra) AS total_obras
      FROM categorias c
      LEFT JOIN obras o ON c.id_categoria = o.id_categoria AND o.activa = TRUE
      WHERE c.activa = TRUE
      GROUP BY c.id_categoria
      ORDER BY c.nombre ASC
    `);

    logger.info(`Categorias listadas: ${result.rows.length}`);
    res.json({ success: true, data: result.rows });

  } catch (error) {
    logger.error(`Error al listar categorias: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener las categorias" });
  }
};

// =========================================================
// OBTENER DETALLE DE UNA CATEGORIA
// =========================================================
export const obtenerCategoriaPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const resultCat = await pool.query(`
      SELECT c.*, COUNT(o.id_obra) AS total_obras
      FROM categorias c
      LEFT JOIN obras o ON c.id_categoria = o.id_categoria AND o.activa = TRUE
      WHERE c.id_categoria = $1 AND c.activa = TRUE
      GROUP BY c.id_categoria
      LIMIT 1
    `, [id]);

    if (resultCat.rows.length === 0)
      return res.status(404).json({ success: false, message: "Categoria no encontrada" });

    const resultObras = await pool.query(`
      SELECT 
        o.id_obra, o.titulo, o.slug, o.imagen_principal,
        a.nombre_artistico AS artista_alias,
        MIN(ot.precio_base) AS precio_minimo
      FROM obras o
      INNER JOIN artistas a ON o.id_artista = a.id_artista
      LEFT JOIN obras_tamaños ot ON o.id_obra = ot.id_obra AND ot.activo = TRUE
      WHERE o.id_categoria = $1 AND o.activa = TRUE
      GROUP BY o.id_obra, a.nombre_artistico
      ORDER BY o.fecha_creacion DESC
      LIMIT 12
    `, [id]);

    res.json({ success: true, data: { ...resultCat.rows[0], obras: resultObras.rows } });

  } catch (error) {
    logger.error(`Error al obtener categoria: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener la categoria" });
  }
};

// =========================================================
// OBTENER CATEGORIA POR SLUG
// =========================================================
export const obtenerCategoriaPorSlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(
      'SELECT id_categoria FROM categorias WHERE slug = $1 AND activa = TRUE LIMIT 1',
      [slug]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Categoria no encontrada" });

    req.params.id = result.rows[0].id_categoria;
    return obtenerCategoriaPorId(req, res);

  } catch (error) {
    logger.error(`Error al obtener categoria por slug: ${error.message}`);
    res.status(500).json({ success: false, message: "Error al obtener la categoria" });
  }
};