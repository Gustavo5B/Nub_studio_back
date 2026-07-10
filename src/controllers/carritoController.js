import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// GET /api/carrito
// Obtiene los items del carrito del usuario autenticado
// =========================================================
export const getCarrito = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const id_usuario = req.user.id_usuario;

    const result = await db.query(`
      SELECT
        c.id_carrito,
        c.id_obra,
        c.cantidad,
        o.titulo,
        o.slug,
        o.imagen_principal,
        o.precio_base,
        COALESCE(a.nombre_artistico, a.nombre_completo) AS artista_alias,
        COALESCE(inv.stock_actual - inv.stock_reservado, 0) AS stock_disponible
      FROM carritos c
      INNER JOIN obras o  ON o.id_obra     = c.id_obra
      INNER JOIN artistas a ON a.id_artista = o.id_artista
      LEFT  JOIN inventario inv ON inv.id_obra = c.id_obra
      WHERE c.id_usuario = $1
        AND c.activo      = TRUE
        AND o.eliminada  IS NOT TRUE
      ORDER BY c.fecha_agregado DESC
    `, [id_usuario]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error en getCarrito: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener el carrito' });
  }
};

export const getCarritoAlexa = async (req, res) => {
  try {
    const { alexa_user_id } = req.query;

    if (!alexa_user_id) {
      return res.status(400).json({ success: false, message: 'alexa_user_id es requerido', code: 'MISSING_ALEXA_ID' });
    }

    // Resolver usuario a partir del alexa_user_id vinculado
    const vinculacion = await pool.query(
      `SELECT usuario_id FROM vinculaciones WHERE alexa_user_id = $1`,
      [alexa_user_id]
    );
    if (vinculacion.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Cuenta no vinculada', code: 'NOT_LINKED' });
    }
    const id_usuario = vinculacion.rows[0].usuario_id;

    const db = pool; // usuarios de Alexa no traen rol de sesión; usamos el pool default

    const result = await db.query(`
      SELECT
        c.id_carrito,
        c.id_obra,
        c.cantidad,
        o.titulo,
        o.slug,
        o.imagen_principal,
        o.precio_base,
        COALESCE(a.nombre_artistico, a.nombre_completo) AS artista_alias,
        COALESCE(inv.stock_actual - inv.stock_reservado, 0) AS stock_disponible
      FROM carritos c
      INNER JOIN obras o  ON o.id_obra     = c.id_obra
      INNER JOIN artistas a ON a.id_artista = o.id_artista
      LEFT  JOIN inventario inv ON inv.id_obra = c.id_obra
      WHERE c.id_usuario = $1
        AND c.activo      = TRUE
        AND o.eliminada  IS NOT TRUE
      ORDER BY c.fecha_agregado DESC
    `, [id_usuario]);

    // Calcular subtotal, impuesto y total igual que espera el APL de la skill
    const subtotal = result.rows.reduce(
      (sum, item) => sum + (Number(item.precio_base) * item.cantidad), 0
    );
    const impuesto = Math.round(subtotal * 0.16 * 100) / 100;
    const total = Math.round((subtotal + impuesto) * 100) / 100;

    res.json({
      success: true,
      data: result.rows,
      subtotal,
      impuesto,
      total
    });
  } catch (error) {
    logger.error(`Error en getCarritoAlexa: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener el carrito' });
  }
};

// =========================================================
// POST /api/carrito
// Agrega una obra al carrito (o suma cantidad si ya existe)
// =========================================================
export const agregarAlCarrito = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const id_usuario = req.user.id_usuario;
    const { id_obra, cantidad = 1 } = req.body;

    if (!id_obra) {
      return res.status(400).json({ success: false, message: 'El id_obra es requerido' });
    }

    const cantidadNum = parseInt(cantidad);
    if (isNaN(cantidadNum) || cantidadNum < 1) {
      return res.status(400).json({ success: false, message: 'La cantidad debe ser al menos 1' });
    }

    // Verificar que la obra existe, está publicada y activa
    const obraRes = await db.query(
      `SELECT id_obra, titulo FROM obras WHERE id_obra = $1 AND activa = TRUE AND estado = 'publicada' AND eliminada IS NOT TRUE LIMIT 1`,
      [id_obra]
    );
    if (obraRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Obra no disponible' });
    }

    // Verificar stock disponible
    const invRes = await db.query(
      `SELECT GREATEST(COALESCE(stock_actual, 0) - COALESCE(stock_reservado, 0), 0) AS stock_disponible
       FROM inventario WHERE id_obra = $1`,
      [id_obra]
    );
    if (invRes.rows.length > 0) {
      const stockDisp = Number(invRes.rows[0].stock_disponible);
      if (stockDisp <= 0) {
        return res.status(400).json({ success: false, message: 'Esta obra está agotada' });
      }
      if (cantidadNum > stockDisp) {
        return res.status(400).json({
          success: false,
          message: `Solo hay ${stockDisp} ${stockDisp === 1 ? 'pieza disponible' : 'piezas disponibles'}`,
        });
      }
    }

    // Upsert: si ya existe (mismo usuario+obra sin tamaño ni marco), actualiza cantidad
    const existing = await db.query(
      `SELECT id_carrito FROM carritos
       WHERE id_usuario = $1 AND id_obra = $2
         AND id_obra_tamaño IS NULL AND id_tipo_marco IS NULL`,
      [id_usuario, id_obra]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await db.query(
        `UPDATE carritos SET cantidad = $1, activo = TRUE, fecha_agregado = NOW()
         WHERE id_carrito = $2 RETURNING id_carrito`,
        [cantidadNum, existing.rows[0].id_carrito]
      );
    } else {
      result = await db.query(
        `INSERT INTO carritos (id_usuario, id_obra, cantidad, activo, fecha_agregado)
         VALUES ($1, $2, $3, TRUE, NOW()) RETURNING id_carrito`,
        [id_usuario, id_obra, cantidadNum]
      );
    }

    logger.info(`Carrito: usuario ${id_usuario} agregó obra ${id_obra} (x${cantidadNum})`);
    res.json({ success: true, message: 'Obra agregada al carrito', id_carrito: result.rows[0].id_carrito });
  } catch (error) {
    logger.error(`Error en agregarAlCarrito: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al agregar al carrito' });
  }
};

// =========================================================
// POST /api/alexa/carrito
// Agrega una obra al carrito vía Alexa Skill (sin JWT).
// Resuelve el usuario a partir del alexa_user_id vinculado.
// =========================================================
export const agregarAlCarritoAlexa = async (req, res) => {
  try {
    const { id_obra, cantidad = 1, alexa_user_id } = req.body;

    if (!alexa_user_id) {
      return res.status(400).json({ success: false, message: 'alexa_user_id es requerido', code: 'MISSING_ALEXA_ID' });
    }
    if (!id_obra) {
      return res.status(400).json({ success: false, message: 'El id_obra es requerido' });
    }

    const cantidadNum = parseInt(cantidad);
    if (isNaN(cantidadNum) || cantidadNum < 1) {
      return res.status(400).json({ success: false, message: 'La cantidad debe ser al menos 1' });
    }

    // Resolver usuario a partir del alexa_user_id vinculado
    const vinculacion = await pool.query(
      `SELECT usuario_id FROM vinculaciones WHERE alexa_user_id = $1`,
      [alexa_user_id]
    );
    if (vinculacion.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Cuenta no vinculada', code: 'NOT_LINKED' });
    }
    const id_usuario = vinculacion.rows[0].usuario_id;

    const db = pool; // usuarios de Alexa no traen rol de sesión; usamos el pool default

    // Verificar que la obra existe, está publicada y activa
    const obraRes = await db.query(
      `SELECT id_obra, titulo FROM obras WHERE id_obra = $1 AND activa = TRUE AND estado = 'publicada' AND eliminada IS NOT TRUE LIMIT 1`,
      [id_obra]
    );
    if (obraRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Obra no disponible' });
    }

    // Verificar stock disponible
    const invRes = await db.query(
      `SELECT GREATEST(COALESCE(stock_actual, 0) - COALESCE(stock_reservado, 0), 0) AS stock_disponible
       FROM inventario WHERE id_obra = $1`,
      [id_obra]
    );
    if (invRes.rows.length > 0) {
      const stockDisp = Number(invRes.rows[0].stock_disponible);
      if (stockDisp <= 0) {
        return res.status(400).json({ success: false, message: 'Esta obra está agotada' });
      }
      if (cantidadNum > stockDisp) {
        return res.status(400).json({
          success: false,
          message: `Solo hay ${stockDisp} ${stockDisp === 1 ? 'pieza disponible' : 'piezas disponibles'}`,
        });
      }
    }

    // Upsert: si ya existe (mismo usuario+obra sin tamaño ni marco), actualiza cantidad
    const existing = await db.query(
      `SELECT id_carrito FROM carritos
       WHERE id_usuario = $1 AND id_obra = $2
         AND id_obra_tamaño IS NULL AND id_tipo_marco IS NULL`,
      [id_usuario, id_obra]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await db.query(
        `UPDATE carritos SET cantidad = $1, activo = TRUE, fecha_agregado = NOW()
         WHERE id_carrito = $2 RETURNING id_carrito`,
        [cantidadNum, existing.rows[0].id_carrito]
      );
    } else {
      result = await db.query(
        `INSERT INTO carritos (id_usuario, id_obra, cantidad, activo, fecha_agregado)
         VALUES ($1, $2, $3, TRUE, NOW()) RETURNING id_carrito`,
        [id_usuario, id_obra, cantidadNum]
      );
    }

    // Calcular total actual del carrito para devolvérselo a la skill
    const totalRes = await db.query(
      `SELECT COALESCE(SUM(c.cantidad * o.precio_base), 0) AS total
       FROM carritos c
       INNER JOIN obras o ON o.id_obra = c.id_obra
       WHERE c.id_usuario = $1 AND c.activo = TRUE`,
      [id_usuario]
    );

    logger.info(`Carrito (Alexa): usuario ${id_usuario} agregó obra ${id_obra} (x${cantidadNum})`);
    res.json({
      success: true,
      message: 'Obra agregada al carrito',
      id_carrito: result.rows[0].id_carrito,
      total: totalRes.rows[0].total
    });
  } catch (error) {
    logger.error(`Error en agregarAlCarritoAlexa: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al agregar al carrito' });
  }
};

// =========================================================
// PUT /api/carrito/:id_carrito
// Actualiza la cantidad de un item del carrito
// =========================================================
export const actualizarCantidad = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const id_usuario = req.user.id_usuario;
    const { id_carrito } = req.params;
    const { cantidad } = req.body;

    const cantidadNum = parseInt(cantidad);
    if (isNaN(cantidadNum) || cantidadNum < 1) {
      return res.status(400).json({ success: false, message: 'La cantidad debe ser al menos 1' });
    }

    // Verificar que el item pertenece al usuario
    const check = await db.query(
      `SELECT c.id_obra FROM carritos c WHERE c.id_carrito = $1 AND c.id_usuario = $2 AND c.activo = TRUE`,
      [id_carrito, id_usuario]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Item no encontrado en tu carrito' });
    }

    const id_obra = check.rows[0].id_obra;

    // Validar contra stock disponible
    const invRes = await db.query(
      `SELECT GREATEST(COALESCE(stock_actual, 0) - COALESCE(stock_reservado, 0), 0) AS stock_disponible
       FROM inventario WHERE id_obra = $1`,
      [id_obra]
    );
    if (invRes.rows.length > 0) {
      const stockDisp = Number(invRes.rows[0].stock_disponible);
      if (cantidadNum > stockDisp) {
        return res.status(400).json({
          success: false,
          message: `Solo hay ${stockDisp} ${stockDisp === 1 ? 'pieza disponible' : 'piezas disponibles'}`,
        });
      }
    }

    await db.query(
      `UPDATE carritos SET cantidad = $1 WHERE id_carrito = $2 AND id_usuario = $3`,
      [cantidadNum, id_carrito, id_usuario]
    );

    res.json({ success: true, message: 'Cantidad actualizada' });
  } catch (error) {
    logger.error(`Error en actualizarCantidad: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al actualizar la cantidad' });
  }
};

// =========================================================
// DELETE /api/carrito/:id_carrito
// Elimina un item del carrito
// =========================================================
export const eliminarDelCarrito = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const id_usuario = req.user.id_usuario;
    const { id_carrito } = req.params;

    const result = await db.query(
      `UPDATE carritos SET activo = FALSE WHERE id_carrito = $1 AND id_usuario = $2 AND activo = TRUE`,
      [id_carrito, id_usuario]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Item no encontrado en tu carrito' });
    }

    logger.info(`Carrito: usuario ${id_usuario} eliminó item ${id_carrito}`);
    res.json({ success: true, message: 'Obra eliminada del carrito' });
  } catch (error) {
    logger.error(`Error en eliminarDelCarrito: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar del carrito' });
  }
};

// =========================================================
// POST /api/carrito/coleccion
// Agrega todas las obras disponibles de una colección al carrito
// (omite las agotadas y respeta las que ya están en el carrito)
// =========================================================
export const agregarColeccionAlCarrito = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const id_usuario = req.user.id_usuario;
    const idColeccion = Number.parseInt(req.body.id_coleccion);

    if (Number.isNaN(idColeccion)) {
      return res.status(400).json({ success: false, message: 'El id_coleccion es requerido' });
    }

    // Solo colecciones publicadas y activas
    const colRes = await db.query(
      `SELECT id_coleccion, nombre FROM colecciones
       WHERE id_coleccion = $1 AND estado = 'publicada' AND activa = TRUE AND eliminada = FALSE LIMIT 1`,
      [idColeccion]
    );
    if (colRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Colección no disponible' });
    }

    // Obras compradas: publicadas, activas y con stock disponible
    const obrasRes = await db.query(`
      SELECT o.id_obra,
        GREATEST(COALESCE(i.stock_actual, 0) - COALESCE(i.stock_reservado, 0), 0) AS stock_disponible
      FROM obras o
      LEFT JOIN inventario i ON i.id_obra = o.id_obra
      WHERE o.id_coleccion = $1 AND o.estado = 'publicada'
        AND o.activa = TRUE AND o.eliminada IS NOT TRUE
    `, [idColeccion]);

    if (obrasRes.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Esta colección no tiene obras disponibles' });
    }

    let agregadas = 0;
    let omitidas = 0;

    for (const obra of obrasRes.rows) {
      if (Number(obra.stock_disponible) <= 0) { omitidas++; continue; }

      const existing = await db.query(
        `SELECT id_carrito, activo FROM carritos
         WHERE id_usuario = $1 AND id_obra = $2
           AND id_obra_tamaño IS NULL AND id_tipo_marco IS NULL`,
        [id_usuario, obra.id_obra]
      );

      if (existing.rows.length > 0) {
        if (existing.rows[0].activo) { omitidas++; continue; }
        await db.query(
          `UPDATE carritos SET activo = TRUE, cantidad = 1, fecha_agregado = NOW() WHERE id_carrito = $1`,
          [existing.rows[0].id_carrito]
        );
        agregadas++;
      } else {
        await db.query(
          `INSERT INTO carritos (id_usuario, id_obra, cantidad, activo, fecha_agregado)
           VALUES ($1, $2, 1, TRUE, NOW())`,
          [id_usuario, obra.id_obra]
        );
        agregadas++;
      }
    }

    logger.info(`Carrito: usuario ${id_usuario} agregó colección ${idColeccion} (${agregadas} obras, ${omitidas} omitidas)`);
    res.json({
      success: true,
      message: agregadas > 0
        ? `${agregadas} obra${agregadas !== 1 ? 's' : ''} de la colección agregada${agregadas !== 1 ? 's' : ''} al carrito${omitidas > 0 ? ` (${omitidas} ya estaban o sin stock)` : ''}`
        : 'Las obras de esta colección ya están en tu carrito o no tienen stock',
      data: { agregadas, omitidas },
    });
  } catch (error) {
    logger.error(`Error en agregarColeccionAlCarrito: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al agregar la colección al carrito' });
  }
};
