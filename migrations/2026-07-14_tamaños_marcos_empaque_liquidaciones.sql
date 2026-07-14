-- ============================================================
-- TAMAÑOS DE OBRA · MARCOS · EMPAQUE REFORZADO · LIQUIDACIONES
-- Ejecutar en Neon SQL Editor
-- ============================================================

-- ============================================================
-- 1. obras_tamaños — variantes de tamaño por obra
--    El artista define sus propias tallas con precio total
-- ============================================================
CREATE TABLE IF NOT EXISTS obras_tamaños (
  id_tamano    SERIAL PRIMARY KEY,
  id_obra      INTEGER NOT NULL REFERENCES obras(id_obra) ON DELETE CASCADE,
  etiqueta     VARCHAR(80) NOT NULL,        -- "Pequeño", "30×40 cm", "A3", etc.
  ancho_cm     NUMERIC(6,1),
  alto_cm      NUMERIC(6,1),
  precio       NUMERIC(10,2) NOT NULL CHECK (precio > 0),
  activo       BOOLEAN DEFAULT TRUE,
  creado_en    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_obras_tamaños_obra ON obras_tamaños(id_obra);

-- Flag en obras: ¿esta obra ofrece variantes de tamaño?
ALTER TABLE obras
  ADD COLUMN IF NOT EXISTS tiene_tamaños BOOLEAN DEFAULT FALSE;
-- Nota: permite_marco ya existe en obras ✓

-- ============================================================
-- 2. tipos_marco — catálogo global de marcos (gestiona admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS tipos_marco (
  id_marco     SERIAL PRIMARY KEY,
  nombre       VARCHAR(120) NOT NULL,        -- "Marco madera natural"
  ancho_cm     NUMERIC(6,1),                 -- dimensión de la obra que encaja
  alto_cm      NUMERIC(6,1),
  material     VARCHAR(60),                  -- "Madera", "Aluminio", "MDF"
  precio       NUMERIC(10,2) NOT NULL CHECK (precio > 0),
  activo       BOOLEAN DEFAULT TRUE,
  creado_en    TIMESTAMPTZ DEFAULT NOW()
);

-- Datos iniciales de ejemplo (el admin puede editar/borrar)
INSERT INTO tipos_marco (nombre, ancho_cm, alto_cm, material, precio) VALUES
  ('Marco madera natural — Carta',       21.6,  27.9, 'Madera',   250),
  ('Marco madera natural — 30×40 cm',    30.0,  40.0, 'Madera',   320),
  ('Marco madera natural — 40×60 cm',    40.0,  60.0, 'Madera',   450),
  ('Marco madera natural — 50×70 cm',    50.0,  70.0, 'Madera',   580),
  ('Marco aluminio — 30×40 cm',          30.0,  40.0, 'Aluminio', 380),
  ('Marco aluminio — 40×60 cm',          40.0,  60.0, 'Aluminio', 520),
  ('Marco MDF negro — 30×40 cm',         30.0,  40.0, 'MDF',      290),
  ('Marco MDF negro — 50×70 cm',         50.0,  70.0, 'MDF',      480)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. configuracion — ajustes globales de la plataforma
-- ============================================================
CREATE TABLE IF NOT EXISTS configuracion (
  clave        VARCHAR(80) PRIMARY KEY,
  valor        TEXT NOT NULL,
  label        VARCHAR(200),
  descripcion  TEXT,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO configuracion (clave, valor, label, descripcion) VALUES
  ('precio_empaque_reforzado', '80',
   'Precio empaque reforzado (MXN)',
   'Costo adicional por empaque con burbuja doble y caja rígida. Recomendado para cerámica, escultura y obra delicada.')
ON CONFLICT (clave) DO NOTHING;

-- ============================================================
-- 4. liquidaciones_artistas — registro de pagos a artistas
-- ============================================================
CREATE TABLE IF NOT EXISTS liquidaciones_artistas (
  id_liquidacion  SERIAL PRIMARY KEY,
  id_artista      INTEGER NOT NULL REFERENCES artistas(id_artista),
  id_admin        INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  monto_total     NUMERIC(10,2) NOT NULL CHECK (monto_total > 0),
  fecha_liquidacion TIMESTAMPTZ DEFAULT NOW(),
  notas           TEXT,
  comprobante_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_liquidaciones_artista ON liquidaciones_artistas(id_artista);

-- ============================================================
-- 5. Columnas nuevas en ventas
--    monto_artista: lo que le corresponde al artista por esa venta
--    id_liquidacion: FK cuando ya fue incluida en un pago
-- ============================================================
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS monto_artista   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS id_liquidacion  INTEGER REFERENCES liquidaciones_artistas(id_liquidacion);

-- Backfill monto_artista para ventas existentes usando el porcentaje del artista
UPDATE ventas v
SET monto_artista = ROUND(
  v.subtotal * (1 - COALESCE(a.porcentaje_comision, 15) / 100.0),
  2
)
FROM artistas a
WHERE a.id_artista = v.id_artista
  AND v.monto_artista IS NULL;

-- ============================================================
-- 6. Columnas nuevas en pedidos — tamaño y marco elegidos
-- ============================================================
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS empaque_reforzado  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS precio_empaque     NUMERIC(10,2) DEFAULT 0;

-- ============================================================
-- 7. Columnas en ventas — detalle del tamaño y marco elegidos
--    (guardamos snapshot para no depender de catálogo futuro)
-- ============================================================
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS id_tamano         INTEGER REFERENCES obras_tamaños(id_tamano),
  ADD COLUMN IF NOT EXISTS id_marco          INTEGER REFERENCES tipos_marco(id_marco),
  ADD COLUMN IF NOT EXISTS precio_marco      NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS label_tamano      VARCHAR(80),
  ADD COLUMN IF NOT EXISTS label_marco       VARCHAR(120);

-- ============================================================
-- 8. GRANTs — RBAC
-- ============================================================

-- obras_tamaños
GRANT SELECT ON obras_tamaños TO usr_visitante, usr_cliente;
GRANT SELECT, INSERT, UPDATE, DELETE ON obras_tamaños TO usr_artista;
GRANT ALL ON obras_tamaños TO usr_admin;
GRANT USAGE, SELECT ON SEQUENCE obras_tamaños_id_tamano_seq TO usr_artista, usr_admin;

-- tipos_marco
GRANT SELECT ON tipos_marco TO usr_visitante, usr_cliente, usr_artista;
GRANT ALL ON tipos_marco TO usr_admin;
GRANT USAGE, SELECT ON SEQUENCE tipos_marco_id_marco_seq TO usr_admin;

-- configuracion
GRANT SELECT ON configuracion TO usr_visitante, usr_cliente, usr_artista;
GRANT ALL ON configuracion TO usr_admin;

-- liquidaciones_artistas
GRANT SELECT ON liquidaciones_artistas TO usr_artista;
GRANT ALL ON liquidaciones_artistas TO usr_admin;
GRANT USAGE, SELECT ON SEQUENCE liquidaciones_artistas_id_liquidacion_seq TO usr_admin;
