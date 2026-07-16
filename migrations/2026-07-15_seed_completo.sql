-- ============================================================
-- SEED COMPLETO — NU★B STUDIO  (poblado integral, imágenes coherentes)
-- Generado por scripts/seedCompleto.mjs — 2026-07-16T02:22:55.255Z
-- Escala: 25 artistas · 300 obras · 400 clientes.
-- La imagen de cada obra coincide con su técnica; cada artista tiene un medio dominante.
-- Imágenes: Wikimedia Commons (licencia libre) → Cloudinary.
-- Contraseña de todas las cuentas seed: Seed2024!
-- Ejecutar UNA SOLA VEZ en el Neon SQL Editor (usuario neondb_owner). Idempotente.
-- Todo corre en un bloque: si algo falla, no se guarda nada.
-- ============================================================

DO $$
DECLARE
  N_ART   CONSTANT INT := 25;
  OBRAS_A CONSTANT INT := 12;
  N_CLI   CONSTANT INT := 400;

  -- Imágenes por tema (inyectadas)
  retratos     TEXT[] := ARRAY[
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167375/nub-studio/seed/retratos/retratos_1.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167377/nub-studio/seed/retratos/retratos_2.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167379/nub-studio/seed/retratos/retratos_3.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167382/nub-studio/seed/retratos/retratos_4.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167386/nub-studio/seed/retratos/retratos_5.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167388/nub-studio/seed/retratos/retratos_6.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167390/nub-studio/seed/retratos/retratos_7.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167392/nub-studio/seed/retratos/retratos_8.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167397/nub-studio/seed/retratos/retratos_9.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167399/nub-studio/seed/retratos/retratos_10.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167400/nub-studio/seed/retratos/retratos_11.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167401/nub-studio/seed/retratos/retratos_12.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167405/nub-studio/seed/retratos/retratos_13.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167408/nub-studio/seed/retratos/retratos_14.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167409/nub-studio/seed/retratos/retratos_15.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167412/nub-studio/seed/retratos/retratos_16.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167416/nub-studio/seed/retratos/retratos_17.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167419/nub-studio/seed/retratos/retratos_18.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167422/nub-studio/seed/retratos/retratos_19.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784167424/nub-studio/seed/retratos/retratos_20.jpg'
  ]::TEXT[];
  img_pintura  TEXT[] := ARRAY[
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129658/nub-studio/seed/pintura/pintura_1.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129659/nub-studio/seed/pintura/pintura_2.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129662/nub-studio/seed/pintura/pintura_3.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129664/nub-studio/seed/pintura/pintura_4.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129666/nub-studio/seed/pintura/pintura_5.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129668/nub-studio/seed/pintura/pintura_6.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129669/nub-studio/seed/pintura/pintura_7.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129671/nub-studio/seed/pintura/pintura_8.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129674/nub-studio/seed/pintura/pintura_9.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129677/nub-studio/seed/pintura/pintura_10.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129679/nub-studio/seed/pintura/pintura_11.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129681/nub-studio/seed/pintura/pintura_12.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129683/nub-studio/seed/pintura/pintura_13.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129687/nub-studio/seed/pintura/pintura_14.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129689/nub-studio/seed/pintura/pintura_15.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129691/nub-studio/seed/pintura/pintura_16.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129692/nub-studio/seed/pintura/pintura_17.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129693/nub-studio/seed/pintura/pintura_18.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129695/nub-studio/seed/pintura/pintura_19.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129697/nub-studio/seed/pintura/pintura_20.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129698/nub-studio/seed/pintura/pintura_21.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129700/nub-studio/seed/pintura/pintura_22.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129705/nub-studio/seed/pintura/pintura_23.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129706/nub-studio/seed/pintura/pintura_24.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129709/nub-studio/seed/pintura/pintura_25.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129710/nub-studio/seed/pintura/pintura_26.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129711/nub-studio/seed/pintura/pintura_27.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129714/nub-studio/seed/pintura/pintura_28.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129716/nub-studio/seed/pintura/pintura_29.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129717/nub-studio/seed/pintura/pintura_30.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129718/nub-studio/seed/pintura/pintura_31.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129720/nub-studio/seed/pintura/pintura_32.jpg'
  ]::TEXT[];
  img_ceramica TEXT[] := ARRAY[
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129722/nub-studio/seed/ceramica/ceramica_1.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129723/nub-studio/seed/ceramica/ceramica_2.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129725/nub-studio/seed/ceramica/ceramica_3.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129726/nub-studio/seed/ceramica/ceramica_4.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129728/nub-studio/seed/ceramica/ceramica_5.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129729/nub-studio/seed/ceramica/ceramica_6.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129730/nub-studio/seed/ceramica/ceramica_7.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129732/nub-studio/seed/ceramica/ceramica_8.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129733/nub-studio/seed/ceramica/ceramica_9.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129735/nub-studio/seed/ceramica/ceramica_10.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129736/nub-studio/seed/ceramica/ceramica_11.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129737/nub-studio/seed/ceramica/ceramica_12.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129738/nub-studio/seed/ceramica/ceramica_13.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129739/nub-studio/seed/ceramica/ceramica_14.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129740/nub-studio/seed/ceramica/ceramica_15.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129742/nub-studio/seed/ceramica/ceramica_16.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129743/nub-studio/seed/ceramica/ceramica_17.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129744/nub-studio/seed/ceramica/ceramica_18.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129745/nub-studio/seed/ceramica/ceramica_19.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129747/nub-studio/seed/ceramica/ceramica_20.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129749/nub-studio/seed/ceramica/ceramica_21.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129750/nub-studio/seed/ceramica/ceramica_22.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129752/nub-studio/seed/ceramica/ceramica_23.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129754/nub-studio/seed/ceramica/ceramica_24.jpg'
  ]::TEXT[];
  img_textil   TEXT[] := ARRAY[
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129756/nub-studio/seed/textil/textil_1.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129757/nub-studio/seed/textil/textil_2.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129759/nub-studio/seed/textil/textil_3.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129760/nub-studio/seed/textil/textil_4.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129762/nub-studio/seed/textil/textil_5.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129764/nub-studio/seed/textil/textil_6.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129766/nub-studio/seed/textil/textil_7.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129767/nub-studio/seed/textil/textil_8.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129768/nub-studio/seed/textil/textil_9.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129769/nub-studio/seed/textil/textil_10.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129772/nub-studio/seed/textil/textil_11.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129773/nub-studio/seed/textil/textil_12.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129774/nub-studio/seed/textil/textil_13.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129775/nub-studio/seed/textil/textil_14.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129777/nub-studio/seed/textil/textil_15.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129779/nub-studio/seed/textil/textil_16.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129781/nub-studio/seed/textil/textil_17.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129783/nub-studio/seed/textil/textil_18.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129785/nub-studio/seed/textil/textil_19.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129786/nub-studio/seed/textil/textil_20.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129788/nub-studio/seed/textil/textil_21.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129790/nub-studio/seed/textil/textil_22.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129791/nub-studio/seed/textil/textil_23.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129792/nub-studio/seed/textil/textil_24.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129794/nub-studio/seed/textil/textil_25.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129795/nub-studio/seed/textil/textil_26.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129796/nub-studio/seed/textil/textil_27.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129799/nub-studio/seed/textil/textil_28.jpg'
  ]::TEXT[];
  img_grabado  TEXT[] := ARRAY[
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129801/nub-studio/seed/grabado/grabado_1.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129802/nub-studio/seed/grabado/grabado_2.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129805/nub-studio/seed/grabado/grabado_3.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129808/nub-studio/seed/grabado/grabado_4.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129810/nub-studio/seed/grabado/grabado_5.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129812/nub-studio/seed/grabado/grabado_6.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129813/nub-studio/seed/grabado/grabado_7.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129816/nub-studio/seed/grabado/grabado_8.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129819/nub-studio/seed/grabado/grabado_9.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129821/nub-studio/seed/grabado/grabado_10.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129822/nub-studio/seed/grabado/grabado_11.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129823/nub-studio/seed/grabado/grabado_12.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129825/nub-studio/seed/grabado/grabado_13.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129831/nub-studio/seed/grabado/grabado_14.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129832/nub-studio/seed/grabado/grabado_15.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129836/nub-studio/seed/grabado/grabado_16.jpg'
  ]::TEXT[];
  img_paisaje  TEXT[] := ARRAY[
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129838/nub-studio/seed/paisaje/paisaje_1.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129839/nub-studio/seed/paisaje/paisaje_2.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129840/nub-studio/seed/paisaje/paisaje_3.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129842/nub-studio/seed/paisaje/paisaje_4.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129844/nub-studio/seed/paisaje/paisaje_5.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129845/nub-studio/seed/paisaje/paisaje_6.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129847/nub-studio/seed/paisaje/paisaje_7.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129848/nub-studio/seed/paisaje/paisaje_8.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129851/nub-studio/seed/paisaje/paisaje_9.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129853/nub-studio/seed/paisaje/paisaje_10.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129854/nub-studio/seed/paisaje/paisaje_11.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129857/nub-studio/seed/paisaje/paisaje_12.png',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129859/nub-studio/seed/paisaje/paisaje_13.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129860/nub-studio/seed/paisaje/paisaje_14.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129861/nub-studio/seed/paisaje/paisaje_15.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129865/nub-studio/seed/paisaje/paisaje_16.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129866/nub-studio/seed/paisaje/paisaje_17.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129868/nub-studio/seed/paisaje/paisaje_18.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129869/nub-studio/seed/paisaje/paisaje_19.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129871/nub-studio/seed/paisaje/paisaje_20.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129875/nub-studio/seed/paisaje/paisaje_21.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129877/nub-studio/seed/paisaje/paisaje_22.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129878/nub-studio/seed/paisaje/paisaje_23.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129880/nub-studio/seed/paisaje/paisaje_24.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129882/nub-studio/seed/paisaje/paisaje_25.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129885/nub-studio/seed/paisaje/paisaje_26.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129887/nub-studio/seed/paisaje/paisaje_27.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129889/nub-studio/seed/paisaje/paisaje_28.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129891/nub-studio/seed/paisaje/paisaje_29.jpg',
    'https://res.cloudinary.com/dkc7af4hy/image/upload/v1784129893/nub-studio/seed/paisaje/paisaje_30.jpg'
  ]::TEXT[];
  n_ret INT;

  -- Catálogos existentes
  cat_ids INT[]; cat_n INT; est_id INT; mun_id INT;

  a_nom TEXT[] := ARRAY[
    'Elena Xochitl Téllez','Rodrigo Nahua Velázquez','Sofía Cuauhtli Martínez',
    'Dante Ixmatlahua Cruz','Valentina Tláloc Herrera','Marco Totonac Domínguez',
    'Isabela Chalma Reyes','Fermín Huichol Sánchez','Lucía Papantla Bautista',
    'Aarón Tenek Osorio','Renata Meztli Aguilar','Gael Tepeyollotl Ríos',
    'Camila Zempoala Flores','Mateo Amatlán Guerrero','Ximena Citlali Vega',
    'Bruno Tamazunchale Mora','Regina Xilitla Nava','Emilio Coacuilco Peña',
    'Paola Tantoyuca Ibarra','Diego Chicontepec Salas','Frida Atlapexco Luna',
    'Ángel Huejutla Cordero','Mariana Yahualica Prado','Iván Molango Cabrera',
    'Daniela Zacualtipán Rangel'];
  a_nick TEXT[] := ARRAY[
    'Xochitl Arte','Nahua Visión','Cuauhtli','Ixmat Studio','Tláloc','Totonac Art',
    'Chalma','Huichol','Papantla','Tenek','Meztli','Tepeyollotl','Zempoala',
    'Amatlán','Citlali','Tamazunchale','Xilitla','Coacuilco','Tantoyuca',
    'Chicontepec','Atlapexco','Huejutla','Yahualica','Molango','Zacualtipán'];
  -- (la bio se elige según la categoría real del artista — ver fn_bio abajo)
  o_titulo TEXT[] := ARRAY[
    'Amanecer en la Huasteca','Mercado de Huejutla','Mujer Tenek','Sierra Verde',
    'Río Moctezuma al Atardecer','Danza de los Xantolo','Veladoras de Octubre',
    'Milpa en Agosto','Ceiba Sagrada','Vendedora de Naranjas','Niebla en Molango',
    'Cascada de Tamul','Bordado Nahua','Barro Ritual','Jaguar Mítico','Maíz y Copal',
    'Paisaje Huasteco','Mujer Nahual','Flores de Cempoaxúchitl','El Torito de Petate',
    'Textura de Henequén','Rostro de Anciana','Golfo desde la Sierra','Luna Tenek',
    'Canoa en el Pantepec','Sembradores','Altar de Muertos','Palma Tejida',
    'Montes Azules','Ritmo de Tambor','Serranía en Lluvia','Niño con Guajolote',
    'Curandero','Tejido de Luz','Horizonte Tropical','Danza del Gavilán',
    'Olotillo Dorado','Cerámica Negra','Cañaveral','Murmullo del Río',
    'Árbol de la Vida','Madre e Hija Nahuas','Obsidiana y Jade','Mariposa Monarca'];
  -- Títulos por tema, para que el título también sea coherente con la imagen
  tit_pintura  TEXT[] := ARRAY['Amanecer en la Huasteca','Paisaje Huasteco','Milpa en Agosto',
    'Mercado de Huejutla','Ritmo de Tambor','Vendedora de Naranjas','Horizonte Tropical'];
  tit_ceramica TEXT[] := ARRAY['Barro Ritual','Cerámica Negra','Obsidiana y Jade','Maíz y Copal',
    'Palma Tejida','Cántaro de la Sierra'];
  tit_textil   TEXT[] := ARRAY['Bordado Nahua','Tejido de Luz','Textura de Henequén',
    'Hilos de la Milpa','Mujer Tenek','Telar Ancestral'];
  tit_grabado  TEXT[] := ARRAY['Jaguar Mítico','Danza del Gavilán','El Torito de Petate',
    'Máscara del Xantolo','Curandero','Nahual'];
  tit_paisaje  TEXT[] := ARRAY['Sierra Verde','Río Moctezuma al Atardecer','Niebla en Molango',
    'Cascada de Tamul','Montes Azules','Serranía en Lluvia','Ceiba Sagrada','Cañaveal del Pantepec'];
  o_hist TEXT[] := ARRAY[
    'Esta obra nace de la observación directa de la naturaleza y las tradiciones de la región.',
    'Inspirada en las festividades del Xantolo y la memoria de los ancestros.',
    'Retrata la vida cotidiana de las comunidades de la Sierra Huasteca.',
    'Rescata las formas y colores de la artesanía tradicional huasteca.'];
  col_nom TEXT[] := ARRAY[
    'Raíces de la Sierra','Color de la Huasteca','Barro y Fuego','Hilos Ancestrales',
    'Paisajes del Pantepec','Memoria Tenek','Fiesta de Xantolo','Voces de la Milpa',
    'Tierra y Copal','Cauce del Moctezuma','Luz Serrana','Tradición Viva',
    'Sombras de Ceiba','Naturaleza Huasteca','Ritmo y Barro','Bordado de Luz'];
  etq TEXT[] := ARRAY[
    'huasteca','paisaje','retrato','tradicion','naturaleza','color','abstracto',
    'ancestral','fiesta','ritual','textil','ceramica','acuarela','oleo','fauna',
    'flora','serrania','rio','montaña','indigena','contemporaneo','folclor','muertos',
    'artesania','pintura','grabado'];
  cli_nom TEXT[] := ARRAY['María','José','Ana','Luis','Carmen','Juan','Laura','Miguel','Sofía','Carlos',
    'Elena','Pedro','Lucía','Jorge','Paula','Diego','Rosa','Andrés','Valeria','Raúl'];
  cli_ape TEXT[] := ARRAY['García','Hernández','López','Martínez','González','Pérez','Rodríguez','Sánchez',
    'Ramírez','Cruz','Flores','Reyes','Morales','Ortiz','Gutiérrez','Vázquez','Jiménez','Mendoza','Aguilar','Domínguez'];
  blog_tit TEXT[] := ARRAY[
    'La técnica del bordado nahua paso a paso','Xantolo: el Día de Muertos huasteco',
    'Cómo cuidar una obra en acuarela','El barro rojo de la Sierra',
    'Cinco artistas de Hidalgo que debes conocer','El significado del cempoaxúchitl',
    'Guía para empezar tu colección de arte','La ceiba en la cosmovisión tenek',
    'De la milpa al lienzo: paisaje huasteco','Marcos y montaje: qué elegir'];
  blog_theme TEXT[] := ARRAY['textil','grabado','pintura','ceramica','paisaje',
                             'paisaje','pintura','paisaje','paisaje','pintura'];
  blog_cont TEXT := 'La Huasteca Hidalguense guarda una tradición artística viva que se transmite de generación en generación. En esta entrada exploramos su historia, sus técnicas y a las personas que la mantienen viva a través del arte. NU★B Studio nace para dar visibilidad a estas voces.';

  admin_uid INT;
  art_uids INT[] := '{}'; art_ids INT[] := '{}'; art_cat INT[] := '{}';
  aid INT; uid INT; oid INT; cid INT; pid INT;
  col_de_art INT[];
  precio NUMERIC; monto_art NUMERIC;
  cat_a INT; cat_b INT;
  i INT; j INT; k INT; g INT; idx INT := 0;
  theme TEXT; timg TEXT[]; ttit TEXT[];
  tec_id INT; tec_nom TEXT; obra_cat INT; cat_nom TEXT; bio TEXT;
  img1 TEXT; img2 TEXT; img3 TEXT; obra_tit TEXT;
  n_ped INT; n_lin INT; ped_estado TEXT; fecha_v TIMESTAMPTZ;
  liq_id INT; post_id INT; obra_rec RECORD; bth TEXT;
  emojis TEXT[] := ARRAY['❤️','🔥','👏','😍','🎨','✨'];
BEGIN
  n_ret := array_length(retratos, 1);

  SELECT ARRAY(SELECT id_categoria FROM categorias ORDER BY id_categoria) INTO cat_ids;
  cat_n := COALESCE(array_length(cat_ids, 1), 0);
  IF cat_n = 0 THEN RAISE EXCEPTION 'No hay categorías. Inserta categorías primero.'; END IF;

  SELECT id_usuario INTO admin_uid FROM usuarios WHERE correo = 'admin_seed@nub.mx';
  IF admin_uid IS NULL THEN
    INSERT INTO usuarios (nombre_completo, correo, contraseña_hash, rol, estado, activo, verificado)
      VALUES ('Admin Seed','admin_seed@nub.mx', '$2b$12$IRILcBmq0IMo2wffZIuvmO.t0.3My2cGc4qKicWkAHX/szFHCgeLi','admin','activo',TRUE,TRUE)
      RETURNING id_usuario INTO admin_uid;
  END IF;

  -- 0. ETIQUETAS
  FOR i IN 1..array_length(etq,1) LOOP
    INSERT INTO etiquetas (nombre, slug, activa)
      SELECT initcap(etq[i]), etq[i], TRUE
      WHERE NOT EXISTS (SELECT 1 FROM etiquetas WHERE slug = etq[i]);
  END LOOP;

  -- 1. ARTISTAS (cada uno especializado en una categoría REAL del catálogo)
  FOR i IN 1..N_ART LOOP
    cat_a := cat_ids[((i-1) % cat_n) + 1];         -- categoría dominante del artista
    SELECT nombre INTO cat_nom FROM categorias WHERE id_categoria = cat_a;
    bio := CASE cat_nom
      WHEN 'Fotografía' THEN 'Fotógrafo(a) documental de comunidades y paisajes del norte de Hidalgo.'
      WHEN 'Pintura'    THEN 'Pintor(a) que retrata la vida cotidiana y el paisaje de la Huasteca.'
      WHEN 'Escultura'  THEN 'Escultor(a) que modela el barro y talla la madera de la región.'
      WHEN 'Artesanía'  THEN 'Artista textil que trabaja el bordado nahua con fibras y tintes locales.'
      WHEN 'Ilustración' THEN 'Ilustrador(a) de la flora, la fauna y los mitos de la Sierra Huasteca.'
      WHEN 'Cerámica'   THEN 'Ceramista que rescata las formas de la alfarería huasteca tradicional.'
      WHEN 'Grabado'    THEN 'Grabador(a) que fusiona técnicas ancestrales con arte contemporáneo.'
      ELSE 'Artista de la Huasteca Hidalguense.' END;
    SELECT id_usuario INTO uid FROM usuarios WHERE correo = 'artista_seed_'||i||'@nub.mx';
    IF uid IS NULL THEN
      INSERT INTO usuarios (nombre_completo, correo, contraseña_hash, rol, estado, activo, verificado)
        VALUES (a_nom[((i-1)%array_length(a_nom,1))+1], 'artista_seed_'||i||'@nub.mx',
                '$2b$12$IRILcBmq0IMo2wffZIuvmO.t0.3My2cGc4qKicWkAHX/szFHCgeLi','artista','activo',TRUE,TRUE)
        RETURNING id_usuario INTO uid;
    END IF;
    SELECT id_artista INTO aid FROM artistas WHERE correo = 'artista_seed_'||i||'@nub.mx';
    IF aid IS NULL THEN
      INSERT INTO artistas (id_usuario, nombre_completo, nombre_artistico, biografia, foto_perfil,
        correo, telefono, matricula, id_categoria_principal, porcentaje_comision, estado, activo, eliminado)
      VALUES (uid, a_nom[((i-1)%array_length(a_nom,1))+1], a_nick[((i-1)%array_length(a_nick,1))+1],
        bio, retratos[((i-1)%n_ret)+1], 'artista_seed_'||i||'@nub.mx',
        '+52 771 '||LPAD(((i*137)%1000000)::TEXT,6,'0'),
        'NUB-'||EXTRACT(YEAR FROM NOW())::INT||'-SEED-'||LPAD(i::TEXT,3,'0'),
        cat_a, 15, 'activo', TRUE, FALSE)
      RETURNING id_artista INTO aid;
    END IF;
    art_uids := array_append(art_uids, uid);
    art_ids  := array_append(art_ids, aid);
    art_cat  := array_append(art_cat, cat_a);

    INSERT INTO artistas_redes_sociales (id_artista, red_social, url, usuario)
      SELECT aid,'instagram','https://instagram.com/nub_artista_'||i,'nub_artista_'||i
      WHERE NOT EXISTS (SELECT 1 FROM artistas_redes_sociales WHERE id_artista=aid AND red_social='instagram');
    INSERT INTO artistas_redes_sociales (id_artista, red_social, url, usuario)
      SELECT aid,'facebook','https://facebook.com/nub.artista.'||i, NULL
      WHERE NOT EXISTS (SELECT 1 FROM artistas_redes_sociales WHERE id_artista=aid AND red_social='facebook');
    INSERT INTO artistas_fotos_personales (id_artista, url_foto, es_principal, orden)
      SELECT aid, retratos[((i-1)%n_ret)+1], TRUE, 1
      WHERE NOT EXISTS (SELECT 1 FROM artistas_fotos_personales WHERE id_artista=aid AND orden=1);
    INSERT INTO artistas_fotos_personales (id_artista, url_foto, es_principal, orden)
      SELECT aid, retratos[((i)%n_ret)+1], FALSE, 2
      WHERE NOT EXISTS (SELECT 1 FROM artistas_fotos_personales WHERE id_artista=aid AND orden=2);
  END LOOP;
  RAISE NOTICE 'Artistas: %', array_length(art_ids,1);

  -- 2. COLECCIONES + 3. OBRAS (imagen y título coherentes con la técnica)
  FOR i IN 1..N_ART LOOP
    aid := art_ids[i]; uid := art_uids[i];
    col_de_art := '{}';
    FOR k IN 1..2 LOOP
      SELECT id_coleccion INTO cid FROM colecciones WHERE slug = 'seed-col-'||i||'-'||k;
      IF cid IS NULL THEN
        INSERT INTO colecciones (id_artista, nombre, slug, historia, imagen_portada,
          estado, destacada, activa, eliminada, fecha_creacion, fecha_actualizacion)
        VALUES (aid, col_nom[(((i-1)*2+k-1)%array_length(col_nom,1))+1], 'seed-col-'||i||'-'||k,
          'Selección de obras sobre la cultura, el paisaje y las tradiciones de la Huasteca Hidalguense.',
          img_paisaje[(((i-1)*2+k-1)%array_length(img_paisaje,1))+1], 'publicada', (k=1), TRUE, FALSE,
          NOW()-((330 - i)||' days')::INTERVAL, NOW())
        RETURNING id_coleccion INTO cid;
      END IF;
      col_de_art := array_append(col_de_art, cid);
    END LOOP;

    cat_a := art_cat[i];

    FOR j IN 1..OBRAS_A LOOP
      idx := idx + 1;
      CONTINUE WHEN EXISTS (SELECT 1 FROM obras WHERE slug = 'seed-obra-'||i||'-'||j);

      -- Técnica REAL del catálogo: 70% de la categoría del artista, 30% de cualquiera.
      -- La categoría de la obra se HEREDA de la técnica (tecnicas.id_categoria).
      tec_id := NULL;
      IF random() < 0.7 THEN
        SELECT t.id_tecnica, t.nombre, t.id_categoria, c.nombre
          INTO tec_id, tec_nom, obra_cat, cat_nom
          FROM tecnicas t JOIN categorias c ON c.id_categoria = t.id_categoria
          WHERE t.id_categoria = cat_a ORDER BY random() LIMIT 1;
      END IF;
      IF tec_id IS NULL THEN
        SELECT t.id_tecnica, t.nombre, t.id_categoria, c.nombre
          INTO tec_id, tec_nom, obra_cat, cat_nom
          FROM tecnicas t JOIN categorias c ON c.id_categoria = t.id_categoria
          ORDER BY random() LIMIT 1;
      END IF;
      CONTINUE WHEN tec_id IS NULL;

      -- La imagen se elige por la CATEGORÍA real de la obra
      theme := CASE cat_nom
        WHEN 'Fotografía'  THEN 'paisaje'  WHEN 'Pintura'  THEN 'pintura'
        WHEN 'Escultura'   THEN 'ceramica' WHEN 'Artesanía' THEN 'textil'
        WHEN 'Ilustración' THEN 'pintura'  WHEN 'Cerámica' THEN 'ceramica'
        WHEN 'Grabado'     THEN 'grabado'  ELSE 'pintura' END;

      timg := CASE theme
        WHEN 'pintura'  THEN img_pintura  WHEN 'ceramica' THEN img_ceramica
        WHEN 'textil'   THEN img_textil   WHEN 'grabado'  THEN img_grabado
        ELSE img_paisaje END;
      ttit := CASE theme
        WHEN 'pintura'  THEN tit_pintura  WHEN 'ceramica' THEN tit_ceramica
        WHEN 'textil'   THEN tit_textil   WHEN 'grabado'  THEN tit_grabado
        ELSE tit_paisaje END;

      img1 := timg[((idx-1)%array_length(timg,1))+1];
      img2 := timg[((idx)  %array_length(timg,1))+1];
      img3 := timg[((idx+1)%array_length(timg,1))+1];
      obra_tit := ttit[((idx-1)%array_length(ttit,1))+1]||' '||to_char(j,'FM999');

      precio := (500 + (idx % 20) * 250)::NUMERIC;
      INSERT INTO obras (titulo, slug, descripcion, historia, id_categoria, id_tecnica,
        id_artista, id_usuario_creacion, tecnica, anio_creacion, precio_base,
        permite_marco, con_certificado, imagen_principal,
        id_coleccion, "tiene_tamaños", estado, activa, visible, fecha_creacion, fecha_actualizacion)
      VALUES (obra_tit, 'seed-obra-'||i||'-'||j,
        'Obra original de la tradición Huasteca. Refleja la cultura y el paisaje de la Huasteca Hidalguense.',
        o_hist[((idx-1)%array_length(o_hist,1))+1], obra_cat, tec_id, aid, uid,
        tec_nom, 2019 + (idx%6), precio, TRUE, (idx%3=0), img1,
        col_de_art[(j%2)+1], (j%4=0), 'publicada', TRUE, TRUE,
        NOW()-(((OBRAS_A*N_ART)-idx)||' days')::INTERVAL, NOW())
      RETURNING id_obra INTO oid;

      INSERT INTO inventario (id_obra, stock_actual, stock_reservado, stock_vendido, activo)
        VALUES (oid, 1 + (j%4), 0, 0, TRUE);

      -- Imágenes del MISMO tema que la técnica
      INSERT INTO imagenes_obras (id_obra, url_imagen, orden, es_principal, activa)
        VALUES (oid, img1, 1, TRUE, TRUE), (oid, img2, 2, FALSE, TRUE), (oid, img3, 3, FALSE, TRUE);

      INSERT INTO obras_etiquetas (id_obra, id_etiqueta)
        SELECT oid, e.id_etiqueta FROM etiquetas e
        WHERE e.slug IN (theme, etq[((idx-1)%array_length(etq,1))+1])
        ON CONFLICT DO NOTHING;

      -- Variantes de tamaño usando el catálogo real "tamaños_disponibles"
      IF j%4 = 0 THEN
        INSERT INTO "obras_tamaños" (id_obra, "id_tamaño", precio_base, cantidad_disponible, activo)
          SELECT oid, td."id_tamaño",
                 ROUND(precio * CASE td."id_tamaño" WHEN 2 THEN 1.0 WHEN 3 THEN 1.45 ELSE 1.0 END, 2),
                 2, TRUE
          FROM "tamaños_disponibles" td
          WHERE td."id_tamaño" IN (2,3) AND COALESCE(td.activo, TRUE)
          ON CONFLICT (id_obra, "id_tamaño") DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Obras generadas: %', idx;

  -- Marcos disponibles por cada variante de tamaño (precio = tamaño + marco)
  INSERT INTO obras_marcos ("id_obra_tamaño", id_tipo_marco, precio_total, activo)
    SELECT t.id, m.id_tipo_marco, t.precio_base + m.precio_adicional, TRUE
    FROM "obras_tamaños" t
    JOIN obras o ON o.id_obra = t.id_obra AND o.slug LIKE 'seed-obra-%'
    JOIN LATERAL (
      SELECT id_tipo_marco, precio_adicional FROM tipos_marco
      WHERE COALESCE(activo,TRUE) AND NOT COALESCE(eliminado,FALSE)
      ORDER BY id_tipo_marco LIMIT 1
    ) m ON TRUE
    ON CONFLICT ("id_obra_tamaño", id_tipo_marco) DO NOTHING;

  -- 4. CLIENTES + dirección
  FOR i IN 1..N_CLI LOOP
    SELECT id_usuario INTO uid FROM usuarios WHERE correo = 'cliente_seed_'||i||'@nub.mx';
    IF uid IS NULL THEN
      INSERT INTO usuarios (nombre_completo, correo, contraseña_hash, rol, estado, activo, verificado)
        VALUES (cli_nom[((i-1)%array_length(cli_nom,1))+1]||' '||cli_ape[((i-1)%array_length(cli_ape,1))+1],
                'cliente_seed_'||i||'@nub.mx', '$2b$12$IRILcBmq0IMo2wffZIuvmO.t0.3My2cGc4qKicWkAHX/szFHCgeLi','cliente','activo',TRUE,TRUE)
        RETURNING id_usuario INTO uid;
    END IF;
    -- Par municipio/estado COHERENTE (los municipios traen su propio id_estado)
    SELECT m.id_municipio, m.id_estado INTO mun_id, est_id
      FROM municipios m ORDER BY random() LIMIT 1;
    IF est_id IS NOT NULL AND mun_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM direcciones WHERE id_usuario=uid AND tipo='envio') THEN
      INSERT INTO direcciones (id_usuario, calle, numero_exterior, numero_interior, colonia,
        id_municipio, id_estado, codigo_postal, referencias, tipo, fecha_creacion)
      VALUES (uid,'Calle '||((i%80)+1), ((i%150)+1)::TEXT, NULL,'Centro',
        mun_id, est_id, LPAD(((43000+i)%99999)::TEXT,5,'0'),'Casa','envio',NOW());
    END IF;
  END LOOP;
  RAISE NOTICE 'Clientes procesados: %', N_CLI;

  -- 5. FAVORITOS por arquetipo (6 grupos)
  FOR i IN 1..N_CLI LOOP
    SELECT id_usuario INTO uid FROM usuarios WHERE correo = 'cliente_seed_'||i||'@nub.mx';
    CONTINUE WHEN uid IS NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM favoritos WHERE id_usuario=uid);
    g := i % 6;
    IF g = 5 THEN cat_a := NULL; cat_b := NULL;
    ELSE cat_a := cat_ids[(g%cat_n)+1]; cat_b := cat_ids[((g+1)%cat_n)+1]; END IF;
    INSERT INTO favoritos (id_usuario, id_obra)
      SELECT uid, o.id_obra FROM obras o
      WHERE o.slug LIKE 'seed-obra-%' AND o.activa
        AND CASE WHEN cat_a IS NULL THEN random() < 0.10
                 WHEN o.id_categoria = cat_a THEN random() < 0.45
                 WHEN o.id_categoria = cat_b THEN random() < 0.30
                 ELSE random() < 0.04 END
      ON CONFLICT DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Favoritos: %', (SELECT COUNT(*) FROM favoritos f JOIN usuarios u ON u.id_usuario=f.id_usuario WHERE u.correo LIKE 'cliente_seed_%');

  -- 6. CARRITOS activos (de sus favoritos)
  FOR i IN 1..N_CLI LOOP
    CONTINUE WHEN i % 4 <> 0;
    SELECT id_usuario INTO uid FROM usuarios WHERE correo = 'cliente_seed_'||i||'@nub.mx';
    CONTINUE WHEN uid IS NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM carritos WHERE id_usuario=uid AND activo=TRUE);
    INSERT INTO carritos (id_usuario, id_obra, cantidad, activo, fecha_agregado)
      SELECT uid, f.id_obra, 1, TRUE, NOW()-((i%20)||' days')::INTERVAL
      FROM favoritos f WHERE f.id_usuario = uid ORDER BY random() LIMIT 2
      ON CONFLICT DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Carritos activos creados.';

  -- 7. PEDIDOS + VENTAS (coherentes: fecha tras creación, total = suma de líneas)
  FOR i IN 1..N_CLI LOOP
    CONTINUE WHEN i % 3 = 0;
    SELECT id_usuario INTO uid FROM usuarios WHERE correo = 'cliente_seed_'||i||'@nub.mx';
    CONTINUE WHEN uid IS NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM pedidos WHERE id_cliente=uid);
    SELECT COUNT(*) INTO n_lin FROM favoritos WHERE id_usuario=uid;
    CONTINUE WHEN n_lin = 0;
    n_ped := 1 + (i % 4);
    FOR j IN 1..n_ped LOOP
      ped_estado := (ARRAY['entregado','entregado','enviado','pendiente'])[1+(j%4)];
      INSERT INTO pedidos (id_cliente, id_direccion_envio, estado, total, id_cupon, descuento_cupon, fecha_pedido)
        VALUES (uid, NULL, ped_estado, 0, NULL, 0, NOW()) RETURNING id_pedido INTO pid;
      FOR obra_rec IN
        SELECT o.id_obra, o.id_artista, o.precio_base, o.fecha_creacion,
               COALESCE(a.porcentaje_comision,15) AS pct
        FROM obras o JOIN artistas a ON a.id_artista=o.id_artista
        JOIN favoritos f ON f.id_obra=o.id_obra AND f.id_usuario=uid
        ORDER BY random() LIMIT (1 + (j % 2))
      LOOP
        monto_art := ROUND(obra_rec.precio_base * (1 - obra_rec.pct/100.0), 2);
        fecha_v := obra_rec.fecha_creacion
                   + (random() * GREATEST(EXTRACT(EPOCH FROM (NOW() - obra_rec.fecha_creacion)), 0) || ' seconds')::INTERVAL;
        INSERT INTO ventas (id_cliente, id_obra, id_artista, cantidad, precio_unitario,
          subtotal, total, monto_artista, estado, fecha_venta, id_direccion_envio, id_pedido)
        VALUES (uid, obra_rec.id_obra, obra_rec.id_artista, 1, obra_rec.precio_base,
          obra_rec.precio_base, obra_rec.precio_base, monto_art,
          ped_estado::estado_venta, fecha_v, NULL, pid);
        UPDATE inventario SET stock_vendido = COALESCE(stock_vendido,0)+1,
          stock_actual = GREATEST(COALESCE(stock_actual,1)-1,0) WHERE id_obra = obra_rec.id_obra;
      END LOOP;
      UPDATE pedidos SET
        total = COALESCE((SELECT SUM(total) FROM ventas WHERE id_pedido=pid), 0),
        fecha_pedido = COALESCE((SELECT MIN(fecha_venta) FROM ventas WHERE id_pedido=pid), NOW())
        WHERE id_pedido = pid;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Pedidos/ventas: % ventas', (SELECT COUNT(*) FROM ventas v JOIN usuarios u ON u.id_usuario=v.id_cliente WHERE u.correo LIKE 'cliente_seed_%');

  -- 8. CUPONES
  INSERT INTO cupones (codigo, descripcion, tipo, valor, monto_minimo, usos_max, activo) VALUES
    ('HUASTECA10','10% en toda la tienda','porcentaje',10,0,1000,TRUE),
    ('BIENVENIDA','15% primera compra','porcentaje',15,500,1000,TRUE),
    ('XANTOLO','$200 de descuento','fijo',200,1500,500,TRUE),
    ('ARTE20','20% en obra seleccionada','porcentaje',20,1000,200,TRUE),
    ('ENVIOGRATIS','$150 de descuento','fijo',150,800,1000,TRUE)
    ON CONFLICT (codigo) DO NOTHING;

  -- 9. LIQUIDACIONES (después de las ventas)
  FOR i IN 1..N_ART LOOP
    aid := art_ids[i];
    SELECT COALESCE(SUM(monto_artista),0) INTO monto_art
      FROM ventas WHERE id_artista=aid AND estado='entregado' AND id_liquidacion IS NULL;
    IF monto_art > 0 THEN
      INSERT INTO liquidaciones_artistas (id_artista, id_admin, monto_total, fecha_liquidacion, notas)
        VALUES (aid, admin_uid, monto_art, NOW(), 'Liquidación seed') RETURNING id_liquidacion INTO liq_id;
      UPDATE ventas SET id_liquidacion = liq_id
        WHERE id_artista=aid AND estado='entregado' AND id_liquidacion IS NULL;
    END IF;
  END LOOP;
  RAISE NOTICE 'Liquidaciones generadas.';

  -- 10. BLOG (imagen según el tema del artículo)
  FOR i IN 1..array_length(blog_tit,1) LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM blog_posts WHERE slug='seed-post-'||i);
    uid := art_uids[((i-1)%N_ART)+1];
    bth := blog_theme[i];
    timg := CASE bth
      WHEN 'pintura'  THEN img_pintura  WHEN 'ceramica' THEN img_ceramica
      WHEN 'textil'   THEN img_textil   WHEN 'grabado'  THEN img_grabado
      ELSE img_paisaje END;
    INSERT INTO blog_posts (autor_id, autor_rol, id_categoria, titulo, slug, contenido,
      extracto, imagen_destacada, meta_description, estado, fecha_publicacion, activo)
    VALUES (uid,'artista', cat_ids[((i-1)%cat_n)+1], blog_tit[i], 'seed-post-'||i, blog_cont,
      left(blog_cont,140), timg[((i-1)%array_length(timg,1))+1], left(blog_cont,150),
      'publicado', NOW()-((i*9)||' days')::INTERVAL, TRUE)
    RETURNING id_post INTO post_id;

    INSERT INTO blog_comentarios (id_post, id_usuario, padre_id, nivel, contenido, imagen_url, estado)
      SELECT post_id, u.id_usuario, NULL, 0,
        (ARRAY['¡Excelente artículo!','Me encantó, gracias por compartir.','Muy buena información.'])[1+((u.id_usuario)%3)],
        NULL,'aprobado'
      FROM usuarios u WHERE u.correo LIKE 'cliente_seed_%' ORDER BY random() LIMIT 3;
    INSERT INTO blog_reacciones (id_post, id_usuario, emoji)
      SELECT post_id, u.id_usuario, emojis[1+((u.id_usuario)%array_length(emojis,1))]
      FROM usuarios u WHERE u.correo LIKE 'cliente_seed_%' ORDER BY random() LIMIT 15
      ON CONFLICT (id_post, id_usuario) DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Blog generado.';

  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'SEED COMPLETO — LISTO. Contraseña: Seed2024!';
  RAISE NOTICE '════════════════════════════════════════';
END $$;
