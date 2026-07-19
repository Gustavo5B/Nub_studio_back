-- ============================================================
-- OBRAS DIMENSIONADAS — PINTURA Y ESCULTURA (señal para ML)
-- 1) Rellena dimensiones + precio-por-tamaño en las obras seed
--    de Pintura/Escultura que estaban en NULL.
-- 2) Agrega 40 obras nuevas (20 Pintura + 20 Escultura) con
--    tamaños 30×40 / 60×80 / 100×120 / 150×200 y precio escalado.
-- El precio depende del tamaño (área) y de la técnica → señal real.
-- Idempotente (slug 'seed-dim-obra-*'). Corre en una transacción.
-- ============================================================
DO $$
DECLARE
  -- Tamaños (ancho×alto en cm) y precio base por tamaño
  anchos NUMERIC[] := ARRAY[30, 60, 100, 150];
  altos  NUMERIC[] := ARRAY[40, 80, 120, 200];
  profs  NUMERIC[] := ARRAY[15, 30, 45, 60];      -- profundidad para escultura
  bases  NUMERIC[] := ARRAY[1800, 4200, 7000, 9000];

  -- Técnicas reales del catálogo
  tec_pin INT[] := ARRAY[6, 7, 8, 9];             -- Óleo, Acuarela, Acrílico, Temple
  tec_esc INT[] := ARRAY[40, 41, 42, 43];         -- Barro, Talla madera, Talla piedra, Fundición(bronce)

  tit_pin TEXT[] := ARRAY[
    'Retrato de la Sierra','Bodegón Huasteco','Paisaje Huasteco','Mujer con Rebozo',
    'Flores de Cempasúchil','Calle de Molango','Río del Pantepec','Naturaleza Viva',
    'Danza en Color','Cañada al Amanecer','Frutos de la Milpa','Rostro Ancestral',
    'Sombras de la Huasteca','Ventana al Pantepec','Luz de Octubre'];
  tit_esc TEXT[] := ARRAY[
    'Figura Ritual','Tótem Tenek','Torso Ancestral','Ofrenda Ceremonial','Máscara Ceremonial',
    'Nahual de la Sierra','Ídolo de la Sierra','Vasija Escultórica','Guerrero Huasteco',
    'Ave Sagrada','Manos que Crean','Monolito Verde','Espiral del Tiempo',
    'Danzante Eterno','Deidad del Maíz'];

  art_pin INT[]; art_esc INT[];
  img_pin TEXT[]; img_esc TEXT[];
  hist TEXT := 'Pieza que dialoga con el paisaje, los materiales y las tradiciones de la Huasteca Hidalguense.';

  r RECORD; sidx INT; tmul NUMERIC; precio NUMERIC; prof_val NUMERIC;
  aid INT; uid INT; cid INT; oid INT; tec INT; tnom TEXT; cat INT;
  obra_tit TEXT; img1 TEXT; n_back INT := 0; n_new INT := 0; i INT;
BEGIN
  SELECT array_agg(id_artista ORDER BY id_artista) INTO art_pin
    FROM artistas WHERE correo LIKE 'artista_seed_%' AND id_categoria_principal = 2;
  SELECT array_agg(id_artista ORDER BY id_artista) INTO art_esc
    FROM artistas WHERE correo LIKE 'artista_seed_%' AND id_categoria_principal = 3;
  SELECT array_agg(DISTINCT imagen_principal) INTO img_pin
    FROM obras WHERE slug LIKE 'seed-obra-%' AND imagen_principal LIKE '%/seed/pintura/%';
  SELECT array_agg(DISTINCT imagen_principal) INTO img_esc
    FROM obras WHERE slug LIKE 'seed-obra-%' AND imagen_principal LIKE '%/seed/ceramica/%';

  IF art_pin IS NULL OR art_esc IS NULL THEN
    RAISE EXCEPTION 'Faltan artistas seed de Pintura/Escultura. ¿Corriste el seed completo?';
  END IF;

  -- Asegura etiquetas de categoría
  INSERT INTO etiquetas (nombre, slug, activa)
    SELECT 'Pintura','pintura',TRUE WHERE NOT EXISTS (SELECT 1 FROM etiquetas WHERE slug='pintura');
  INSERT INTO etiquetas (nombre, slug, activa)
    SELECT 'Escultura','escultura',TRUE WHERE NOT EXISTS (SELECT 1 FROM etiquetas WHERE slug='escultura');

  -- ========================================================
  -- PARTE A — Backfill de dimensiones + precio en obras seed
  --           existentes de Pintura(2) y Escultura(3)
  -- ========================================================
  FOR r IN
    SELECT id_obra, id_categoria, id_tecnica FROM obras
    WHERE slug LIKE 'seed-obra-%' AND id_categoria IN (2,3) AND dimensiones_alto IS NULL
    ORDER BY id_obra
  LOOP
    n_back := n_back + 1;
    sidx := (n_back % 4) + 1;                      -- cicla los 4 tamaños
    tmul := CASE r.id_tecnica
      WHEN 6 THEN 1.15 WHEN 7 THEN 0.85 WHEN 8 THEN 1.00 WHEN 9 THEN 0.95   -- pintura
      WHEN 40 THEN 0.90 WHEN 41 THEN 1.05 WHEN 42 THEN 1.20 WHEN 43 THEN 1.35 -- escultura
      ELSE 1.00 END;
    precio := ROUND(bases[sidx] * tmul * (0.92 + random()*0.16) / 50) * 50;
    prof_val := CASE WHEN r.id_categoria = 3 THEN profs[sidx] ELSE NULL END;
    UPDATE obras SET
      dimensiones_ancho = anchos[sidx], dimensiones_alto = altos[sidx],
      dimensiones_profundidad = prof_val, dimensiones_unidad = 'cm',
      precio_base = precio, fecha_actualizacion = NOW()
      WHERE id_obra = r.id_obra;
  END LOOP;
  RAISE NOTICE 'Backfill: % obras Pintura/Escultura ahora tienen dimensiones y precio por tamaño.', n_back;

  -- ========================================================
  -- PARTE B — 40 obras nuevas dimensionadas (20 Pintura + 20 Escultura)
  -- ========================================================
  FOR i IN 1..40 LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM obras WHERE slug = 'seed-dim-obra-'||i);
    sidx := ((i-1) % 4) + 1;

    IF i <= 20 THEN
      cat := 2;
      aid := art_pin[((i-1) % array_length(art_pin,1)) + 1];
      tec := tec_pin[sidx];
      obra_tit := tit_pin[((i-1) % array_length(tit_pin,1)) + 1] || ' ' || i;
      img1 := img_pin[((i-1) % array_length(img_pin,1)) + 1];
      prof_val := NULL;
    ELSE
      cat := 3;
      aid := art_esc[((i-21) % array_length(art_esc,1)) + 1];
      tec := tec_esc[sidx];
      obra_tit := tit_esc[((i-21) % array_length(tit_esc,1)) + 1] || ' ' || (i-20);
      img1 := img_esc[((i-21) % array_length(img_esc,1)) + 1];
      prof_val := profs[sidx];
    END IF;

    SELECT nombre INTO tnom FROM tecnicas WHERE id_tecnica = tec;
    SELECT id_usuario INTO uid FROM artistas WHERE id_artista = aid;
    SELECT id_coleccion INTO cid FROM colecciones
      WHERE id_artista = aid AND slug LIKE 'seed-col-%' ORDER BY id_coleccion LIMIT 1;

    tmul := CASE tec
      WHEN 6 THEN 1.15 WHEN 7 THEN 0.85 WHEN 8 THEN 1.00 WHEN 9 THEN 0.95
      WHEN 40 THEN 0.90 WHEN 41 THEN 1.05 WHEN 42 THEN 1.20 WHEN 43 THEN 1.35 ELSE 1.00 END;
    precio := ROUND(bases[sidx] * tmul * (0.92 + random()*0.16) / 50) * 50;

    INSERT INTO obras (
      titulo, slug, descripcion, historia, id_categoria, id_tecnica, id_artista,
      id_usuario_creacion, tecnica, anio_creacion, precio_base,
      dimensiones_ancho, dimensiones_alto, dimensiones_profundidad, dimensiones_unidad,
      permite_marco, con_certificado, imagen_principal, id_coleccion,
      estado, activa, visible, fecha_creacion, fecha_actualizacion)
    VALUES (
      obra_tit, 'seed-dim-obra-'||i,
      'Obra original de la tradición Huasteca, con dimensiones y precio acordes a su tamaño y técnica.',
      hist, cat, tec, aid, uid, tnom, 2019 + (i % 6), precio,
      anchos[sidx], altos[sidx], prof_val, 'cm',
      (cat = 2), (i % 3 = 0), img1, cid,
      'publicada', TRUE, TRUE, NOW() - ((i * 2) || ' days')::INTERVAL, NOW())
    RETURNING id_obra INTO oid;

    INSERT INTO inventario (id_obra, stock_actual, stock_reservado, stock_vendido, activo)
      VALUES (oid, 1 + (i % 3), 0, 0, TRUE);
    INSERT INTO imagenes_obras (id_obra, url_imagen, orden, es_principal, activa)
      VALUES (oid, img1, 1, TRUE, TRUE);
    INSERT INTO obras_etiquetas (id_obra, id_etiqueta)
      SELECT oid, e.id_etiqueta FROM etiquetas e
      WHERE e.slug IN (CASE WHEN cat=2 THEN 'pintura' ELSE 'escultura' END, 'huasteca')
      ON CONFLICT DO NOTHING;

    n_new := n_new + 1;
  END LOOP;
  RAISE NOTICE 'Nuevas: % obras dimensionadas (Pintura + Escultura) agregadas.', n_new;

  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'Pintura/Escultura con dimensiones tras esto: ver conteo.';
  RAISE NOTICE '════════════════════════════════════════';
END $$;
