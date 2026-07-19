-- ============================================================
-- CARRITOS REALISTAS — distribución de cola larga
-- Reemplaza los carritos seed (antes 100 clientes con 2 ítems fijos)
-- por una distribución realista: la mayoría vacíos, varios con 1-2,
-- y una minoría con 3, 4, 5, 6, 7 u 8 productos.
-- Los ítems salen de los favoritos del cliente (coherentes con su gusto).
-- Idempotente: limpia los carritos seed y los reconstruye.
-- ============================================================
DO $$
DECLARE
  r RECORD; uid INT; n_items INT; rr NUMERIC; nfav INT;
  total_items INT := 0; con_carrito INT := 0;
BEGIN
  -- Reconstruir desde cero (solo carritos de clientes seed)
  DELETE FROM carritos WHERE id_usuario IN (
    SELECT id_usuario FROM usuarios WHERE correo LIKE 'cliente_seed_%');

  FOR r IN
    SELECT id_usuario FROM usuarios WHERE correo LIKE 'cliente_seed_%' ORDER BY id_usuario
  LOOP
    uid := r.id_usuario;
    rr := random();
    -- Distribución sesgada (long tail) típica de e-commerce:
    n_items := CASE
      WHEN rr < 0.50 THEN 0        -- 50% carrito vacío
      WHEN rr < 0.66 THEN 1        -- 16%
      WHEN rr < 0.78 THEN 2        -- 12%
      WHEN rr < 0.87 THEN 3        --  9%
      WHEN rr < 0.93 THEN 4        --  6%
      WHEN rr < 0.97 THEN 5        --  4%
      WHEN rr < 0.99 THEN 6        --  2%
      ELSE 7 + (random()*2)::INT   --  1% → 7 u 8 (cola larga)
    END;
    CONTINUE WHEN n_items = 0;

    -- Nunca más ítems que favoritos disponibles
    SELECT COUNT(*) INTO nfav FROM favoritos WHERE id_usuario = uid;
    n_items := LEAST(n_items, nfav);
    CONTINUE WHEN n_items = 0;

    INSERT INTO carritos (id_usuario, id_obra, cantidad, activo, fecha_agregado)
      SELECT uid, f.id_obra, 1, TRUE, NOW() - ((random()*30)::INT || ' days')::INTERVAL
      FROM favoritos f WHERE f.id_usuario = uid
      ORDER BY random() LIMIT n_items
      ON CONFLICT DO NOTHING;

    con_carrito := con_carrito + 1;
    total_items := total_items + n_items;
  END LOOP;

  RAISE NOTICE 'Carritos reconstruidos: % clientes con carrito, % ítems en total.', con_carrito, total_items;
END $$;
