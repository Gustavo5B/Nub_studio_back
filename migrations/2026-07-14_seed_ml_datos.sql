-- ============================================================
-- SEED ML — NUB STUDIO
-- Datos ficticios para entrenamiento de modelos de IA
-- Ejecutar UNA SOLA VEZ en Neon SQL Editor
-- Contraseña de todas las cuentas seed: Seed2024!
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  pass_hash    TEXT;
  uid          INTEGER;
  aid          INTEGER;
  oid          INTEGER;
  pid          INTEGER;
  id_art       INTEGER;
  precio_obra  NUMERIC;

  artista_ids  INTEGER[] := ARRAY[]::INTEGER[];
  cliente_ids  INTEGER[] := ARRAY[]::INTEGER[];
  obra_ids     INTEGER[] := ARRAY[]::INTEGER[];
  cat_ids      INTEGER[];
  cat_count    INTEGER;

  i INTEGER; j INTEGER;
  yr INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  mat TEXT;

  cat_a INTEGER; cat_b INTEGER;
  prob  INTEGER;

  -- ── Artistas seed ──────────────────────────────────────────
  a_nombres TEXT[] := ARRAY[
    'Elena Xochitl Téllez',    'Rodrigo Nahua Velázquez',
    'Sofía Cuauhtli Martínez', 'Dante Ixmatlahua Cruz',
    'Valentina Tláloc Herrera','Marco Totonac Domínguez',
    'Isabela Chalma Reyes',    'Fermín Huichol Sánchez'
  ];
  a_nicks TEXT[] := ARRAY[
    'Xochitl Arte','Nahua Visión','Cuauhtli','Ixmat Studio',
    'Tláloc','Totonac Art','Chalma','Huichol'
  ];
  a_bios TEXT[] := ARRAY[
    'Pintora de la Huasteca especializada en acuarela y paisaje serrano.',
    'Escultor que trabaja con barro y materiales naturales de la región.',
    'Pintora de óleos que retrata la vida cotidiana de la Huasteca.',
    'Grabador que fusiona técnicas ancestrales con arte contemporáneo.',
    'Ceramista que rescata las formas de la cerámica huasteca tradicional.',
    'Fotógrafo documental de comunidades indígenas del norte de Hidalgo.',
    'Artista textil con fibras naturales teñidas con pigmentos locales.',
    'Dibujante e ilustrador de flora y fauna de la Sierra Huasteca.'
  ];

  -- ── Títulos de obras seed (70) ─────────────────────────────
  o_titulos TEXT[] := ARRAY[
    'Amanecer en la Huasteca',     'Mercado de Huejutla',
    'Mujer Tenek I',               'Sierra Verde',
    'Río Moctezuma al Atardecer',  'Danza de los Xantolo',
    'Veladoras de Octubre',        'Milpa en Agosto',
    'Ceiba Sagrada',               'Vendedora de Naranjas',
    'Niebla en Molango',           'Cascada de Tamul',
    'Bordado Nahua I',             'Barro Ritual',
    'Jaguar Mítico',               'Maíz y Copal',
    'Paisaje Huasteco II',         'Mujer Nahual',
    'Flores de Cempoaxúchitl',     'El Torito de Petate',
    'Textura de Henequén',         'Rostro de Anciana I',
    'Golfo desde la Sierra',       'Luna Tenek',
    'Canoa en el Pantepec',        'Sembradores',
    'Altar de Muertos Huasteco',   'Palma Tejida',
    'Montes Azules',               'Ritmo de Tambor',
    'Serranía en Lluvia',          'Niño con Guajolote',
    'Curandero I',                 'Tejido de Luz',
    'Horizonte Tropical',          'Danza del Gavilán',
    'Olotillo Dorado',             'Cerámica Negra I',
    'Cañaveral',                   'Murmullo del Río',
    'Árbol de la Vida Huasteco',   'Madre e Hija Nahuas',
    'Obsidiana y Jade',            'Mariposa Monarca',
    'Chapopotera',                 'Paisaje Tenek',
    'Velas en el Agua',            'Aves Migratorias',
    'Caña de Azúcar',              'Carnaval de Huejutla',
    'Selva Baja Caducifolia',      'Tule y Junco',
    'Rostro de Joven Nahua',       'Cacao en Flor',
    'Semana Santa en Xochiatipan', 'Lluvia de Mangos',
    'Barro Negro II',              'Corriente del Amajac',
    'Monte Sagrado',               'Tejidos de la Abuela',
    'Nopal y Maguey',              'Tarde en Tamazunchale',
    'Niebla Huasteca II',          'Pesca en el Tempoal',
    'Iglesia de Huautla',          'Frailes y Niños',
    'Carguero de Leña',            'Curandera con Hierbas',
    'Siembra de Maíz',             'Xantolo Ofrenda'
  ];
  o_tecnicas TEXT[] := ARRAY[
    'Acuarela','Óleo sobre tela','Acrílico','Grabado en madera','Cerámica',
    'Fotografía analógica','Textil bordado','Carboncillo','Pastel','Encáustica'
  ];
  o_precios NUMERIC[] := ARRAY[
    800,1200,1500,2000,2500,3000,3500,4000,5000,
    6000,7500,9000,10000,12000,15000
  ];

  -- ── Nombres y apellidos de clientes (100) ─────────────────
  c_nombres TEXT[] := ARRAY[
    'Ximena','Carlos','Laura','Diego','Ana','Luis','María','Jorge','Claudia','Pablo',
    'Fernanda','Rafael','Daniela','Alejandro','Valeria','Héctor','Gabriela','Andrés','Patricia','Eduardo',
    'Sofía','Ricardo','Natalia','Francisco','Isabel','Javier','Camila','Roberto','Lucía','Miguel',
    'Andrea','Sergio','Karla','Marcos','Verónica','Tomás','Elena','Emilio','Diana','César',
    'Paulina','Enrique','Mónica','Arturo','Lorena','Rodrigo','Fabiola','Mauricio','Beatriz','Salvador',
    'Stephanie','Omar','Yolanda','Ramón','Alicia','Hugo','Silvia','Agustín','Rebeca','Ernesto',
    'Adriana','Armando','Sandra','Raúl','Esperanza','Ignacio','Mariana','Gerardo','Liliana','Antonio',
    'Teresa','Benjamín','Esther','Iván','Concepción','Felipe','Victoria','Gustavo','Angélica','Oscar',
    'Irene','Daniel','Pilar','Marco','Leticia','Julián','Graciela','Saúl','Elisa','Nicolás',
    'Blanca','Martín','Ofelia','Jaime','Norma','Jesús','Alma','Efraín','Rosario','Samuel'
  ];
  c_apellidos TEXT[] := ARRAY[
    'García','Martínez','López','Hernández','González','Pérez','Sánchez','Ramírez','Torres','Flores',
    'Rivera','Gómez','Díaz','Cruz','Morales','Reyes','Jiménez','Vargas','Castillo','Ramos',
    'Gutiérrez','Ortiz','Chávez','Ruiz','Álvarez','Mendoza','Moreno','Delgado','Vega','Romero'
  ];

BEGIN

  pass_hash := crypt('Seed2024!', gen_salt('bf'));

  -- Obtener categorías existentes
  SELECT ARRAY(SELECT id_categoria FROM categorias ORDER BY id_categoria) INTO cat_ids;
  cat_count := COALESCE(array_length(cat_ids, 1), 0);
  IF cat_count = 0 THEN
    RAISE EXCEPTION 'No hay categorías en la DB. Inserta categorías primero.';
  END IF;
  RAISE NOTICE 'Categorías disponibles: %', cat_count;

  -- ==========================================================
  -- 1. ARTISTAS SEED (8)
  -- ==========================================================
  FOR i IN 1..8 LOOP
    SELECT id_usuario INTO uid
      FROM usuarios WHERE correo = 'artista_seed_' || i || '@nub.mx' LIMIT 1;

    IF uid IS NULL THEN
      INSERT INTO usuarios (nombre_completo, correo, contraseña_hash, rol, estado, activo, verificado)
        VALUES (a_nombres[i], 'artista_seed_' || i || '@nub.mx', pass_hash,
                'artista', 'activo', TRUE, TRUE)
        RETURNING id_usuario INTO uid;
    END IF;

    SELECT id_artista INTO aid
      FROM artistas WHERE correo = 'artista_seed_' || i || '@nub.mx' LIMIT 1;

    IF aid IS NULL THEN
      mat := 'NUB-' || yr || '-SEED-' || LPAD(i::TEXT, 3, '0');
      INSERT INTO artistas (
        id_usuario, nombre_completo, nombre_artistico, biografia, correo,
        matricula, estado, activo, eliminado, porcentaje_comision
      ) VALUES (
        uid, a_nombres[i], a_nicks[i], a_bios[i],
        'artista_seed_' || i || '@nub.mx',
        mat, 'activo', TRUE, FALSE, 15
      ) RETURNING id_artista INTO aid;
    END IF;

    artista_ids := array_append(artista_ids, aid);
  END LOOP;
  RAISE NOTICE 'Artistas procesados: %', array_length(artista_ids, 1);

  -- ==========================================================
  -- 2. OBRAS SEED (70)
  -- ==========================================================
  FOR j IN 1..array_length(o_titulos, 1) LOOP
    -- Obra ya existe? (idempotente)
    IF EXISTS (SELECT 1 FROM obras WHERE slug = 'seed-obra-' || j) THEN
      SELECT id_obra INTO oid FROM obras WHERE slug = 'seed-obra-' || j LIMIT 1;
      obra_ids := array_append(obra_ids, oid);
      CONTINUE;
    END IF;

    -- Artista rotativo entre los seed
    aid := artista_ids[((j-1) % array_length(artista_ids, 1)) + 1];
    -- Categoría rotativa entre las existentes (patrón sesgado)
    -- j mod cat_count para distribución equitativa
    -- pero con sesgo: obras 1-20 en cat 1-2, 21-40 en cat 2-3, etc.
    IF cat_count >= 4 THEN
      cat_a := cat_ids[((j-1) % cat_count) + 1];
    ELSE
      cat_a := cat_ids[((j-1) % cat_count) + 1];
    END IF;

    -- Obtener id_usuario del artista
    SELECT id_usuario INTO uid FROM artistas WHERE id_artista = aid LIMIT 1;

    INSERT INTO obras (
      titulo, slug, descripcion, historia,
      id_categoria, id_artista, id_usuario_creacion,
      tecnica, anio_creacion, precio_base,
      permite_marco, con_certificado, imagen_principal,
      estado, activa, visible,
      fecha_creacion, fecha_actualizacion
    ) VALUES (
      o_titulos[j],
      'seed-obra-' || j,
      'Obra de arte original de la tradición Huasteca. Pieza que refleja la cultura y el paisaje de la Huasteca Hidalguense.',
      'Esta obra nace de la observación directa de la naturaleza y las tradiciones de la región.',
      cat_a,
      aid,
      uid,
      o_tecnicas[((j-1) % array_length(o_tecnicas, 1)) + 1],
      2020 + ((j-1) % 5),
      o_precios[((j-1) % array_length(o_precios, 1)) + 1],
      TRUE, TRUE, NULL,
      'publicada', TRUE, TRUE,
      NOW() - (((array_length(o_titulos, 1) - j + 1) * 3 || ' days')::INTERVAL),
      NOW()
    ) RETURNING id_obra INTO oid;

    -- Inventario
    INSERT INTO inventario (id_obra, stock_actual, stock_reservado, stock_vendido, activo)
      VALUES (oid, 1 + ((j-1) % 3), 0, 0, TRUE);

    obra_ids := array_append(obra_ids, oid);
  END LOOP;
  RAISE NOTICE 'Obras procesadas: %', array_length(obra_ids, 1);

  -- ==========================================================
  -- 3. CLIENTES SEED (100)
  -- ==========================================================
  FOR i IN 1..100 LOOP
    SELECT id_usuario INTO uid
      FROM usuarios WHERE correo = 'cliente_seed_' || i || '@nub.mx' LIMIT 1;

    IF uid IS NULL THEN
      INSERT INTO usuarios (
        nombre_completo, correo, contraseña_hash, rol, estado, activo, verificado
      ) VALUES (
        c_nombres[((i-1) % array_length(c_nombres,1)) + 1] || ' ' ||
        c_apellidos[((i-1) % array_length(c_apellidos,1)) + 1],
        'cliente_seed_' || i || '@nub.mx',
        pass_hash,
        'cliente', 'activo', TRUE, TRUE
      ) RETURNING id_usuario INTO uid;
    END IF;

    cliente_ids := array_append(cliente_ids, uid);
  END LOOP;
  RAISE NOTICE 'Clientes procesados: %', array_length(cliente_ids, 1);

  -- ==========================================================
  -- 4. FAVORITOS CON ARQUETIPOS DE GUSTO
  --    Grupo 1 (1-20)  → ama categorías 1 y 2
  --    Grupo 2 (21-40) → ama categorías 2 y 3
  --    Grupo 3 (41-60) → ama categorías 3 y 4
  --    Grupo 4 (61-80) → ama categorías 1 y 4
  --    Grupo 5 (81-100)→ gusto amplio (omnívoro)
  -- ==========================================================
  FOR i IN 1..array_length(cliente_ids, 1) LOOP
    uid := cliente_ids[i];

    IF i <= 20 THEN
      cat_a := cat_ids[1];
      cat_b := cat_ids[LEAST(2, cat_count)];
    ELSIF i <= 40 THEN
      cat_a := cat_ids[LEAST(2, cat_count)];
      cat_b := cat_ids[LEAST(3, cat_count)];
    ELSIF i <= 60 THEN
      cat_a := cat_ids[LEAST(3, cat_count)];
      cat_b := cat_ids[LEAST(4, cat_count)];
    ELSIF i <= 80 THEN
      cat_a := cat_ids[1];
      cat_b := cat_ids[LEAST(4, cat_count)];
    ELSE
      cat_a := NULL;
      cat_b := NULL;
    END IF;

    FOR j IN 1..array_length(obra_ids, 1) LOOP
      oid := obra_ids[j];

      IF cat_a IS NULL THEN
        prob := 12; -- omnívoro: probabilidad baja uniforme
      ELSE
        SELECT CASE
          WHEN o.id_categoria = cat_a THEN 65
          WHEN o.id_categoria = cat_b THEN 45
          ELSE 6
        END INTO prob FROM obras o WHERE o.id_obra = oid;
      END IF;

      IF (random() * 100)::INTEGER < prob THEN
        INSERT INTO favoritos (id_usuario, id_obra)
          VALUES (uid, oid)
          ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Favoritos generados. Cuenta: %',
    (SELECT COUNT(*) FROM favoritos f
     INNER JOIN usuarios u ON u.id_usuario = f.id_usuario
     WHERE u.correo LIKE '%seed%');

  -- ==========================================================
  -- 5. PEDIDOS Y VENTAS SEED (clientes 1-60 hacen 1-3 pedidos)
  -- ==========================================================
  FOR i IN 1..60 LOOP
    uid := cliente_ids[i];

    FOR j IN 1..(1 + ((i-1) % 3)) LOOP
      oid := obra_ids[1 + ((i * j - 1) % array_length(obra_ids, 1))];

      SELECT precio_base, id_artista INTO precio_obra, id_art
        FROM obras WHERE id_obra = oid;

      INSERT INTO pedidos (id_usuario, id_direccion_envio, total_pedido, id_cupon, descuento_cupon)
        VALUES (uid, NULL, precio_obra, NULL, 0)
        RETURNING id_pedido INTO pid;

      INSERT INTO ventas (
        id_cliente, id_obra, id_artista, cantidad,
        precio_unitario, subtotal, total,
        estado, fecha_venta, id_direccion_envio, id_pedido
      ) VALUES (
        uid, oid, id_art, 1,
        precio_obra, precio_obra, precio_obra,
        'entregado',
        NOW() - (((60 - i) * 5 + j * 2 || ' days')::INTERVAL),
        NULL, pid
      );

      UPDATE inventario
        SET stock_vendido = COALESCE(stock_vendido, 0) + 1
        WHERE id_obra = oid;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Pedidos y ventas generados.';

  -- ==========================================================
  -- RESUMEN FINAL
  -- ==========================================================
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'SEED COMPLETADO';
  RAISE NOTICE '  Artistas seed: %', array_length(artista_ids, 1);
  RAISE NOTICE '  Obras seed:    %', array_length(obra_ids, 1);
  RAISE NOTICE '  Clientes seed: %', array_length(cliente_ids, 1);
  RAISE NOTICE '  Favoritos:     SELECT COUNT(*) FROM favoritos;';
  RAISE NOTICE '  Ventas:        SELECT COUNT(*) FROM ventas;';
  RAISE NOTICE '  Contraseña:    Seed2024!';
  RAISE NOTICE '════════════════════════════════════════';

END $$;
