import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';
import { preference, payment } from '../config/mercadopagoConfig.js';
import { sendConfirmacionPedidoEmail } from '../services/emailService.js';

// =========================================================
// GET /api/ventas/mis-pedidos
// Historial de compras del cliente autenticado
// =========================================================
export const getMisPedidos = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const id_usuario = req.user?.id_usuario;

    const result = await db.query(`
      SELECT
        p.id_pedido,
        p.estado           AS estado_pedido,
        p.total            AS total_pedido,
        p.fecha_pedido,
        v.id_venta,
        v.estado           AS estado_venta,
        v.cantidad,
        v.precio_unitario,
        v.subtotal,
        v.total,
        o.titulo,
        o.slug,
        o.imagen_principal,
        COALESCE(a.nombre_artistico, a.nombre_completo) AS artista_alias
      FROM   pedidos p
      INNER JOIN ventas   v ON v.id_pedido  = p.id_pedido
      INNER JOIN obras    o ON o.id_obra    = v.id_obra
      INNER JOIN artistas a ON a.id_artista = v.id_artista
      WHERE  p.id_cliente = $1
      ORDER BY p.fecha_pedido DESC, v.id_venta ASC
      LIMIT  200
    `, [id_usuario]);

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getMisPedidos error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Error al obtener pedidos' });
  }
};

export const getMisPedidosAlexa = async (req, res) => {
  try {
    const { alexa_user_id } = req.query;

    if (!alexa_user_id) {
      return res.status(400).json({ success: false, message: 'alexa_user_id es requerido', code: 'MISSING_ALEXA_ID' });
    }

    const vinculacion = await pool.query(
      `SELECT usuario_id FROM vinculaciones WHERE alexa_user_id = $1`,
      [alexa_user_id]
    );
    if (vinculacion.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Cuenta no vinculada', code: 'NOT_LINKED' });
    }
    const id_usuario = vinculacion.rows[0].usuario_id;

    const result = await pool.query(`
      SELECT
        p.id_pedido,
        p.estado           AS estado_pedido,
        p.total            AS total_pedido,
        p.fecha_pedido,
        v.id_venta,
        v.estado           AS estado_venta,
        v.cantidad,
        v.precio_unitario,
        v.subtotal,
        v.total,
        o.titulo,
        o.slug,
        o.imagen_principal,
        COALESCE(a.nombre_artistico, a.nombre_completo) AS artista_alias
      FROM   pedidos p
      INNER JOIN ventas   v ON v.id_pedido  = p.id_pedido
      INNER JOIN obras    o ON o.id_obra    = v.id_obra
      INNER JOIN artistas a ON a.id_artista = v.id_artista
      WHERE  p.id_cliente = $1
      ORDER BY p.fecha_pedido DESC, v.id_venta ASC
      LIMIT  200
    `, [id_usuario]);

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getMisPedidosAlexa error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Error al obtener pedidos' });
  }
};

// =========================================================
// POST /api/ventas/checkout
// Crea preferencia de pago en MercadoPago desde el carrito
// =========================================================
export const checkout = async (req, res) => {
  const db = pools[req.user?.rol] || pool;
  const id_cliente = req.user.id_usuario;
  const { id_direccion_envio } = req.body;

  try {
    // ids_carrito opcionales: si se mandan, solo procesa esos items
    const { id_direccion_envio, ids_carrito } = req.body;
    const filtroIds = Array.isArray(ids_carrito) && ids_carrito.length > 0
      ? ids_carrito.map(Number).filter(Boolean)
      : null;

    // 1. Obtener items del carrito activo con datos de obra
    let carritoQuery = `
      SELECT
        c.id_carrito,
        c.id_obra,
        c.cantidad,
        o.id_artista,
        o.titulo,
        o.precio_base,
        o.imagen_principal,
        GREATEST(COALESCE(inv.stock_actual, 0) - COALESCE(inv.stock_reservado, 0), 0) AS stock_disponible
      FROM carritos c
      INNER JOIN obras o ON o.id_obra = c.id_obra
      LEFT  JOIN inventario inv ON inv.id_obra = c.id_obra
      WHERE c.id_usuario = $1 AND c.activo = true AND o.eliminada IS NOT TRUE
    `;
    const carritoParams = [id_cliente];

    if (filtroIds) {
      carritoQuery += ` AND c.id_carrito = ANY($2::int[])`;
      carritoParams.push(filtroIds);
    }

    const carritoRes = await db.query(carritoQuery, carritoParams);

    if (carritoRes.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'El carrito está vacío' });
    }

    // 2. Validar stock de cada item
    for (const item of carritoRes.rows) {
      if (Number(item.stock_disponible) < item.cantidad) {
        return res.status(400).json({
          success: false,
          message: `Stock insuficiente para "${item.titulo}". Disponible: ${item.stock_disponible}`,
        });
      }
    }

    // 3. Calcular total del pedido
    const totalPedido = carritoRes.rows.reduce((sum, item) => {
      return sum + Number(item.precio_base) * item.cantidad;
    }, 0);

    // 4. Crear registro en tabla pedidos
    const pedidoRes = await db.query(`
      INSERT INTO pedidos (id_cliente, id_direccion_envio, estado, total, fecha_pedido)
      VALUES ($1, $2, 'pendiente', $3, NOW())
      RETURNING id_pedido
    `, [id_cliente, id_direccion_envio || null, totalPedido]);

    const id_pedido = pedidoRes.rows[0].id_pedido;

    // 5. Crear registros de venta vinculados al pedido
    const ventasIds = [];
    for (const item of carritoRes.rows) {
      const precio_unitario = Number(item.precio_base);
      const subtotal = precio_unitario * item.cantidad;

      const ventaRes = await db.query(`
        INSERT INTO ventas
          (id_cliente, id_obra, id_artista, cantidad, precio_unitario, subtotal, total,
           estado, fecha_venta, id_direccion_envio, id_pedido)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', NOW(), $8, $9)
        RETURNING id_venta
      `, [id_cliente, item.id_obra, item.id_artista, item.cantidad,
        precio_unitario, subtotal, subtotal, id_direccion_envio || null, id_pedido]);

      ventasIds.push(ventaRes.rows[0].id_venta);

      // Reservar stock
      await db.query(`
        UPDATE inventario
        SET stock_reservado = COALESCE(stock_reservado, 0) + $1
        WHERE id_obra = $2
      `, [item.cantidad, item.id_obra]);
    }

    // 6. Vaciar solo los items procesados del carrito
    const idsCarritoProcesados = carritoRes.rows.map(r => r.id_carrito);
    await db.query(`
      UPDATE carritos SET activo = false
      WHERE id_usuario = $1 AND id_carrito = ANY($2::int[])
    `, [id_cliente, idsCarritoProcesados]);

    // 7. Crear preferencia en MercadoPago
    const items = carritoRes.rows.map(item => ({
      id: String(item.id_obra),
      title: item.titulo,
      quantity: item.cantidad,
      unit_price: Number(item.precio_base),
      currency_id: 'MXN',
      picture_url: item.imagen_principal || undefined,
    }));

    const isProd = process.env.NODE_ENV === 'production';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';

    const prefBody = {
      items,
      external_reference: String(id_pedido),   // ← ID único del pedido
      notification_url: `${backendUrl}/api/ventas/webhook`,
      statement_descriptor: 'NUB Studio',
      back_urls: {
        success: `${frontendUrl}/mi-cuenta/pedidos?status=success`,
        failure: `${frontendUrl}/mi-cuenta/pedidos?status=failure`,
        pending: `${frontendUrl}/mi-cuenta/pedidos?status=pending`,
      },
    };

    if (isProd) prefBody.auto_return = 'approved';

    const prefResult = await preference.create({ body: prefBody });

    logger.info(`Checkout OK: cliente=${id_cliente} pedido=#${id_pedido} ventas=[${ventasIds.join(',')}] preferencia=${prefResult.id}`);

    return res.json({
      success: true,
      id_pedido,
      preference_id: prefResult.id,
      init_point: prefResult.init_point,
      sandbox_init_point: prefResult.sandbox_init_point,
      ventas_ids: ventasIds,
    });
  } catch (error) {
    logger.error(`Error en checkout: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Error al procesar el checkout' });
  }
};

// =========================================================
// POST /api/ventas/webhook
// MercadoPago notifica aquí cuando se confirma/rechaza el pago
// =========================================================
export const webhookPago = async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type !== 'payment') return res.sendStatus(200);

    const paymentId = data?.id;
    if (!paymentId) return res.sendStatus(200);

    // Consultar el pago en MercadoPago
    const { MercadoPagoConfig, Payment: MPPayment } = await import('mercadopago');
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const mpPayment = new MPPayment(client);
    const pagoInfo = await mpPayment.get({ id: paymentId });

    const status = pagoInfo.status;             // approved | rejected | pending
    const external_ref = pagoInfo.external_reference; // id_pedido como string

    if (!external_ref) return res.sendStatus(200);

    const id_pedido = Number(external_ref);
    if (!id_pedido) return res.sendStatus(200);

    const nuevoEstado = status === 'approved' ? 'pagado'
      : status === 'rejected' ? 'cancelado'
        : 'pendiente';

    // Actualizar estado del pedido
    await pool.query(
      `UPDATE pedidos SET estado = $1 WHERE id_pedido = $2`,
      [nuevoEstado, id_pedido]
    );

    // Actualizar estado de todas las ventas del pedido
    await pool.query(
      `UPDATE ventas SET estado = $1 WHERE id_pedido = $2`,
      [nuevoEstado, id_pedido]
    );

    // Obtener obras del pedido para ajustar inventario
    const obrasRes = await pool.query(
      `SELECT id_obra, cantidad FROM ventas WHERE id_pedido = $1`,
      [id_pedido]
    );

    // Pago rechazado → liberar stock reservado
    if (status === 'rejected') {
      for (const row of obrasRes.rows) {
        await pool.query(
          `UPDATE inventario
           SET stock_reservado = GREATEST(COALESCE(stock_reservado, 0) - $1, 0)
           WHERE id_obra = $2`,
          [row.cantidad, row.id_obra]
        );
      }
    }

    // Pago aprobado → descontar stock real y liberar reserva + enviar email
    if (status === 'approved') {
      for (const row of obrasRes.rows) {
        await pool.query(
          `UPDATE inventario
           SET stock_actual    = GREATEST(COALESCE(stock_actual, 0) - $1, 0),
               stock_reservado = GREATEST(COALESCE(stock_reservado, 0) - $1, 0)
           WHERE id_obra = $2`,
          [row.cantidad, row.id_obra]
        );
      }

      // Enviar email de confirmación al cliente
      try {
        // Datos del cliente
        const clienteRes = await pool.query(
          `SELECT u.correo, u.nombre_completo
           FROM pedidos p
           JOIN usuarios u ON u.id_usuario = p.id_cliente
           WHERE p.id_pedido = $1`,
          [id_pedido]
        );

        if (clienteRes.rows.length > 0) {
          const { correo, nombre_completo } = clienteRes.rows[0];

          // Items del pedido con datos de obra
          const itemsRes = await pool.query(
            `SELECT
               o.titulo,
               COALESCE(a.nombre_artistico, a.nombre_completo) AS artista_alias,
               v.cantidad,
               v.precio_unitario,
               o.imagen_principal
             FROM ventas v
             JOIN obras    o ON o.id_obra    = v.id_obra
             JOIN artistas a ON a.id_artista = v.id_artista
             WHERE v.id_pedido = $1`,
            [id_pedido]
          );

          // Total del pedido
          const totalRes = await pool.query(
            `SELECT total FROM pedidos WHERE id_pedido = $1`,
            [id_pedido]
          );
          const total = Number(totalRes.rows[0]?.total || 0);

          await sendConfirmacionPedidoEmail(
            correo,
            nombre_completo,
            id_pedido,
            itemsRes.rows,
            total
          );
        }
      } catch (emailErr) {
        // No detener el flujo si el email falla
        logger.error(`Error enviando email confirmacion pedido #${id_pedido}: ${emailErr.message}`);
      }
    }

    logger.info(`Webhook MP: pago ${paymentId} → ${nuevoEstado} (pedido #${id_pedido})`);
    return res.sendStatus(200);
  } catch (error) {
    logger.error(`Error en webhookPago: ${error.message}`);
    return res.sendStatus(500);
  }
};
