import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';
import { preference, payment } from '../config/mercadopagoConfig.js';
import { sendConfirmacionPedidoEmail, sendEnvioEmail, sendListoRecogerEmail } from '../services/emailService.js';

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
        p.estado              AS estado_pedido,
        p.total               AS total_pedido,
        p.fecha_pedido,
        p.descuento_cupon,
        c.codigo              AS codigo_cupon,
        v.id_venta,
        v.estado              AS estado_venta,
        v.cantidad,
        v.precio_unitario,
        v.subtotal,
        v.total,
        v.numero_guia,
        o.titulo,
        o.slug,
        o.imagen_principal,
        COALESCE(a.nombre_artistico, a.nombre_completo) AS artista_alias
      FROM   pedidos p
      INNER JOIN ventas   v ON v.id_pedido  = p.id_pedido
      INNER JOIN obras    o ON o.id_obra    = v.id_obra
      INNER JOIN artistas a ON a.id_artista = v.id_artista
      LEFT  JOIN cupones  c ON c.id_cupon   = p.id_cupon
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

  try {
    // ids_carrito opcionales: si se mandan, solo procesa esos items
    const { id_direccion_envio, ids_carrito, codigo_cupon, empaque_reforzado, precio_empaque } = req.body;
    const filtroIds = Array.isArray(ids_carrito) && ids_carrito.length > 0
      ? ids_carrito.map(Number).filter(Boolean)
      : null;
    const costoEmpaque = empaque_reforzado ? Math.max(0, Number(precio_empaque) || 0) : 0;

    // 1. Obtener items del carrito activo con datos de obra (incluyendo precio efectivo)
    let carritoQuery = `
      SELECT
        c.id_carrito,
        c.id_obra,
        c.cantidad,
        o.id_artista,
        o.titulo,
        o.precio_base,
        o.imagen_principal,
        CASE
          WHEN o.precio_descuento IS NOT NULL
            AND (o.descuento_expira IS NULL OR o.descuento_expira > NOW())
          THEN o.precio_descuento
          ELSE o.precio_base
        END AS precio_efectivo,
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

    // 3. Calcular total del pedido usando precio_efectivo
    const subtotalBruto = carritoRes.rows.reduce((sum, item) => {
      return sum + Number(item.precio_efectivo) * item.cantidad;
    }, 0);

    // 3b. Validar y aplicar cupón si se envió
    let descuentoCupon = 0;
    let idCupon = null;
    if (codigo_cupon?.trim()) {
      const cuponRes = await pool.query(
        `SELECT * FROM cupones
         WHERE codigo = UPPER($1) AND activo = TRUE
           AND (fecha_fin IS NULL OR fecha_fin > NOW())
           AND (usos_max  IS NULL OR usos_actuales < usos_max)`,
        [codigo_cupon.trim()]
      );
      if (cuponRes.rows.length > 0) {
        const cupon = cuponRes.rows[0];
        const yaUsado = await pool.query(
          "SELECT id FROM cupones_usados WHERE id_cupon=$1 AND id_usuario=$2",
          [cupon.id_cupon, id_cliente]
        );
        if (yaUsado.rows.length === 0 && subtotalBruto >= Number(cupon.monto_minimo)) {
          descuentoCupon = cupon.tipo === 'porcentaje'
            ? (subtotalBruto * Number(cupon.valor)) / 100
            : Math.min(Number(cupon.valor), subtotalBruto);
          descuentoCupon = Math.round(descuentoCupon * 100) / 100;
          idCupon = cupon.id_cupon;
        }
      }
    }
    const totalPedido = Math.max(0, subtotalBruto - descuentoCupon + costoEmpaque);

    // 4. Crear registro en tabla pedidos
    const pedidoRes = await db.query(`
      INSERT INTO pedidos (id_cliente, id_direccion_envio, estado, total, id_cupon, descuento_cupon, fecha_pedido)
      VALUES ($1, $2, 'pendiente', $3, $4, $5, NOW())
      RETURNING id_pedido
    `, [id_cliente, id_direccion_envio || null, totalPedido, idCupon, descuentoCupon]);

    const id_pedido = pedidoRes.rows[0].id_pedido;

    // 4b. Registrar uso del cupón
    if (idCupon) {
      await pool.query(
        "INSERT INTO cupones_usados (id_cupon, id_usuario, id_pedido, descuento_aplicado) VALUES ($1,$2,$3,$4)",
        [idCupon, id_cliente, id_pedido, descuentoCupon]
      );
      await pool.query(
        "UPDATE cupones SET usos_actuales = usos_actuales + 1 WHERE id_cupon = $1",
        [idCupon]
      );
    }

    // 5. Crear registros de venta vinculados al pedido
    const ventasIds = [];
    for (const item of carritoRes.rows) {
      const precio_unitario = Number(item.precio_efectivo);
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
    const mpItems = carritoRes.rows.map(item => ({
      id: String(item.id_obra),
      title: item.titulo,
      quantity: item.cantidad,
      unit_price: Number(item.precio_efectivo),
      currency_id: 'MXN',
      picture_url: item.imagen_principal || undefined,
    }));
    // Cupón: distribuimos el descuento reduciendo el precio unitario del primer ítem
    if (descuentoCupon > 0 && mpItems.length > 0) {
      mpItems[0] = { ...mpItems[0], unit_price: Math.max(0.01, mpItems[0].unit_price - descuentoCupon / mpItems[0].quantity) };
    }
    // Empaque reforzado: ítem adicional en MP
    if (costoEmpaque > 0) {
      mpItems.push({ id: 'empaque_reforzado', title: 'Empaque reforzado', quantity: 1, unit_price: costoEmpaque, currency_id: 'MXN' });
    }
    const items = mpItems;

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

// =========================================================
// PUT /api/ventas/mis-pedidos/:id/cancelar
// Cliente cancela su propio pedido pendiente
// =========================================================
export const cancelarMiPedido = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const id_usuario = req.user?.id_usuario;
    const id_pedido  = Number(req.params.id);

    if (!id_pedido)
      return res.status(400).json({ success: false, message: 'ID de pedido inválido' });

    const pedidoRes = await db.query(
      `SELECT id_pedido, estado FROM pedidos WHERE id_pedido = $1 AND id_cliente = $2`,
      [id_pedido, id_usuario]
    );
    if (pedidoRes.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
    if (pedidoRes.rows[0].estado !== 'pendiente')
      return res.status(400).json({ success: false, message: 'Solo se pueden cancelar pedidos pendientes de pago' });

    const ventasRes = await db.query(
      `SELECT id_obra, cantidad FROM ventas WHERE id_pedido = $1`,
      [id_pedido]
    );
    for (const row of ventasRes.rows) {
      await db.query(
        `UPDATE inventario SET stock_reservado = GREATEST(COALESCE(stock_reservado, 0) - $1, 0) WHERE id_obra = $2`,
        [row.cantidad, row.id_obra]
      );
    }
    await db.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = $1`, [id_pedido]);
    await db.query(`UPDATE ventas  SET estado = 'cancelado' WHERE id_pedido = $1`, [id_pedido]);

    logger.info(`Pedido #${id_pedido} cancelado por cliente #${id_usuario}`);
    return res.json({ success: true, message: 'Pedido cancelado correctamente' });
  } catch (err) {
    logger.error('cancelarMiPedido error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Error al cancelar el pedido' });
  }
};

// =========================================================
// GET /api/admin/ventas-admin
// Admin: listar ventas con paginación y filtros
// =========================================================
export const getVentasAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 15, estado } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params = [];
    let where = '';

    if (estado) {
      params.push(estado);
      where = `WHERE v.estado = $${params.length}`;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM ventas v ${where}`,
      params
    );
    const total      = Number(countRes.rows[0].count);
    const totalPages = Math.ceil(total / Number(limit)) || 1;

    const dataParams = [...params, Number(limit), offset];
    const dataRes = await pool.query(`
      SELECT
        v.id_venta,
        u.nombre_completo                                 AS cliente_nombre,
        u.correo                                          AS cliente_correo,
        o.titulo                                          AS obra_titulo,
        o.imagen_principal,
        COALESCE(a.nombre_artistico, a.nombre_completo)   AS artista_alias,
        v.cantidad,
        v.precio_unitario,
        v.total,
        v.estado,
        v.fecha_venta                                     AS fecha_creacion,
        v.id_pedido,
        p.estado                                          AS estado_pedido,
        p.descuento_cupon,
        p.total                                           AS total_pedido
      FROM ventas v
      JOIN usuarios u ON u.id_usuario  = v.id_cliente
      JOIN obras    o ON o.id_obra     = v.id_obra
      JOIN artistas a ON a.id_artista  = v.id_artista
      JOIN pedidos  p ON p.id_pedido   = v.id_pedido
      ${where}
      ORDER BY v.fecha_venta DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `, dataParams);

    return res.json({
      success: true,
      data: dataRes.rows,
      pagination: { total, page: Number(page), limit: Number(limit), totalPages },
    });
  } catch (err) {
    logger.error('getVentasAdmin error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Error al obtener ventas' });
  }
};

// =========================================================
// PUT /api/admin/ventas-admin/:id/estado
// Admin: cambiar estado de una venta + número de guía opcional
// =========================================================
export const cambiarEstadoVenta = async (req, res) => {
  try {
    const id_venta = Number(req.params.id);
    const { estado, numero_guia } = req.body;

    const estadosValidos = ['pendiente', 'pagado', 'procesando', 'enviado', 'listo_recoger', 'entregado', 'cancelado'];
    if (!estadosValidos.includes(estado))
      return res.status(400).json({ success: false, message: 'Estado inválido' });

    const ventaRes = await pool.query(
      `SELECT v.*, u.correo, u.nombre_completo FROM ventas v
       JOIN usuarios u ON u.id_usuario = v.id_cliente
       WHERE v.id_venta = $1`,
      [id_venta]
    );
    if (ventaRes.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Venta no encontrada' });

    const venta = ventaRes.rows[0];

    // Liberar stock reservado si se cancela desde estado activo
    if (estado === 'cancelado' && ['pendiente', 'pagado', 'procesando'].includes(venta.estado)) {
      await pool.query(
        `UPDATE inventario SET stock_reservado = GREATEST(COALESCE(stock_reservado, 0) - $1, 0) WHERE id_obra = $2`,
        [venta.cantidad, venta.id_obra]
      );
    }

    // Actualizar estado — guardar número de guía si se envía
    if (estado === 'enviado' && numero_guia?.trim()) {
      await pool.query(
        `UPDATE ventas SET estado = $1, numero_guia = $2 WHERE id_venta = $3`,
        [estado, numero_guia.trim(), id_venta]
      );
    } else {
      await pool.query(`UPDATE ventas SET estado = $1 WHERE id_venta = $2`, [estado, id_venta]);
    }

    // Sincronizar pedido cuando todas sus ventas tienen el mismo estado
    const pedidoVentasRes = await pool.query(
      `SELECT DISTINCT estado FROM ventas WHERE id_pedido = $1`,
      [venta.id_pedido]
    );
    if (pedidoVentasRes.rows.length === 1) {
      await pool.query(
        `UPDATE pedidos SET estado = $1 WHERE id_pedido = $2`,
        [pedidoVentasRes.rows[0].estado, venta.id_pedido]
      );
    }

    // Email al cliente cuando se marca como enviado
    if (estado === 'enviado') {
      try {
        await sendEnvioEmail(venta.correo, venta.nombre_completo, venta.id_pedido, numero_guia?.trim() || null);
      } catch (emailErr) {
        logger.error(`Error enviando email envio venta #${id_venta}: ${emailErr.message}`);
      }
    }

    // Email al cliente cuando está listo para recoger
    if (estado === 'listo_recoger') {
      try {
        await sendListoRecogerEmail(venta.correo, venta.nombre_completo, venta.id_pedido);
      } catch (emailErr) {
        logger.error(`Error enviando email listo_recoger venta #${id_venta}: ${emailErr.message}`);
      }
    }

    logger.info(`Admin: venta #${id_venta} → ${estado}${numero_guia ? ` guía=${numero_guia}` : ''}`);
    return res.json({ success: true, message: `Estado actualizado a "${estado}"` });
  } catch (err) {
    logger.error('cambiarEstadoVenta error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Error al actualizar estado' });
  }
};

// =========================================================
// CRON INTERNO: Auto-cancelar pedidos pendientes > 3 días
// =========================================================
export const autoCancelarPendientes = async () => {
  try {
    const pendientesRes = await pool.query(
      `SELECT id_pedido FROM pedidos WHERE estado = 'pendiente' AND fecha_pedido < NOW() - INTERVAL '3 days'`
    );
    if (pendientesRes.rows.length === 0) {
      logger.info('Auto-cancelación: sin pedidos pendientes vencidos.');
      return;
    }
    let cancelados = 0;
    for (const { id_pedido } of pendientesRes.rows) {
      const ventasRes = await pool.query(
        `SELECT id_obra, cantidad FROM ventas WHERE id_pedido = $1`, [id_pedido]
      );
      for (const v of ventasRes.rows) {
        await pool.query(
          `UPDATE inventario SET stock_reservado = GREATEST(COALESCE(stock_reservado, 0) - $1, 0) WHERE id_obra = $2`,
          [v.cantidad, v.id_obra]
        );
      }
      await pool.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = $1`, [id_pedido]);
      await pool.query(`UPDATE ventas  SET estado = 'cancelado' WHERE id_pedido = $1`, [id_pedido]);
      cancelados++;
    }
    logger.info(`Auto-cancelación: ${cancelados} pedido(s) cancelado(s).`);
  } catch (err) {
    logger.error(`autoCancelarPendientes error: ${err.message}`);
  }
};
