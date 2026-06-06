import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';
import { preference, payment } from '../config/mercadopagoConfig.js';

// =========================================================
// GET /api/ventas/mis-pedidos
// Historial de compras del cliente autenticado
// =========================================================
export const getMisPedidos = async (req, res) => {
  try {
    const db         = pools[req.user?.rol] || pool;
    const id_usuario = req.user?.id_usuario;

    const result = await db.query(`
      SELECT
        v.id_venta,
        v.estado,
        v.fecha_venta,
        v.cantidad,
        v.precio_unitario,
        v.subtotal,
        v.total,
        o.titulo,
        o.slug,
        o.imagen_principal,
        COALESCE(a.nombre_artistico, a.nombre_completo) AS artista_alias
      FROM   ventas v
      INNER JOIN obras    o ON o.id_obra    = v.id_obra
      INNER JOIN artistas a ON a.id_artista = v.id_artista
      WHERE  v.id_cliente = $1
      ORDER BY v.fecha_venta DESC
      LIMIT  50
    `, [id_usuario]);

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('getMisPedidos error:', err.message);
    return res.status(500).json({ success: false, message: 'Error al obtener pedidos' });
  }
};

// =========================================================
// POST /api/ventas/checkout
// Crea preferencia de pago en MercadoPago desde el carrito
// =========================================================
export const checkout = async (req, res) => {
  const db         = pools[req.user?.rol] || pool;
  const id_cliente = req.user.id_usuario;
  const { id_direccion_envio } = req.body;

  try {
    // 1. Obtener items del carrito activo con datos de obra
    const carritoRes = await db.query(`
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
    `, [id_cliente]);

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

    // 3. Crear registros de venta en estado 'pendiente'
    const ventasIds = [];
    for (const item of carritoRes.rows) {
      const precio_unitario = Number(item.precio_base);
      const subtotal        = precio_unitario * item.cantidad;

      const ventaRes = await db.query(`
        INSERT INTO ventas
          (id_cliente, id_obra, id_artista, cantidad, precio_unitario, subtotal, total, estado, fecha_venta, id_direccion_envio)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', NOW(), $8)
        RETURNING id_venta
      `, [id_cliente, item.id_obra, item.id_artista, item.cantidad, precio_unitario, subtotal, subtotal, id_direccion_envio]);

      ventasIds.push(ventaRes.rows[0].id_venta);

      // Reservar stock
      await db.query(`
        UPDATE inventario
        SET stock_reservado = COALESCE(stock_reservado, 0) + $1
        WHERE id_obra = $2
      `, [item.cantidad, item.id_obra]);
    }

    // 4. Vaciar carrito
    await db.query(`
      UPDATE carritos SET activo = false
      WHERE id_usuario = $1 AND activo = true
    `, [id_cliente]);

    // 5. Crear preferencia en MercadoPago
    const items = carritoRes.rows.map(item => ({
      id:          String(item.id_obra),
      title:       item.titulo,
      quantity:    item.cantidad,
      unit_price:  Number(item.precio_base),
      currency_id: 'MXN',
      picture_url: item.imagen_principal || undefined,
    }));

    const isProd = process.env.NODE_ENV === 'production';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const backendUrl  = process.env.BACKEND_URL  || 'http://localhost:4000';

    const prefBody = {
      items,
      external_reference:   ventasIds.join(','),
      notification_url:     `${backendUrl}/api/ventas/webhook`,
      statement_descriptor: 'NUB Studio',
      back_urls: {
        success: `${frontendUrl}/mi-cuenta/pedidos?status=success`,
        failure: `${frontendUrl}/mi-cuenta/pedidos?status=failure`,
        pending: `${frontendUrl}/mi-cuenta/pedidos?status=pending`,
      },
    };

    // auto_return solo funciona con HTTPS en producción
    if (isProd) prefBody.auto_return = 'approved';

    const prefResult = await preference.create({ body: prefBody });

    logger.info(`Checkout: cliente ${id_cliente} - ventas ${ventasIds.join(',')} - preferencia ${prefResult.id}`);

    return res.json({
      success:       true,
      preference_id: prefResult.id,
      init_point:    prefResult.init_point,       // URL de pago (producción)
      sandbox_init_point: prefResult.sandbox_init_point, // URL de pago (sandbox)
      ventas_ids:    ventasIds,
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

    // Solo procesamos notificaciones de pago
    if (type !== 'payment') {
      return res.sendStatus(200);
    }

    const paymentId = data?.id;
    if (!paymentId) return res.sendStatus(200);

    // Consultar el pago en MercadoPago
    const { MercadoPagoConfig, Payment: MPPayment } = await import('mercadopago');
    const client    = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const mpPayment = new MPPayment(client);
    const pagoInfo  = await mpPayment.get({ id: paymentId });

    const status           = pagoInfo.status;           // approved | rejected | pending
    const external_ref     = pagoInfo.external_reference; // "id_venta1,id_venta2"

    if (!external_ref) return res.sendStatus(200);

    const ventasIds  = external_ref.split(',').map(Number).filter(Boolean);
    const nuevoEstado = status === 'approved' ? 'pagado'
                      : status === 'rejected' ? 'cancelado'
                      : 'pendiente';

    // Actualizar estado de ventas
    await pool.query(
      `UPDATE ventas SET estado = $1 WHERE id_venta = ANY($2::int[])`,
      [nuevoEstado, ventasIds]
    );

    // Si fue rechazado, liberar stock reservado
    if (status === 'rejected') {
      const obras = await pool.query(
        `SELECT id_obra, cantidad FROM ventas WHERE id_venta = ANY($1::int[])`,
        [ventasIds]
      );
      for (const row of obras.rows) {
        await pool.query(
          `UPDATE inventario SET stock_reservado = GREATEST(COALESCE(stock_reservado, 0) - $1, 0) WHERE id_obra = $2`,
          [row.cantidad, row.id_obra]
        );
      }
    }

    // Si fue aprobado, descontar stock real
    if (status === 'approved') {
      const obras = await pool.query(
        `SELECT id_obra, cantidad FROM ventas WHERE id_venta = ANY($1::int[])`,
        [ventasIds]
      );
      for (const row of obras.rows) {
        await pool.query(
          `UPDATE inventario
           SET stock_actual   = GREATEST(COALESCE(stock_actual, 0) - $1, 0),
               stock_reservado = GREATEST(COALESCE(stock_reservado, 0) - $1, 0)
           WHERE id_obra = $2`,
          [row.cantidad, row.id_obra]
        );
      }
    }

    logger.info(`Webhook MP: pago ${paymentId} → ${nuevoEstado} (ventas: ${ventasIds.join(',')})`);
    return res.sendStatus(200);
  } catch (error) {
    logger.error(`Error en webhookPago: ${error.message}`);
    return res.sendStatus(500);
  }
};
