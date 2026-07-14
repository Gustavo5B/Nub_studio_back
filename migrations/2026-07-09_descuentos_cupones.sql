-- =========================================================
-- DESCUENTOS EN OBRAS + SISTEMA DE CUPONES
-- =========================================================

-- 1. Columnas de descuento en obras
ALTER TABLE obras
  ADD COLUMN IF NOT EXISTS precio_descuento NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS descuento_expira TIMESTAMPTZ;

-- 2. Tabla de cupones de descuento
CREATE TABLE IF NOT EXISTS cupones (
  id_cupon     SERIAL PRIMARY KEY,
  codigo       VARCHAR(50) UNIQUE NOT NULL,
  descripcion  TEXT,
  tipo         VARCHAR(20) NOT NULL CHECK (tipo IN ('porcentaje', 'monto')),
  valor        NUMERIC(10,2) NOT NULL CHECK (valor > 0),
  monto_minimo NUMERIC(10,2) DEFAULT 0,
  fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
  fecha_fin    TIMESTAMPTZ,
  usos_max     INTEGER,
  usos_actuales INTEGER DEFAULT 0,
  activo       BOOLEAN DEFAULT TRUE,
  creado_en    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Registro de uso de cupones por pedido
CREATE TABLE IF NOT EXISTS cupones_usados (
  id                 SERIAL PRIMARY KEY,
  id_cupon           INTEGER NOT NULL REFERENCES cupones(id_cupon) ON DELETE CASCADE,
  id_usuario         INTEGER NOT NULL,
  id_pedido          INTEGER NOT NULL,
  descuento_aplicado NUMERIC(10,2) NOT NULL,
  fecha_uso          TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Columnas en pedidos para guardar cupón aplicado
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS id_cupon         INTEGER REFERENCES cupones(id_cupon),
  ADD COLUMN IF NOT EXISTS descuento_cupon  NUMERIC(10,2) DEFAULT 0;

-- 5. GRANTs (RBAC)
GRANT SELECT ON cupones TO usr_visitante, usr_cliente, usr_artista;
GRANT ALL ON cupones TO usr_admin;
GRANT INSERT, SELECT ON cupones_usados TO usr_cliente;
GRANT ALL ON cupones_usados TO usr_admin;
GRANT USAGE, SELECT ON SEQUENCE cupones_id_cupon_seq TO usr_admin;
GRANT USAGE, SELECT ON SEQUENCE cupones_usados_id_seq TO usr_admin, usr_cliente;
