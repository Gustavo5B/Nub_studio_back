// =========================================================
//  Seed de POSTS de blog para la tarea de "Clasificación" (ML).
//  Genera ~240 posts temáticos, con autores variados, texto
//  distinto entre sí pero coherente, comentarios en cola larga
//  y etiquetas variables (1-4) balanceadas sobre las 12 curadas.
//
//  Idempotente: primero borra los posts 'seed-post-%' y sus hijos.
//  Transacción con verificación; COMMIT al final (o ROLLBACK si falla).
//
//     node scripts/seedBlogPosts.mjs            (aplica: COMMIT)
//     node scripts/seedBlogPosts.mjs --dry-run  (valida: ROLLBACK)
// =========================================================
import 'dotenv/config';
import pkg from 'pg'; const { Pool } = pkg;

const DRY = process.argv.includes('--dry-run');
const N_POSTS = 240;

// RNG determinista (mulberry32) para que el seed sea reproducible
let _s = 0x9e3779b9;
const rng = () => {
  _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const chance = (p) => rng() < p;
const intBetween = (a, b) => a + Math.floor(rng() * (b - a + 1));

// ── Temas: cada uno = categoría + etiqueta principal (técnica) +
//    etiquetas temáticas secundarias + vocabulario propio ─────────
const THEMES = [
  {
    key: 'pintura', id_categoria: 2, primary: 'pintura',
    sec: ['paisaje', 'retrato', 'naturaleza', 'tradicion', 'huasteca'], weight: 5,
    subjects: ['el paisaje huasteco', 'el retrato campesino', 'la luz de la sierra', 'los colores de la milpa', 'la vida en el pueblo', 'el río al amanecer'],
    openers: [
      'La pintura sigue siendo el lenguaje más directo para hablar de la Huasteca.',
      'Frente al lienzo en blanco, el pintor decide qué mirada quiere dejar del paisaje.',
      'Hay obras que no se explican con palabras: se sienten en la pincelada.',
    ],
    bodies: [
      'El manejo del óleo permite construir capas de color que dan profundidad al cielo y a las montañas al fondo.',
      'La acuarela, en cambio, obliga a decidir rápido: el agua arrastra el pigmento y no perdona la duda.',
      'Los tonos ocres y verdes recrean la vegetación densa de la sierra, mientras la luz cálida marca la hora del día.',
      'El artista trabaja la composición para guiar la mirada desde el primer plano hasta el horizonte.',
      'Cada retrato busca la dignidad del rostro: las arrugas, la mirada, las manos que cuentan una historia de trabajo.',
    ],
    closers: ['Al final, pintar el paisaje es una forma de agradecerle a la tierra.', 'La obra queda como testimonio de un momento que ya no volverá igual.'],
  },
  {
    key: 'ceramica', id_categoria: 6, primary: 'ceramica',
    sec: ['tradicion', 'huasteca', 'escultura', 'naturaleza'], weight: 4,
    subjects: ['el barro rojo de la sierra', 'la alfarería tradicional', 'las vasijas de uso diario', 'el torno y sus secretos', 'los esmaltes naturales', 'las formas ancestrales'],
    openers: [
      'La cerámica de la Huasteca nace del barro que se saca de la propia tierra.',
      'Antes de encender el horno, el ceramista amasa la arcilla hasta quitarle todo el aire.',
      'Cada pieza de barro guarda las huellas de las manos que la moldearon.',
    ],
    bodies: [
      'El torno gira y las manos húmedas van levantando las paredes de la vasija con paciencia.',
      'La cocción es el momento decisivo: un descuido en la temperatura puede quebrar horas de trabajo.',
      'Los esmaltes se preparan con óxidos que, tras el fuego, revelan colores imposibles de prever del todo.',
      'Las formas recuperan la memoria de la alfarería prehispánica, adaptada a la vida de hoy.',
      'El barro rojo, característico de la región, da a las piezas un tono cálido inconfundible.',
    ],
    closers: ['El barro enseña que la prisa no cabe en el oficio.', 'Cada vasija terminada es pequeña victoria contra la fragilidad del material.'],
  },
  {
    key: 'grabado', id_categoria: 7, primary: 'grabado',
    sec: ['tradicion', 'huasteca', 'retrato', 'naturaleza'], weight: 3,
    subjects: ['la xilografía', 'el grabado en linóleo', 'la estampa popular', 'la matriz y la tinta', 'la gráfica de la Huasteca', 'el oficio de imprimir'],
    openers: [
      'El grabado es el arte de la huella: una matriz que se repite y a la vez nunca es idéntica.',
      'Tallar la madera para grabar exige pensar al revés, en negativo.',
      'La estampa tiene una fuerza gráfica que la vuelve arte del pueblo.',
    ],
    bodies: [
      'La gubia abre surcos en la madera o el linóleo, y lo que se quita será el blanco del papel.',
      'La tinta se entinta con rodillo y la presión del tórculo transfiere la imagen a la hoja.',
      'Cada tiraje se numera, porque la matriz se desgasta y ninguna copia es infinita.',
      'Los temas retoman escenas de la vida cotidiana, retratos y motivos de la naturaleza local.',
      'El blanco y negro obliga a resolver la imagen por contraste, sin ayuda del color.',
    ],
    closers: ['El grabado democratiza el arte: multiplica sin traicionar el original.', 'Queda en el papel la memoria del gesto que abrió la madera.'],
  },
  {
    key: 'textil', id_categoria: 4, primary: 'textil',
    sec: ['tradicion', 'huasteca', 'naturaleza'], weight: 3,
    subjects: ['el bordado nahua', 'el telar de cintura', 'los tintes naturales', 'las fibras de la región', 'los motivos ancestrales', 'la indumentaria tradicional'],
    openers: [
      'El textil huasteco cuenta con hilos lo que otras artes cuentan con pinceles.',
      'Cada bordado es un idioma: sus figuras nombran flores, aves y montañas.',
      'El telar de cintura ata el cuerpo de la tejedora a su obra.',
    ],
    bodies: [
      'Los hilos se tiñen con plantas y minerales de la región para lograr colores firmes.',
      'El bordado nahua reproduce flores y animales con una simetría aprendida de generación en generación.',
      'Tejer en telar de cintura implica tensar la urdimbre con el propio peso del cuerpo.',
      'Cada prenda puede tomar semanas, porque el diseño se construye puntada a puntada.',
      'Los motivos no son decorativos: cuentan la cosmovisión y el entorno natural de la comunidad.',
    ],
    closers: ['El textil es archivo vivo de la memoria de un pueblo.', 'Vestir un bordado es cargar consigo una historia colectiva.'],
  },
  {
    key: 'escultura', id_categoria: 3, primary: 'escultura',
    sec: ['tradicion', 'huasteca', 'naturaleza'], weight: 3,
    subjects: ['la talla en madera', 'el modelado del barro', 'la piedra de la región', 'el volumen y el vacío', 'las figuras rituales', 'la forma en tres dimensiones'],
    openers: [
      'La escultura obliga a caminar alrededor: no hay un solo punto de vista.',
      'Tallar es un diálogo con el material, que impone su veta y su dureza.',
      'Del bloque informe emerge, poco a poco, una figura que ya estaba dentro.',
    ],
    bodies: [
      'La talla en madera respeta la veta: forzarla es arriesgarse a que la pieza se raje.',
      'El modelado en barro permite añadir y quitar volumen hasta encontrar la forma justa.',
      'La luz que resbala sobre la superficie define el volumen tanto como el propio material.',
      'Muchas piezas recuperan figuras rituales y símbolos de la tradición de la Huasteca.',
      'El escultor piensa en el peso, el equilibrio y el vacío que rodea a la figura.',
    ],
    closers: ['La escultura ocupa el espacio y nos recuerda que también somos cuerpo.', 'La forma final es apenas el resto del largo diálogo con la materia.'],
  },
  {
    key: 'fotografia', id_categoria: 1, primary: 'fotografia',
    sec: ['paisaje', 'retrato', 'naturaleza', 'huasteca'], weight: 3,
    subjects: ['el retrato documental', 'la luz natural', 'el paisaje serrano', 'la vida de las comunidades', 'el instante decisivo', 'la fotografía de la Huasteca'],
    openers: [
      'La fotografía detiene el tiempo justo antes de que se escape.',
      'Fotografiar la Huasteca es aprender a esperar la luz correcta.',
      'Una buena imagen no se toma: se construye con paciencia y mirada.',
    ],
    bodies: [
      'La luz de la mañana modela los rostros y da textura al paisaje de la sierra.',
      'El encuadre decide qué entra y qué se queda fuera; ahí está la mitad del mensaje.',
      'El retrato documental busca la confianza de quien posa, no la pose forzada.',
      'La profundidad de campo separa a la persona de un fondo de montañas y niebla.',
      'La fotografía de comunidades exige respeto: se retrata con la gente, no sobre la gente.',
    ],
    closers: ['La imagen queda como testigo de un instante irrepetible.', 'Al final, fotografiar es una manera de mirar dos veces.'],
  },
  {
    key: 'ilustracion', id_categoria: 5, primary: 'ilustracion',
    sec: ['naturaleza', 'tradicion', 'huasteca', 'retrato'], weight: 2,
    subjects: ['la ilustración de la fauna', 'los mitos de la sierra', 'la flora local', 'el dibujo narrativo', 'los personajes tradicionales', 'la ilustración editorial'],
    openers: [
      'La ilustración pone imagen a lo que la palabra apenas insinúa.',
      'Dibujar la fauna de la sierra es también una forma de conservarla.',
      'Cada ilustración cuenta una pequeña historia en un solo cuadro.',
    ],
    bodies: [
      'El trazo limpio define personajes y criaturas inspirados en los mitos de la región.',
      'La paleta de color se elige para evocar la vegetación y la luz de la Huasteca.',
      'La ilustración de flora y fauna combina rigor de observación con licencia poética.',
      'El dibujo narrativo organiza la composición para que la mirada lea la escena en orden.',
      'Muchos trabajos rescatan personajes y leyendas de la tradición oral local.',
    ],
    closers: ['La ilustración mantiene viva la imaginación de un territorio.', 'Un buen dibujo se queda en la memoria más que muchas palabras.'],
  },
];

const TITLE_TEMPLATES = [
  (s) => `Cómo entender ${s}`,
  (s) => `Guía breve sobre ${s}`,
  (s) => `${cap(s)}: apuntes desde el taller`,
  (s) => `Notas sobre ${s}`,
  (s) => `${cap(s)} paso a paso`,
  (s) => `Lo que aprendí de ${s}`,
  (s) => `${cap(s)} en la Huasteca Hidalguense`,
  (s) => `Una mirada a ${s}`,
  (s) => `${cap(s)}: técnica y memoria`,
  (s) => `Cinco ideas sobre ${s}`,
];
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

const COMENTARIOS = [
  'Me encantó este texto, muy bien explicado.',
  'No conocía esta técnica, gracias por compartir.',
  '¡Qué buen trabajo! Se nota el amor por la región.',
  '¿Dónde puedo ver más obras como esta?',
  'Muy interesante, ojalá hubiera un taller para aprender.',
  'Precioso. Me recordó a mi pueblo.',
  'Gracias por rescatar estas tradiciones.',
  'Excelente artículo, lo compartí con mis amigos.',
  'Me quedé con ganas de leer más sobre el tema.',
  '¿Usan materiales de la zona o los traen de fuera?',
  'Qué bonito ver arte de la Huasteca por aquí.',
  'Se aprende mucho con estas publicaciones.',
  'Felicidades al artista, un trabajo impecable.',
  'Muy inspirador, me dieron ganas de intentarlo.',
  'La foto que acompaña el texto está hermosa.',
];
const RESPUESTAS = [
  '¡Totalmente de acuerdo!',
  'Gracias por tu comentario, qué gusto que te sirviera.',
  'Sí, coincido contigo.',
  'Buena pregunta, yo también tengo esa duda.',
  'Justo pensaba lo mismo al leerlo.',
];

// Autores: admin (1311) + artistas (1312..1336). Mayormente artistas.
const AUTORES = [{ id: 1311, rol: 'admin' }];
for (let i = 1312; i <= 1336; i++) AUTORES.push({ id: i, rol: 'artista' });
const CLIENTES = []; for (let i = 1337; i <= 1736; i++) CLIENTES.push(i);

const daysAgo = (d) => { const t = new Date(); t.setDate(t.getDate() - d); return t; };

// Reparte N posts entre temas según su weight
function planTemas(n) {
  const totalW = THEMES.reduce((a, t) => a + t.weight, 0);
  const plan = [];
  THEMES.forEach((t) => { const cnt = Math.round(n * t.weight / totalW); for (let i = 0; i < cnt; i++) plan.push(t); });
  return shuffle(plan);
}

function generarContenido(theme) {
  const opener = pick(theme.openers);
  const b = shuffle(theme.bodies).slice(0, intBetween(2, 3));
  const closer = pick(theme.closers);
  const parrafos = [opener + ' ' + b[0], b.slice(1).join(' ') + ' ' + closer];
  return parrafos.map((p) => `<p>${p}</p>`).join('\n');
}
function nTags() { const r = rng(); return r < 0.15 ? 1 : r < 0.55 ? 2 : r < 0.85 ? 3 : 4; }
function nComentarios() { if (chance(0.5)) return 0; const r = rng(); return r < 0.5 ? 1 : r < 0.8 ? 2 : r < 0.93 ? intBetween(3, 4) : intBetween(5, 6); }

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000, statement_timeout: 900000,
    application_name: 'nub_seed_blog',
  });
  const c = await pool.connect();
  const q = (sql, p = []) => c.query(sql, p);
  try {
    await q('BEGIN');

    // 1) Mapa slug -> id_blog_etiqueta (las 12 curadas)
    const et = (await q('SELECT id_blog_etiqueta, slug FROM blog_etiquetas WHERE activo = true')).rows;
    const etId = Object.fromEntries(et.map((r) => [r.slug, r.id_blog_etiqueta]));
    for (const t of THEMES) {
      for (const s of [t.primary, ...t.sec]) if (!etId[s]) throw new Error(`Falta etiqueta curada: ${s}`);
    }

    // 2) Borrar seed anterior (hijos primero)
    const prev = (await q("SELECT id_post FROM blog_posts WHERE slug LIKE 'seed-post-%'")).rows.map(r => r.id_post);
    if (prev.length) {
      await q('DELETE FROM blog_comentarios   WHERE id_post = ANY($1)', [prev]);
      await q('DELETE FROM blog_reacciones     WHERE id_post = ANY($1)', [prev]);
      await q('DELETE FROM blog_posts_etiquetas WHERE id_post = ANY($1)', [prev]);
      await q('DELETE FROM blog_posts           WHERE id_post = ANY($1)', [prev]);
    }
    console.log(`· Borrados ${prev.length} posts seed anteriores.`);

    // 3) Generar
    const plan = planTemas(N_POSTS);
    let nTagRows = 0, nComRows = 0;
    for (let i = 0; i < plan.length; i++) {
      const theme = plan[i];
      const n = i + 1;
      const subject = pick(theme.subjects);
      const titulo = pick(TITLE_TEMPLATES)(subject);
      const slug = `seed-post-${n}`;
      const contenido = generarContenido(theme);
      const extracto = `${cap(subject)} — apuntes sobre ${theme.key} de la Huasteca Hidalguense.`;
      const autor = chance(0.12) ? AUTORES[0] : pick(AUTORES.slice(1));
      const dPub = intBetween(3, 360);
      const fechaPub = daysAgo(dPub);
      const fechaCre = daysAgo(dPub + intBetween(0, 3));
      const vistas = Math.floor(Math.pow(rng(), 2) * 500);
      const meta = `${cap(theme.key)} y ${theme.primary} en la Huasteca: ${subject}.`.slice(0, 160);

      const ins = await q(`
        INSERT INTO blog_posts
          (id_categoria, titulo, slug, contenido, extracto, meta_description,
           estado, fecha_publicacion, vistas, activo, eliminado,
           fecha_creacion, fecha_actualizacion, autor_id, autor_rol)
        VALUES ($1,$2,$3,$4,$5,$6,'publicado',$7,$8,true,false,$9,$9,$10,$11)
        RETURNING id_post`,
        [theme.id_categoria, titulo, slug, contenido, extracto, meta,
         fechaPub, vistas, fechaCre, autor.id, autor.rol]);
      const idPost = ins.rows[0].id_post;

      // Etiquetas: siempre la técnica principal + (nTags-1) secundarias distintas
      const nt = nTags();
      const tags = new Set([theme.primary]);
      const secShuffled = shuffle(theme.sec);
      let k = 0;
      while (tags.size < nt && k < secShuffled.length) tags.add(secShuffled[k++]);
      for (const s of tags) {
        await q('INSERT INTO blog_posts_etiquetas (id_post, id_blog_etiqueta, fecha_creacion) VALUES ($1,$2,$3)',
          [idPost, etId[s], fechaPub]);
        nTagRows++;
      }

      // Comentarios: cola larga; visibles = aprobado; algunos pendiente/rechazado
      const nc = nComentarios();
      const idsComentarios = [];
      for (let j = 0; j < nc; j++) {
        const rEstado = rng();
        const estado = rEstado < 0.85 ? 'aprobado' : rEstado < 0.95 ? 'pendiente' : 'rechazado';
        // ~15% de los comentarios (si ya hay alguno) son respuesta nivel 1
        const esRespuesta = idsComentarios.length > 0 && chance(0.15);
        const padre = esRespuesta ? pick(idsComentarios) : null;
        const nivel = esRespuesta ? 1 : 0;
        const contenidoCom = esRespuesta ? pick(RESPUESTAS) : pick(COMENTARIOS);
        const fComent = daysAgo(Math.max(1, dPub - intBetween(0, dPub)));
        const insC = await q(`
          INSERT INTO blog_comentarios (id_post, id_usuario, padre_id, nivel, contenido, estado, fecha_creacion, eliminado)
          VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id_comentario`,
          [idPost, pick(CLIENTES), padre, nivel, contenidoCom, estado, fComent]);
        idsComentarios.push(insC.rows[0].id_comentario);
        nComRows++;
      }
    }

    // 4) Verificación
    console.log(`\n✓ Generados ${plan.length} posts, ${nTagRows} etiquetas, ${nComRows} comentarios.`);
    const dist = (await q(`SELECT be.slug, COUNT(*)::int n FROM blog_posts_etiquetas bpe
      JOIN blog_etiquetas be ON be.id_blog_etiqueta=bpe.id_blog_etiqueta
      JOIN blog_posts bp ON bp.id_post=bpe.id_post WHERE bp.slug LIKE 'seed-post-%'
      GROUP BY be.slug ORDER BY n DESC`)).rows;
    console.log('\n— Distribución de etiquetas —'); console.table(dist);
    const tagsPorPost = (await q(`SELECT n_tags, COUNT(*)::int posts FROM (
        SELECT bp.id_post, COUNT(bpe.*)::int n_tags FROM blog_posts bp
        LEFT JOIN blog_posts_etiquetas bpe ON bpe.id_post=bp.id_post
        WHERE bp.slug LIKE 'seed-post-%' GROUP BY bp.id_post) s
      GROUP BY n_tags ORDER BY n_tags`)).rows;
    console.log('\n— Posts por # de etiquetas —'); console.table(tagsPorPost);
    const comDist = (await q(`SELECT n_com, COUNT(*)::int posts FROM (
        SELECT bp.id_post, COUNT(bc.*)::int n_com FROM blog_posts bp
        LEFT JOIN blog_comentarios bc ON bc.id_post=bp.id_post
        WHERE bp.slug LIKE 'seed-post-%' GROUP BY bp.id_post) s
      GROUP BY n_com ORDER BY n_com`)).rows;
    console.log('\n— Posts por # de comentarios (0 = sin comentarios) —'); console.table(comDist);
    const autores = (await q(`SELECT COUNT(DISTINCT autor_id)::int autores_distintos FROM blog_posts WHERE slug LIKE 'seed-post-%'`)).rows[0];
    console.log('\n— Autores distintos usados —', autores.autores_distintos);

    if (DRY) { await q('ROLLBACK'); console.log('\n↩ DRY-RUN: ROLLBACK, la BD quedó intacta.'); }
    else { await q('COMMIT'); console.log('\n✓✓ COMMIT — posts guardados en Neon.'); }
  } catch (e) {
    await q('ROLLBACK');
    console.error('\n✗ FALLÓ, ROLLBACK. Error:', e.message);
    if (e.detail) console.error('  detalle:', e.detail);
    process.exitCode = 1;
  } finally { c.release(); await pool.end(); }
}
main();
