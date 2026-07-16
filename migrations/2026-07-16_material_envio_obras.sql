-- Migración: agregar material/soporte y disponibilidad de envío a obras
-- Las obras existentes quedan con material=NULL y disponible_envio=false (coherente)

ALTER TABLE obras
  ADD COLUMN IF NOT EXISTS material         VARCHAR(150),
  ADD COLUMN IF NOT EXISTS disponible_envio BOOLEAN NOT NULL DEFAULT false;
