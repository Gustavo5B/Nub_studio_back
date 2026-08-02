// =========================================================
//  Seed MASIVO de POSTS de blog: agrega 1800 posts NUEVOS a los
//  existentes (no borra ni toca los 'seed-post-1'..'seed-post-239'
//  del script original seedBlogPosts.mjs) para escalar la BD del
//  blog de ~248 a ~2048 registros, útil para robustecer los
//  modelos de ML (clasificación, posts relacionados).
//
//  Diferencias clave frente a seedBlogPosts.mjs:
//   - NO es destructivo: continúa la numeración de slugs donde se
//     haya quedado (consulta el máximo 'seed-post-N' actual + 1),
//     así que puede convivir con el seed original sin pisarlo.
//   - Bancos de vocabulario mucho más grandes por tema (subjects,
//     aperturas, cuerpos, cierres) + una oración de "detalle regional"
//     que combina un municipio de la Huasteca con el oficio del tema,
//     para que el espacio combinatorio sea enorme y cada post sea
//     realmente distinto de los demás (se valida con Sets de
//     unicidad de título y de "huella" del contenido; si hay colisión
//     se vuelve a generar automáticamente).
//   - Inserciones en bloque (multi-row INSERT) para posts y etiquetas
//     en vez de una consulta por fila -> mucho más rápido a esta
//     escala. Los comentarios se insertan por post (uno a la vez)
//     porque las respuestas anidadas necesitan el id del comentario
//     padre, que solo se conoce tras insertarlo.
//   - Guarda de seguridad: si ya existen ~2000+ posts 'seed-post-%'
//     asume que este script ya corrió antes y aborta, salvo --force,
//     para no duplicar el trabajo por accidente.
//   - Evidencia en .sql: al terminar (haya COMMIT o sea --dry-run), se
//     escribe un volcado literal en migrations/evidencia_seed_blog_masivo_*.sql
//     con los INSERT exactos (incluyendo los id_post / id_comentario reales
//     que quedaron en Neon). No reemplaza a este script -- este .mjs sigue
//     siendo la fuente de la lógica -- pero el .sql es la prueba concreta
//     de qué terminó exactamente en la base de datos. NO está pensado para
//     volver a ejecutarse (los ids ya existen), es solo evidencia/auditoría.
//
//     node scripts/seedBlogPostsMasivo.mjs             (aplica: COMMIT)
//     node scripts/seedBlogPostsMasivo.mjs --dry-run   (valida: ROLLBACK)
//     node scripts/seedBlogPostsMasivo.mjs --force     (ignora la guarda)
//     node scripts/seedBlogPostsMasivo.mjs --n=500     (cambia cuántos posts nuevos genera)
//     node scripts/seedBlogPostsMasivo.mjs --sin-evidencia  (no escribe el .sql)
// =========================================================
import 'dotenv/config';
import pkg from 'pg'; const { Pool } = pkg;
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCIA_DIR = join(__dirname, '..', 'migrations');

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const SIN_EVIDENCIA = process.argv.includes('--sin-evidencia');
const N_NUEVOS = Number(process.argv.find((a) => a.startsWith('--n='))?.split('=')[1]) || 1800;
const TOPE_SEGURIDAD = 2000; // si ya hay esto o más 'seed-post-%', probablemente ya se corrió

// RNG determinista (mulberry32) — semilla distinta a seedBlogPosts.mjs
// para no repetir exactamente la misma secuencia de elecciones.
let _s = (0xC0FFEE ^ 0x9e3779b9) >>> 0;
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
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// Contrae "de el X" -> "del X" y "a el X" -> "al X" (subjects/oficios que empiezan con "el ")
const contraer = (prep, s) => (/^el\s/i.test(s) ? `${prep === 'de' ? 'del' : 'al'} ${s.slice(3)}` : `${prep} ${s}`);
const conDe = (s) => contraer('de', s);
const conA = (s) => contraer('a', s);

// Municipios/localidades asociados a "la Huasteca" ya usados como alias
// de artista en el seed de obras (Yahualica, Tamazunchale, Papantla,
// Huejutla, Molango) + otros de la región para dar variedad regional.
const LUGARES = [
  'Huejutla de Reyes', 'Yahualica', 'Xochiatipan', 'Atlapexco', 'Jaltocán',
  'Huautla', 'Tlanchinol', 'Molango', 'Lolotla', 'Calnali', 'Chapulhuacán',
  'Tamazunchale', 'Chicontepec', 'Tantoyuca', 'Ixhuatlán de Madero', 'Papantla',
];

// Oraciones de "detalle regional" — genéricas, reciben lugar + oficio
// del tema para combinarse con cualquiera de los 7 temas.
const DETALLE_TPL = [
  (l, o) => `En ${l} este oficio se aprende todavía de manera directa, de maestro a aprendiz.`,
  (l, o) => `Los talleres de ${l} conservan herramientas y procedimientos que casi nadie documenta por escrito.`,
  (l, o) => `Quienes visitan ${l} suelen sorprenderse de la vigencia ${conDe(o)} en la vida diaria del pueblo.`,
  (l, o) => `En la región de ${l}, ${o} convive con el trabajo del campo y con las fiestas patronales del año.`,
  (l, o) => `Los mercados de ${l} todavía exhiben piezas hechas sin apuro, a la manera de siempre.`,
  (l, o) => `Algunas familias de ${l} llevan generaciones enteras dedicadas a este oficio.`,
  (l, o) => `En ${l} el oficio se explica primero en náhuatl y después en español, según cuentan los mayores.`,
  (l, o) => `No es raro encontrar en ${l} talleres pequeños donde ${o} sigue siendo trabajo de toda la familia.`,
  (l, o) => `${cap(l)} guarda, en sus talleres, una versión del oficio que no aparece en los libros.`,
  (l, o) => `La feria anual de ${l} es, para muchos, la primera vez que ven de cerca ${o} en proceso.`,
];

// ── Temas: cada uno = categoría + etiqueta principal (técnica/oficio) +
//    etiquetas temáticas secundarias + bancos de vocabulario propios ───
const THEMES = [
  {
    key: 'pintura', id_categoria: 2, primary: 'pintura', oficio: 'la pintura',
    sec: ['paisaje', 'retrato', 'naturaleza', 'tradicion', 'huasteca'], weight: 5,
    subjectsBase: [
      'el paisaje huasteco', 'el retrato campesino', 'la luz de la sierra', 'los colores de la milpa',
      'la vida en el pueblo', 'el río al amanecer', 'los murales comunitarios', 'la acuarela de temporada',
      'el óleo sobre lienzo', 'los cielos de la Huasteca', 'la pintura al aire libre', 'los mercados pintados',
    ],
    openers: [
      'La pintura sigue siendo el lenguaje más directo para hablar de la Huasteca.',
      'Frente al lienzo en blanco, el pintor decide qué mirada quiere dejar del paisaje.',
      'Hay obras que no se explican con palabras: se sienten en la pincelada.',
      'Pintar la región es también decidir qué se quiere recordar de ella.',
      'No toda pintura busca ser fiel al paisaje: algunas prefieren su propia versión de la luz.',
      'El taller del pintor huasteco suele oler a trementina y a café recalentado.',
    ],
    bodies: [
      'El manejo del óleo permite construir capas de color que dan profundidad al cielo y a las montañas al fondo.',
      'La acuarela, en cambio, obliga a decidir rápido: el agua arrastra el pigmento y no perdona la duda.',
      'Los tonos ocres y verdes recrean la vegetación densa de la sierra, mientras la luz cálida marca la hora del día.',
      'El artista trabaja la composición para guiar la mirada desde el primer plano hasta el horizonte.',
      'Cada retrato busca la dignidad del rostro: las arrugas, la mirada, las manos que cuentan una historia de trabajo.',
      'Los murales comunitarios convierten una fachada cualquiera en una narración colectiva del pueblo.',
      'Algunos pintores prefieren trabajar de memoria; otros no sueltan el pincel sin el paisaje enfrente.',
      'La paleta se reduce cuando el tema lo pide: menos color, más contraste, más silencio en la imagen.',
      'El boceto previo decide la mitad del cuadro, aunque el color termine de resolver la otra mitad.',
      'La pintura de mercado capta el bullicio con manchas de color más que con detalle preciso.',
      'Un cuadro bien resuelto no necesita explicación: el espectador reconoce el lugar aunque nunca lo haya visitado.',
      'La textura del lienzo cambia según la técnica: hay obras que piden empaste y otras que piden transparencia.',
    ],
    closers: [
      'Al final, pintar el paisaje es una forma de agradecerle a la tierra.',
      'La obra queda como testimonio de un momento que ya no volverá igual.',
      'Cada cuadro terminado es una manera distinta de decir "aquí vivo".',
      'La pintura, más que copiar el paisaje, termina por interpretarlo.',
    ],
  },
  {
    key: 'ceramica', id_categoria: 6, primary: 'ceramica', oficio: 'la cerámica',
    sec: ['tradicion', 'huasteca', 'escultura', 'naturaleza'], weight: 4,
    subjectsBase: [
      'el barro rojo de la sierra', 'la alfarería tradicional', 'las vasijas de uso diario', 'el torno y sus secretos',
      'los esmaltes naturales', 'las formas ancestrales', 'el horno de leña', 'la cerámica utilitaria',
      'las piezas de temporada', 'el modelado a mano', 'la loza vidriada', 'los comales de barro',
    ],
    openers: [
      'La cerámica de la Huasteca nace del barro que se saca de la propia tierra.',
      'Antes de encender el horno, el ceramista amasa la arcilla hasta quitarle todo el aire.',
      'Cada pieza de barro guarda las huellas de las manos que la moldearon.',
      'El barro no perdona la prisa: hay que dejarlo secar a su propio ritmo.',
      'En muchos talleres, el torno todavía se mueve con el pie, no con motor.',
      'Antes de ser objeto, el barro fue tierra, agua y paciencia.',
    ],
    bodies: [
      'El torno gira y las manos húmedas van levantando las paredes de la vasija con paciencia.',
      'La cocción es el momento decisivo: un descuido en la temperatura puede quebrar horas de trabajo.',
      'Los esmaltes se preparan con óxidos que, tras el fuego, revelan colores imposibles de prever del todo.',
      'Las formas recuperan la memoria de la alfarería prehispánica, adaptada a la vida de hoy.',
      'El barro rojo, característico de la región, da a las piezas un tono cálido inconfundible.',
      'Antes de vidriar, la pieza pasa por una primera cocción llamada bizcocho.',
      'Los comales de barro siguen siendo, para muchas familias, el único que sirve de verdad para las tortillas.',
      'El horno de leña exige vigilancia toda la noche: el fuego no se puede dejar solo.',
      'Algunas piezas se decoran con engobes de colores antes de la cocción final.',
      'El peso justo de una vasija se aprende con los años, no se mide con báscula.',
      'La grieta que aparece al secar suele deberse a un amasado con burbujas de aire.',
      'El oficio combina fuerza en las manos y delicadeza en el tacto al mismo tiempo.',
    ],
    closers: [
      'El barro enseña que la prisa no cabe en el oficio.',
      'Cada vasija terminada es pequeña victoria contra la fragilidad del material.',
      'La cerámica, más que un objeto, es la memoria de una tierra puesta en forma.',
      'Al final, el fuego decide lo que las manos apenas insinuaron.',
    ],
  },
  {
    key: 'grabado', id_categoria: 7, primary: 'grabado', oficio: 'el grabado',
    sec: ['tradicion', 'huasteca', 'retrato', 'naturaleza'], weight: 3,
    subjectsBase: [
      'la xilografía', 'el grabado en linóleo', 'la estampa popular', 'la matriz y la tinta',
      'la gráfica de la Huasteca', 'el oficio de imprimir', 'los carteles comunitarios', 'el aguafuerte',
      'la serigrafía artesanal', 'las ediciones numeradas', 'el grabado en metal', 'la estampa de fiesta',
    ],
    openers: [
      'El grabado es el arte de la huella: una matriz que se repite y a la vez nunca es idéntica.',
      'Tallar la madera para grabar exige pensar al revés, en negativo.',
      'La estampa tiene una fuerza gráfica que la vuelve arte del pueblo.',
      'Grabar es también resistir: cada tiraje multiplica una imagen que de otro modo se perdería.',
      'El taller de grabado casi siempre huele a tinta y a solvente.',
      'Antes de la primera prueba de tiraje, la matriz guarda todavía un secreto.',
    ],
    bodies: [
      'La gubia abre surcos en la madera o el linóleo, y lo que se quita será el blanco del papel.',
      'La tinta se entinta con rodillo y la presión del tórculo transfiere la imagen a la hoja.',
      'Cada tiraje se numera, porque la matriz se desgasta y ninguna copia es infinita.',
      'Los temas retoman escenas de la vida cotidiana, retratos y motivos de la naturaleza local.',
      'El blanco y negro obliga a resolver la imagen por contraste, sin ayuda del color.',
      'El aguafuerte trabaja sobre metal mordido con ácido, técnica más lenta pero de líneas finísimas.',
      'La serigrafía permite tirajes más grandes, útiles para carteles de fiestas y ferias.',
      'Cada prueba de estado marca un paso en la decisión final de la imagen.',
      'El papel se humedece antes de imprimir para que absorba mejor la tinta bajo presión.',
      'Algunos grabadores conservan matrices de décadas, reimprimibles todavía hoy.',
      'La imagen espejada obliga a pensar el boceto al revés desde el principio.',
      'El registro de color, cuando lo hay, exige varias matrices perfectamente alineadas.',
    ],
    closers: [
      'El grabado democratiza el arte: multiplica sin traicionar el original.',
      'Queda en el papel la memoria del gesto que abrió la madera.',
      'Cada estampa es, a la vez, única y repetible: esa es su rareza.',
      'El oficio recuerda que hacer copias también puede ser un acto de cuidado.',
    ],
  },
  {
    key: 'textil', id_categoria: 4, primary: 'textil', oficio: 'el bordado',
    sec: ['tradicion', 'huasteca', 'naturaleza'], weight: 3,
    subjectsBase: [
      'el bordado nahua', 'el telar de cintura', 'los tintes naturales', 'las fibras de la región',
      'los motivos ancestrales', 'la indumentaria tradicional', 'el quechquémitl bordado', 'las servilletas de fiesta',
      'el hilo teñido a mano', 'los diseños geométricos', 'el bordado de flores', 'la ropa ceremonial',
    ],
    openers: [
      'El textil huasteco cuenta con hilos lo que otras artes cuentan con pinceles.',
      'Cada bordado es un idioma: sus figuras nombran flores, aves y montañas.',
      'El telar de cintura ata el cuerpo de la tejedora a su obra.',
      'Antes de la primera puntada, la tejedora ya decidió todo el diseño en su cabeza.',
      'Bordar en la Huasteca no es pasatiempo: es un oficio que sostiene economías familiares.',
      'El hilo, antes de ser bordado, pasó por el tinte, el secado y muchas manos.',
    ],
    bodies: [
      'Los hilos se tiñen con plantas y minerales de la región para lograr colores firmes.',
      'El bordado nahua reproduce flores y animales con una simetría aprendida de generación en generación.',
      'Tejer en telar de cintura implica tensar la urdimbre con el propio peso del cuerpo.',
      'Cada prenda puede tomar semanas, porque el diseño se construye puntada a puntada.',
      'Los motivos no son decorativos: cuentan la cosmovisión y el entorno natural de la comunidad.',
      'El quechquémitl bordado distingue a quien lo porta en fiestas y ceremonias del pueblo.',
      'Las servilletas bordadas suelen regalarse en bodas como parte del ajuar tradicional.',
      'El punto de cruz y el deshilado conviven en una misma prenda sin competir entre sí.',
      'Cada comunidad tiene su propia paleta de colores, reconocible a simple vista.',
      'Enhebrar la aguja con hilo grueso exige práctica antes de empezar el diseño.',
      'El diseño geométrico se cuenta en hilos, no se dibuja antes sobre la tela.',
      'Una prenda terminada puede pasar de madre a hija durante varias generaciones.',
    ],
    closers: [
      'El textil es archivo vivo de la memoria de un pueblo.',
      'Vestir un bordado es cargar consigo una historia colectiva.',
      'Cada puntada sostiene, además de un hilo, una tradición completa.',
      'El bordado demuestra que el tiempo lento también puede ser un lujo compartido.',
    ],
  },
  {
    key: 'escultura', id_categoria: 3, primary: 'escultura', oficio: 'la talla',
    sec: ['tradicion', 'huasteca', 'naturaleza'], weight: 3,
    subjectsBase: [
      'la talla en madera', 'el modelado del barro', 'la piedra de la región', 'el volumen y el vacío',
      'las figuras rituales', 'la forma en tres dimensiones', 'la máscara tallada', 'el santo de bulto',
      'la escultura en cantera', 'las figuras de altar', 'la talla popular', 'el tótem de madera',
    ],
    openers: [
      'La escultura obliga a caminar alrededor: no hay un solo punto de vista.',
      'Tallar es un diálogo con el material, que impone su veta y su dureza.',
      'Del bloque informe emerge, poco a poco, una figura que ya estaba dentro.',
      'Una escultura ocupa espacio real, no solo espacio visual.',
      'El escultor aprende primero a escuchar la madera antes de cortarla.',
      'Tallar una máscara es tallar, al mismo tiempo, un personaje entero.',
    ],
    bodies: [
      'La talla en madera respeta la veta: forzarla es arriesgarse a que la pieza se raje.',
      'El modelado en barro permite añadir y quitar volumen hasta encontrar la forma justa.',
      'La luz que resbala sobre la superficie define el volumen tanto como el propio material.',
      'Muchas piezas recuperan figuras rituales y símbolos de la tradición de la Huasteca.',
      'El escultor piensa en el peso, el equilibrio y el vacío que rodea a la figura.',
      'La cantera regional se trabaja con cincel y maza, un golpe a la vez.',
      'El santo de bulto exige proporciones cuidadas: cualquier error se nota en el rostro.',
      'Las máscaras rituales combinan tallado, pintura y a veces textil sobre una misma pieza.',
      'El pulido final puede tomar tanto tiempo como el propio desbaste inicial.',
      'Algunas figuras se dejan sin pintar para que se note la veta natural de la madera.',
      'El tótem de madera organiza varias figuras superpuestas en una sola narración vertical.',
      'La base de la escultura decide, muchas veces, si la pieza transmite quietud o movimiento.',
    ],
    closers: [
      'La escultura ocupa el espacio y nos recuerda que también somos cuerpo.',
      'La forma final es apenas el resto del largo diálogo con la materia.',
      'Cada talla conserva, además de la imagen, el gesto que la sacó del bloque.',
      'Al final, esculpir es también decidir qué material merece perdurar.',
    ],
  },
  {
    key: 'fotografia', id_categoria: 1, primary: 'fotografia', oficio: 'la fotografía',
    sec: ['paisaje', 'retrato', 'naturaleza', 'huasteca'], weight: 3,
    subjectsBase: [
      'el retrato documental', 'la luz natural', 'el paisaje serrano', 'la vida de las comunidades',
      'el instante decisivo', 'la fotografía de la Huasteca', 'la niebla de la sierra', 'el mercado dominical',
      'la fotografía en blanco y negro', 'el río y sus orillas', 'las fiestas patronales', 'el retrato de familia',
    ],
    openers: [
      'La fotografía detiene el tiempo justo antes de que se escape.',
      'Fotografiar la Huasteca es aprender a esperar la luz correcta.',
      'Una buena imagen no se toma: se construye con paciencia y mirada.',
      'La cámara no inventa nada que no estuviera ya frente al lente.',
      'Fotografiar de cerca a una comunidad exige primero ganarse su confianza.',
      'La niebla de la sierra cambia por completo el carácter de una fotografía.',
    ],
    bodies: [
      'La luz de la mañana modela los rostros y da textura al paisaje de la sierra.',
      'El encuadre decide qué entra y qué se queda fuera; ahí está la mitad del mensaje.',
      'El retrato documental busca la confianza de quien posa, no la pose forzada.',
      'La profundidad de campo separa a la persona de un fondo de montañas y niebla.',
      'La fotografía de comunidades exige respeto: se retrata con la gente, no sobre la gente.',
      'El mercado dominical ofrece una escena distinta cada media hora, según cambia la luz.',
      'El blanco y negro simplifica la imagen y obliga a pensar en contraste y textura.',
      'Las fiestas patronales son, para el fotógrafo documental, un archivo anual irrepetible.',
      'Un buen retrato de familia necesita tiempo: nadie posa igual al primer intento.',
      'La lluvia repentina de la sierra puede arruinar una sesión o regalar la mejor imagen.',
      'El río, según la hora, refleja el cielo de maneras que ningún filtro logra igual.',
      'Fotografiar de noche en la sierra exige otro tipo de paciencia, casi de vigilia.',
    ],
    closers: [
      'La imagen queda como testigo de un instante irrepetible.',
      'Al final, fotografiar es una manera de mirar dos veces.',
      'La cámara no roba nada: solo guarda lo que ya estaba dispuesto a mostrarse.',
      'Cada fotografía es, también, una promesa de que ese instante no se olvidará.',
    ],
  },
  {
    key: 'ilustracion', id_categoria: 5, primary: 'ilustracion', oficio: 'la ilustración',
    sec: ['naturaleza', 'tradicion', 'huasteca', 'retrato'], weight: 2,
    subjectsBase: [
      'la ilustración de la fauna', 'los mitos de la sierra', 'la flora local', 'el dibujo narrativo',
      'los personajes tradicionales', 'la ilustración editorial', 'el cuento ilustrado', 'las leyendas huastecas',
      'la ilustración infantil', 'el dibujo a tinta', 'las aves de la región', 'el bestiario huasteco',
    ],
    openers: [
      'La ilustración pone imagen a lo que la palabra apenas insinúa.',
      'Dibujar la fauna de la sierra es también una forma de conservarla.',
      'Cada ilustración cuenta una pequeña historia en un solo cuadro.',
      'Ilustrar una leyenda obliga a decidir cómo se ve algo que nadie ha visto.',
      'El dibujo a tinta no permite arrepentimientos a mitad de camino.',
      'Muchas leyendas de la región solo sobreviven porque alguien las dibujó.',
    ],
    bodies: [
      'El trazo limpio define personajes y criaturas inspirados en los mitos de la región.',
      'La paleta de color se elige para evocar la vegetación y la luz de la Huasteca.',
      'La ilustración de flora y fauna combina rigor de observación con licencia poética.',
      'El dibujo narrativo organiza la composición para que la mirada lea la escena en orden.',
      'Muchos trabajos rescatan personajes y leyendas de la tradición oral local.',
      'El bestiario huasteco reúne criaturas que solo existen en el relato de los abuelos.',
      'Un buen cuento ilustrado reparte la historia entre el texto y la imagen a partes iguales.',
      'Las aves de la región aparecen una y otra vez como símbolo de libertad en las leyendas.',
      'La tinta china exige planear cada línea antes de que toque el papel.',
      'La ilustración infantil simplifica formas sin perder la identidad del personaje.',
      'Un mismo mito puede ilustrarse de maneras opuestas según la época del ilustrador.',
      'El color plano, sin degradados, ayuda a que el personaje se reconozca de inmediato.',
    ],
    closers: [
      'La ilustración mantiene viva la imaginación de un territorio.',
      'Un buen dibujo se queda en la memoria más que muchas palabras.',
      'Ilustrar una leyenda es, de algún modo, asegurar que siga contándose.',
      'Al final, dibujar también es una forma de recordar en comunidad.',
    ],
  },
];

// Oraciones de cuerpo GENÉRICAS: no hablan de una técnica en particular,
// reciben el "oficio" del tema (ej. 'la pintura', 'el grabado') y se suman
// al banco propio de cada tema. Esto multiplica el espacio combinatorio
// sin tener que escribir a mano decenas de frases por cada uno de los 7
// temas — cada tema termina con ~12 (propias) + ~22 (genéricas) = ~34
// oraciones posibles, en vez de solo 12, lo que baja mucho la probabilidad
// de que dos posts del mismo tema compartan literalmente las mismas frases
// (relevante para no inflar artificialmente las métricas de un clasificador
// de ML entrenado sobre este texto).
const GENERIC_BODIES = [
  (o) => `${cap(o)} no se aprende de un día para otro: toma años de práctica constante.`,
  (o) => `Vivir ${conDe(o)} no es fácil; muchos artesanos combinan el oficio con otros trabajos.`,
  (o) => `Las ferias regionales son, para quienes se dedican ${conA(o)}, la principal oportunidad de venta directa.`,
  (o) => `Cada vez más jóvenes aprenden ${o} viendo videos, aunque nada sustituye al taller presencial.`,
  (o) => `El precio justo de una pieza rara vez refleja las horas reales que costó hacerla.`,
  (o) => `Son sobre todo las mujeres quienes sostienen, generación tras generación, ${o} en muchas comunidades.`,
  (o) => `Las redes sociales han abierto un mercado nuevo para quienes practican ${o}, aunque no siempre justo.`,
  (o) => `El turismo cultural despertó de nuevo el interés por ${o} en la última década.`,
  (o) => `No todos los talleres sobreviven: sin apoyo, muchos jóvenes prefieren migrar a la ciudad.`,
  (o) => `Instituciones culturales han comenzado a documentar ${o} antes de que se pierda por completo.`,
  (o) => `Comparado con la producción industrial, ${o} avanza despacio, pero no se repite nunca igual.`,
  (o) => `El olor del taller, entre materiales y humedad, es parte de la memoria de cualquier aprendiz.`,
  (o) => `Muchas piezas se venden todavía de boca en boca, sin catálogo ni fotografía.`,
  (o) => `La pandemia obligó a varios talleres a vender en línea por primera vez.`,
  (o) => `Quien practica ${o} suele decir que el material manda más que la idea original.`,
  (o) => `Las cooperativas de artesanos negocian mejor precio que quienes venden solos.`,
  (o) => `El calendario de fiestas del pueblo marca, más que el clima, el ritmo de trabajo del taller.`,
  (o) => `Pocas escuelas enseñan ${o} de manera formal: casi todo se transmite en casa.`,
  (o) => `El cambio de temporada también cambia los materiales disponibles para el oficio.`,
  (o) => `Turistas y coleccionistas no siempre entienden por qué una pieza tarda semanas en terminarse.`,
  (o) => `Documentar el proceso paso a paso ayuda a que ${o} no se quede solo en la memoria oral.`,
  (o) => `El respeto por el material es, para muchos artesanos, la primera lección ${conDe(o)}.`,
  // -- ampliación: historia, conservación, generaciones, economía, identidad --
  () => `El origen de muchas piezas se remonta a técnicas prehispánicas que sobrevivieron a la Conquista.`,
  () => `La mezcla entre lo indígena y lo español dejó huella en los motivos que se usan todavía hoy.`,
  () => `Cuidar una pieza artesanal exige más atención que cualquier objeto comprado en serie.`,
  () => `Una pieza bien conservada puede durar generaciones sin perder su color ni su forma.`,
  () => `Coleccionistas de la Ciudad de México y del extranjero buscan piezas con historia, no solo con estética.`,
  () => `Muchas piezas nacen como encargo para una boda, un bautizo o una fiesta patronal específica.`,
  () => `Los abuelos enseñan la técnica base; los nietos, muchas veces, le suman su propio estilo.`,
  () => `No toda innovación traiciona la tradición: algunos jóvenes actualizan colores sin perder la técnica.`,
  () => `La fiesta patronal del pueblo suele ser la fecha límite silenciosa de muchos talleres.`,
  () => `La humedad de la temporada de lluvias cambia por completo los tiempos de secado y cocción.`,
  () => `Cada taller guarda alguna anécdota de una pieza que casi se pierde por un descuido.`,
  () => `En las ciudades, las galerías cobran comisiones que muchas veces los propios artesanos no ven justas.`,
  () => `Distintos oficios se prestan técnicas entre sí más de lo que el público imagina.`,
  () => `En una familia artesana, hasta los niños ayudan en tareas pequeñas del proceso.`,
  () => `Algunas piezas llegan a exportarse, aunque el margen para el artesano rara vez crece con la distancia.`,
  () => `Un premio o reconocimiento estatal puede cambiarle la vida económica a un taller pequeño.`,
  () => `La competencia con productos de plástico ha golpeado fuerte a los oficios más tradicionales.`,
  () => `Vender directo, sin intermediarios, sigue siendo la meta de la mayoría de los talleres.`,
  () => `Un buen catálogo fotográfico ayuda a vender, pero pocos talleres tienen quien lo haga.`,
  () => `Algunos talleres ya ofrecen visitas guiadas para que el turista arme su propia pieza.`,
  () => `La lengua náhuatl guarda palabras específicas para pasos del oficio que el español no traduce bien.`,
  () => `Actualizar el oficio sin perderlo del todo es el reto constante de cada nueva generación.`,
  () => `Usar materiales de la región, en vez de importados, sigue siendo más barato y más sostenible.`,
  () => `Pasar años sentado o de pie en una misma postura deja secuelas que pocos artesanos mencionan.`,
  () => `Conseguir un crédito para herramientas nuevas es, para muchos talleres, casi imposible.`,
  () => `Las ferias internacionales exponen el oficio, aunque el costo del viaje no siempre lo justifica.`,
  () => `Las redes de mujeres artesanas negocian ventas conjuntas que ninguna lograría sola.`,
  () => `Con las ganancias del taller, no pocas familias han logrado mandar a sus hijos a la universidad.`,
  () => `Regalar una pieza hecha a mano todavía se considera, en la región, un gesto de mucho valor.`,
  () => `Parte del dinero que sostiene los talleres llega de familiares que migraron y mandan remesas.`,
  () => `Una denominación de origen podría proteger el oficio, aunque el trámite es lento y costoso.`,
  () => `Los museos comunitarios exhiben piezas que de otro modo terminarían vendidas fuera de la región.`,
  () => `En años de crisis económica, el oficio es de los primeros gastos que las familias recortan.`,
  () => `No todos los jóvenes del pueblo ven con orgullo el oficio de sus padres.`,
  () => `Algunas marcas de moda urbana han buscado colaborar con talleres tradicionales, con resultados desiguales.`,
  () => `Una pieza ceremonial y una de uso diario rara vez se hacen con el mismo cuidado.`,
  () => `El oficio es, para muchas familias nahuas, parte central de su identidad étnica.`,
  () => `Reutilizar retazos y sobrantes es más una necesidad económica que una elección ecológica.`,
  () => `El valor cultural de una pieza casi nunca se refleja en el precio que paga el comprador final.`,
  () => `Algunos talleres llevan el mismo nombre de familia desde hace más de tres generaciones.`,
  () => `La primera pieza que hace un aprendiz casi siempre se queda en casa, nunca se vende.`,
  () => `Enseñar el oficio a un extraño, fuera de la familia, todavía genera desconfianza en algunos pueblos.`,
  () => `Contar con luz eléctrica estable cambió por completo los horarios de trabajo en muchos talleres.`,
  () => `Algunas piezas requieren dos o tres pares de manos trabajando al mismo tiempo.`,
  () => `El transporte de piezas frágiles a otras ciudades es, muchas veces, más caro que hacerlas.`,
  () => `Ninguna pieza sale exactamente igual a la anterior, aunque el molde o el diseño sea el mismo.`,
  () => `Explicarle el proceso a un comprador apurado rara vez cambia su opinión sobre el precio.`,
  () => `El oficio también se aprende por prueba y error: cada pieza fallida enseña algo distinto.`,
  () => `Los domingos de mercado siguen siendo, en muchos pueblos, el único momento de venta segura.`,
  () => `Un taller ordenado no es garantía de mejor pieza, pero sí de menos accidentes.`,
  () => `Guardar la fórmula exacta de un tinte o esmalte es, para algunas familias, un secreto celosamente guardado.`,
  () => `El clima extremo de cada temporada obliga a ajustar tiempos que ningún manual explica bien.`,
  () => `Muchos compradores prefieren la pieza "perfecta" sin saber que la imperfección es parte del oficio.`,
  () => `Algunas escuelas rurales han empezado a incluir el oficio como taller extracurricular.`,
  () => `El apoyo de programas de gobierno llega, cuando llega, casi siempre con mucho retraso.`,
  () => `Documentar en video el proceso ayuda a las nuevas generaciones que ya no viven en el pueblo.`,
  () => `Una crisis de salud en la familia puede detener un taller por meses enteros.`,
  () => `El oficio conecta a quien lo practica con generaciones que nunca conoció en persona.`,
  () => `La curiosidad de un turista, aunque incómoda a veces, también ha salvado talleres de cerrar.`,
  () => `Muchas piezas cambian de dueño varias veces antes de encontrar un hogar definitivo.`,
  () => `El trabajo en equipo dentro del taller se nota más en la calidad que en la velocidad.`,
  () => `Ningún artesano recuerda con exactitud cuántas piezas ha hecho en toda su vida.`,
  () => `Guardar una pieza rota, en vez de tirarla, es común entre quienes conocen su valor real.`,
  () => `El oficio no se mide solo en pesos: también en el tiempo que cada familia decide dedicarle.`,
  () => `Las cofradías y mayordomías siguen encargando piezas ceremoniales que no se venden al público.`,
  () => `El trueque, aunque menos común, sigue existiendo entre artesanos de distintos oficios.`,
];

const TITLE_TEMPLATES = [
  (s) => `Cómo entender ${s}`,
  (s) => `Guía breve sobre ${s}`,
  (s) => `${cap(s)}: apuntes desde el taller`,
  (s) => `Notas sobre ${s}`,
  (s) => `${cap(s)} paso a paso`,
  (s) => `Lo que aprendí ${conDe(s)}`,
  (s) => `${cap(s)} en la Huasteca Hidalguense`,
  (s) => `Una mirada ${conA(s)}`,
  (s) => `${cap(s)}: técnica y memoria`,
  (s) => `Cinco ideas sobre ${s}`,
  (s) => `${cap(s)}: entre el oficio y el arte`,
  (s) => `Lo que no se enseña ${conDe(s)}`,
  (s) => `${cap(s)}, contado por quienes lo hacen`,
  (s) => `Pequeño diario ${conDe(s)}`,
  (s) => `${cap(s)}: preguntas frecuentes`,
  (s) => `Volver a mirar ${s}`,
];

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
  'No sabía que el proceso era tan laborioso.',
  'Ojalá compartan más sobre los artesanos detrás de esto.',
  '¿Se puede encargar una pieza personalizada?',
  'Este blog se ha vuelto mi favorito para conocer la región.',
  'Justo lo que buscaba, muy bien redactado.',
  'Se agradece que documenten estos oficios antes de que se pierdan.',
  'Una perspectiva muy honesta del trabajo artesanal.',
  'Me hizo recordar a mi abuela, que hacía algo parecido.',
  '¿Tienen redes sociales del artista mencionado?',
  'Contenido de mucha calidad, como siempre.',
  'Qué manera tan bonita de contar el oficio.',
  '¿Cuánto tiempo lleva aprender esta técnica?',
  'Le mostré esto a mi familia y les encantó.',
  'Se nota la investigación detrás de este artículo.',
  'Espero más publicaciones como esta.',
];
const RESPUESTAS = [
  '¡Totalmente de acuerdo!',
  'Gracias por tu comentario, qué gusto que te sirviera.',
  'Sí, coincido contigo.',
  'Buena pregunta, yo también tengo esa duda.',
  'Justo pensaba lo mismo al leerlo.',
  'Gracias por leer hasta el final.',
  'Qué bueno que te haya gustado.',
  'Nosotros pensamos lo mismo al escribirlo.',
];

function planTemas(n) {
  const totalW = THEMES.reduce((a, t) => a + t.weight, 0);
  const plan = [];
  THEMES.forEach((t) => { const cnt = Math.round(n * t.weight / totalW); for (let i = 0; i < cnt; i++) plan.push(t); });
  return shuffle(plan);
}

function generarSubject(theme) {
  const base = pick(theme.subjectsBase);
  if (chance(0.3)) return base; // 30%: subject "puro", sin lugar
  const lugar = pick(LUGARES);
  const conector = pick([' en ', ' cerca de ', ' alrededor de ']);
  return `${base}${conector}${lugar}`;
}

// Posts cortos (~22%), medios (~56%) y largos (~22%) — no todos con la
// misma extensión, igual que pasaría con autores reales distintos.
function elegirLongitud() {
  const r = rng();
  if (r < 0.22) return 'corto';
  if (r < 0.78) return 'medio';
  return 'largo';
}

function generarContenido(theme, lugar) {
  const longitud = elegirLongitud();
  const pool = [...theme.bodies, ...GENERIC_BODIES.map((fn) => fn(theme.oficio))];
  const nBodies = longitud === 'corto' ? intBetween(2, 3) : longitud === 'medio' ? intBetween(3, 4) : intBetween(6, 8);
  const bIdx = shuffle([...Array(pool.length).keys()]).slice(0, nBodies);
  const bodies = bIdx.map((i) => pool[i]);
  const opener = pick(theme.openers);
  const closer = pick(theme.closers);
  // Índices de DETALLE_TPL distintos entre sí, para no repetir el mismo
  // molde de frase dos veces en un post largo (solo cambiaría el lugar).
  const detalleIdx = shuffle([...Array(DETALLE_TPL.length).keys()]).slice(0, longitud === 'largo' ? 2 : 1);
  const detalles = detalleIdx.map((i, pos) => DETALLE_TPL[i](pos === 0 ? lugar : pick(LUGARES), theme.oficio));

  const restantes = bodies.slice(1);
  const parrafos = [`${opener} ${bodies[0]}`];
  if (longitud === 'corto') {
    parrafos.push([...restantes, detalles[0]].join(' ') + ' ' + closer);
  } else if (longitud === 'medio') {
    parrafos.push(restantes.join(' ') + ' ' + detalles[0]);
    parrafos.push(closer);
  } else { // largo
    const mitad = Math.ceil(restantes.length / 2);
    parrafos.push(restantes.slice(0, mitad).join(' '));
    parrafos.push(restantes.slice(mitad).join(' ') + ' ' + detalles[0]);
    parrafos.push(detalles[1]);
    parrafos.push(closer);
  }

  const html = parrafos.filter(Boolean).map((p) => `<p>${p}</p>`).join('\n');
  const nPalabras = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return { html, bIdx, longitud, nPalabras };
}

function nTags() { const r = rng(); return r < 0.15 ? 1 : r < 0.55 ? 2 : r < 0.85 ? 3 : 4; }
function nComentarios() { if (chance(0.5)) return 0; const r = rng(); return r < 0.5 ? 1 : r < 0.8 ? 2 : r < 0.93 ? intBetween(3, 4) : intBetween(5, 6); }

const daysAgo = (d) => { const t = new Date(); t.setDate(t.getDate() - d); return t; };

// Construye un INSERT multi-fila: INSERT INTO t (cols) VALUES ($1,$2,...),(...)
function buildBulkInsert(table, columns, rows, extraSql = '') {
  const values = [];
  const tuples = rows.map((row) => {
    const placeholders = columns.map((_, j) => `$${values.length + j + 1}`);
    values.push(...row);
    return `(${placeholders.join(',')})`;
  });
  return {
    text: `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ${extraSql}`,
    values,
  };
}

// Inserta en bloques de `chunkSize` filas para no armar sentencias gigantes.
async function insertarEnBloques(q, table, columns, rows, chunkSize, extraSql = '') {
  const out = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { text, values } = buildBulkInsert(table, columns, chunk, extraSql);
    const res = await q(text, values);
    out.push(...res.rows);
  }
  return out;
}

// ── Evidencia en .sql: literal INSERT de lo que realmente quedó en Neon ──
const sqlVal = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

function sqlInsertChunk(table, columns, rows, chunkSize = 100) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const tuples = chunk.map((row) => `  (${row.map(sqlVal).join(', ')})`);
    out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${tuples.join(',\n')};`);
  }
  return out.join('\n\n');
}

function construirVolcadoSQL({ dry, start, cantidad, posts, tagRows, comentarios }) {
  const ahora = new Date();
  const fechaArchivo = ahora.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const estadoTxt = dry
    ? 'SIMULACIÓN (--dry-run): este bloque NO llegó a aplicarse, se hizo ROLLBACK.\n--   Se deja como referencia de lo que se HABRÍA insertado.'
    : 'APLICADO: este es el volcado literal de lo que quedó insertado en Neon\n--   (incluye los id_post / id_comentario reales que asignó la BD).';

  const postColumns = [
    'id_categoria', 'titulo', 'slug', 'contenido', 'extracto', 'meta_description',
    'estado', 'fecha_publicacion', 'vistas', 'activo', 'eliminado',
    'fecha_creacion', 'fecha_actualizacion', 'autor_id', 'autor_rol', 'id_post',
  ];
  const postRows = posts.map((p) => [
    p.id_categoria, p.titulo, p.slug, p.contenido, p.extracto, p.meta,
    'publicado', p.fechaPub, p.vistas, true, false,
    p.fechaCre, p.fechaCre, p.autor_id, p.autor_rol, p.id_post,
  ]);
  // id_post va al final de la lista de valores; se reordena la columna
  // explícita para que el INSERT sea legible con el id primero.
  const postColumnsOrdenadas = ['id_post', ...postColumns.slice(0, -1)];
  const postRowsOrdenadas = postRows.map((r) => [r[r.length - 1], ...r.slice(0, -1)]);

  const tagColumns = ['id_post', 'id_blog_etiqueta', 'fecha_creacion'];

  const comColumns = ['id_comentario', 'id_post', 'id_usuario', 'padre_id', 'nivel', 'contenido', 'estado', 'fecha_creacion', 'eliminado'];
  const comRows = comentarios.map((c) => [
    c.id_comentario, c.id_post, c.id_usuario, c.padre_id, c.nivel, c.contenido, c.estado, c.fecha_creacion, false,
  ]);

  const header = `-- =========================================================
-- EVIDENCIA de aplicación — scripts/seedBlogPostsMasivo.mjs
-- Generado: ${ahora.toISOString()}
-- Rango de posts: seed-post-${start} .. seed-post-${start + cantidad - 1}  (${cantidad} posts)
-- Etiquetas insertadas: ${tagRows.length} · Comentarios insertados: ${comentarios.length}
--
-- ${estadoTxt}
--
-- ⚠️ NO ejecutar este archivo directamente: usa ids explícitos que ya
--    existen en Neon (o existieron en la simulación). Es un registro de
--    auditoría, no una migración para volver a aplicar. La fuente real
--    de la lógica de generación sigue siendo seedBlogPostsMasivo.mjs.
-- =========================================================

`;

  const partes = [header];
  if (postRowsOrdenadas.length) partes.push('-- ── blog_posts ──\n' + sqlInsertChunk('blog_posts', postColumnsOrdenadas, postRowsOrdenadas));
  if (tagRows.length) partes.push('-- ── blog_posts_etiquetas ──\n' + sqlInsertChunk('blog_posts_etiquetas', tagColumns, tagRows));
  if (comRows.length) partes.push('-- ── blog_comentarios ──\n' + sqlInsertChunk('blog_comentarios', comColumns, comRows));

  return { texto: partes.join('\n\n'), fechaArchivo };
}

function escribirEvidencia(datos) {
  const { texto, fechaArchivo } = construirVolcadoSQL(datos);
  mkdirSync(EVIDENCIA_DIR, { recursive: true });
  const sufijo = datos.dry ? '_DRYRUN' : '';
  const nombre = `evidencia_seed_blog_masivo_${fechaArchivo}_seed-post-${datos.start}-a-${datos.start + datos.cantidad - 1}${sufijo}.sql`;
  const ruta = join(EVIDENCIA_DIR, nombre);
  writeFileSync(ruta, texto, 'utf8');
  return ruta;
}

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000, statement_timeout: 900000,
    application_name: 'nub_seed_blog_masivo',
  });
  const c = await pool.connect();
  const q = (sql, p = []) => c.query(sql, p);
  try {
    // Guarda de seguridad: evita duplicar si el script ya se corrió antes
    const existentesRes = await q("SELECT COUNT(*)::int n FROM blog_posts WHERE slug LIKE 'seed-post-%'");
    const existentes = existentesRes.rows[0].n;
    if (existentes >= TOPE_SEGURIDAD && !FORCE) {
      console.log(`✋ Ya hay ${existentes} posts 'seed-post-%' (>= ${TOPE_SEGURIDAD}).`);
      console.log('   Parece que este script ya corrió antes. Usa --force si de verdad quieres continuar.');
      await pool.end();
      return;
    }

    await q('BEGIN');

    // 1) Mapa slug -> id_blog_etiqueta (las 12 curadas) — igual que el script original
    const et = (await q('SELECT id_blog_etiqueta, slug FROM blog_etiquetas WHERE activo = true')).rows;
    const etId = Object.fromEntries(et.map((r) => [r.slug, r.id_blog_etiqueta]));
    for (const t of THEMES) {
      for (const s of [t.primary, ...t.sec]) if (!etId[s]) throw new Error(`Falta etiqueta curada: ${s}`);
    }

    // 2) Autores y comentaristas — se leen de la BD en vez de hardcodear ids,
    //    para no depender de que el seed de usuarios no haya cambiado.
    const adminRows = (await q("SELECT id_usuario FROM usuarios WHERE correo = 'admin_seed@nub.mx'")).rows;
    const artistaRows = (await q("SELECT id_usuario FROM usuarios WHERE correo LIKE 'artista_seed_%@nub.mx' ORDER BY id_usuario")).rows;
    const clienteRows = (await q("SELECT id_usuario FROM usuarios WHERE correo LIKE 'cliente_seed_%@nub.mx' ORDER BY id_usuario")).rows;
    if (!adminRows.length || !artistaRows.length || !clienteRows.length) {
      throw new Error('No se encontraron usuarios seed (admin/artista/cliente). ¿Ya se corrió el seed principal?');
    }
    const AUTORES = [{ id: adminRows[0].id_usuario, rol: 'admin' }, ...artistaRows.map((r) => ({ id: r.id_usuario, rol: 'artista' }))];
    const CLIENTES = clienteRows.map((r) => r.id_usuario);

    // 3) Punto de partida de la numeración: sigue después del último 'seed-post-N'
    const maxRow = (await q(
      "SELECT COALESCE(MAX((regexp_replace(slug,'[^0-9]','','g'))::int), 0) AS max_n FROM blog_posts WHERE slug ~ '^seed-post-[0-9]+$'"
    )).rows[0];
    const START = maxRow.max_n + 1;
    console.log(`· Posts 'seed-post-%' existentes: ${existentes}. Continuando numeración desde seed-post-${START}.`);
    console.log(`· Generando ${N_NUEVOS} posts nuevos...`);

    // 4) Generar contenido en memoria (rápido, puro JS) con dedupe de título/contenido.
    //    OJO: se precarga titulosUsados con los títulos YA existentes en la BD
    //    (incluidos los del seedBlogPosts.mjs original) — el banco de subjects
    //    de este script reutiliza a propósito parte del vocabulario base del
    //    original, así que sin este precargado podrían generarse títulos
    //    idénticos a posts que ya existen (detectado en un --dry-run previo).
    const tituloRows = (await q("SELECT titulo FROM blog_posts WHERE slug LIKE 'seed-post-%'")).rows;
    const titulosUsados = new Set(tituloRows.map((r) => r.titulo));
    console.log(`· Precargados ${titulosUsados.size} títulos existentes para evitar duplicados contra el seed original.`);

    const plan = planTemas(N_NUEVOS);
    const huellasUsadas = new Set();
    const posts = [];

    for (let i = 0; i < plan.length; i++) {
      const theme = plan[i];
      const n = START + i;
      const slug = `seed-post-${n}`;

      let titulo, contenido, subject, huella, longitud, nPalabras;
      let intentos = 0;
      do {
        subject = generarSubject(theme);
        titulo = pick(TITLE_TEMPLATES)(subject);
        const gen = generarContenido(theme, pick(LUGARES));
        contenido = gen.html;
        longitud = gen.longitud;
        nPalabras = gen.nPalabras;
        huella = `${theme.key}|${subject}|${gen.bIdx.join(',')}|${contenido.slice(-40)}`;
        intentos++;
      } while ((titulosUsados.has(titulo) || huellasUsadas.has(huella)) && intentos < 30);
      titulosUsados.add(titulo);
      huellasUsadas.add(huella);

      const extracto = `${cap(subject)} — apuntes sobre ${theme.key} de la Huasteca Hidalguense.`;
      const autor = chance(0.12) ? AUTORES[0] : pick(AUTORES.slice(1));
      const dPub = intBetween(3, 360);
      const fechaPub = daysAgo(dPub);
      const fechaCre = daysAgo(dPub + intBetween(0, 3));
      const vistas = Math.floor(Math.pow(rng(), 2) * 500);
      const meta = `${cap(theme.key)} y ${theme.primary} en la Huasteca: ${subject}.`.slice(0, 160);

      // Etiquetas: siempre la técnica principal + (nTags-1) secundarias distintas
      const nt = nTags();
      const tagsSet = new Set([theme.primary]);
      const secShuffled = shuffle(theme.sec);
      let k = 0;
      while (tagsSet.size < nt && k < secShuffled.length) tagsSet.add(secShuffled[k++]);

      posts.push({
        slug, titulo, contenido, extracto, meta, fechaPub, fechaCre, vistas,
        id_categoria: theme.id_categoria, autor_id: autor.id, autor_rol: autor.rol,
        tags: [...tagsSet], nComentarios: nComentarios(), longitud, nPalabras,
      });
    }
    console.log(`· ${posts.length} posts generados y verificados como únicos (títulos y contenido).`);
    const porLongitud = {};
    for (const p of posts) porLongitud[p.longitud] = (porLongitud[p.longitud] || 0) + 1;
    const palabras = posts.map((p) => p.nPalabras);
    console.log('· Distribución de longitud:', porLongitud,
      `| palabras por post: min ${Math.min(...palabras)}, media ${Math.round(palabras.reduce((a, b) => a + b, 0) / palabras.length)}, max ${Math.max(...palabras)}`);

    // 5) Insertar posts en bloque (multi-row), RETURNING slug + id_post para
    //    mapear de vuelta sin depender de que el orden de retorno coincida
    //    con el orden de entrada (se hace el match explícito por slug).
    const postColumns = [
      'id_categoria', 'titulo', 'slug', 'contenido', 'extracto', 'meta_description',
      'estado', 'fecha_publicacion', 'vistas', 'activo', 'eliminado',
      'fecha_creacion', 'fecha_actualizacion', 'autor_id', 'autor_rol',
    ];
    const postRows = posts.map((p) => [
      p.id_categoria, p.titulo, p.slug, p.contenido, p.extracto, p.meta,
      'publicado', p.fechaPub, p.vistas, true, false,
      p.fechaCre, p.fechaCre, p.autor_id, p.autor_rol,
    ]);
    const insertados = await insertarEnBloques(q, 'blog_posts', postColumns, postRows, 300, 'RETURNING id_post, slug');
    const idPorSlug = Object.fromEntries(insertados.map((r) => [r.slug, r.id_post]));
    for (const p of posts) p.id_post = idPorSlug[p.slug]; // para el volcado de evidencia
    console.log(`· ${insertados.length} posts insertados.`);

    // 6) Insertar etiquetas en bloque (sin auto-referencia, se puede hacer todo junto)
    const tagRows = [];
    for (const p of posts) {
      const idPost = idPorSlug[p.slug];
      for (const s of p.tags) tagRows.push([idPost, etId[s], p.fechaPub]);
    }
    await insertarEnBloques(q, 'blog_posts_etiquetas', ['id_post', 'id_blog_etiqueta', 'fecha_creacion'], tagRows, 500);
    console.log(`· ${tagRows.length} filas de etiquetas insertadas.`);

    // 7) Comentarios: uno por uno por post (las respuestas anidadas necesitan
    //    el id del comentario padre, que solo existe tras insertarlo).
    const comentariosInsertados = []; // para el volcado de evidencia
    let nComRows = 0;
    for (const p of posts) {
      const idPost = idPorSlug[p.slug];
      const idsComentarios = [];
      for (let j = 0; j < p.nComentarios; j++) {
        const rEstado = rng();
        const estado = rEstado < 0.85 ? 'aprobado' : rEstado < 0.95 ? 'pendiente' : 'rechazado';
        const esRespuesta = idsComentarios.length > 0 && chance(0.15);
        const padre = esRespuesta ? pick(idsComentarios) : null;
        const nivel = esRespuesta ? 1 : 0;
        const contenidoCom = esRespuesta ? pick(RESPUESTAS) : pick(COMENTARIOS);
        const dPub = Math.round((Date.now() - p.fechaPub.getTime()) / 86400000);
        const fComent = daysAgo(Math.max(1, dPub - intBetween(0, Math.max(1, dPub))));
        const idUsuario = pick(CLIENTES);
        const insC = await q(`
          INSERT INTO blog_comentarios (id_post, id_usuario, padre_id, nivel, contenido, estado, fecha_creacion, eliminado)
          VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id_comentario`,
          [idPost, idUsuario, padre, nivel, contenidoCom, estado, fComent]);
        const idComentario = insC.rows[0].id_comentario;
        idsComentarios.push(idComentario);
        comentariosInsertados.push({
          id_comentario: idComentario, id_post: idPost, id_usuario: idUsuario,
          padre_id: padre, nivel, contenido: contenidoCom, estado, fecha_creacion: fComent,
        });
        nComRows++;
      }
    }
    console.log(`· ${nComRows} comentarios insertados.`);

    // 8) Verificación (sobre TODOS los 'seed-post-%', antiguos + nuevos)
    console.log(`\n✓ Total generado en esta corrida: ${posts.length} posts, ${tagRows.length} etiquetas, ${nComRows} comentarios.`);
    const totalFinal = (await q("SELECT COUNT(*)::int n FROM blog_posts WHERE slug LIKE 'seed-post-%'")).rows[0].n;
    console.log(`✓ Total de posts 'seed-post-%' tras esta corrida: ${totalFinal}`);

    const dist = (await q(`SELECT be.slug, COUNT(*)::int n FROM blog_posts_etiquetas bpe
      JOIN blog_etiquetas be ON be.id_blog_etiqueta=bpe.id_blog_etiqueta
      JOIN blog_posts bp ON bp.id_post=bpe.id_post WHERE bp.slug LIKE 'seed-post-%'
      GROUP BY be.slug ORDER BY n DESC`)).rows;
    console.log('\n— Distribución de etiquetas (acumulada) —'); console.table(dist);

    const porCategoria = (await q(`SELECT c.nombre, COUNT(*)::int n FROM blog_posts bp
      JOIN categorias c ON c.id_categoria = bp.id_categoria
      WHERE bp.slug LIKE 'seed-post-%' GROUP BY c.nombre ORDER BY n DESC`)).rows;
    console.log('\n— Posts por categoría (acumulada) —'); console.table(porCategoria);

    const comDist = (await q(`SELECT n_com, COUNT(*)::int posts FROM (
        SELECT bp.id_post, COUNT(bc.*)::int n_com FROM blog_posts bp
        LEFT JOIN blog_comentarios bc ON bc.id_post=bp.id_post
        WHERE bp.slug LIKE 'seed-post-%' GROUP BY bp.id_post) s
      GROUP BY n_com ORDER BY n_com`)).rows;
    console.log('\n— Posts por # de comentarios (acumulada, 0 = sin comentarios) —'); console.table(comDist);

    const titulosDuplicados = (await q(`SELECT titulo, COUNT(*)::int n FROM blog_posts
      WHERE slug LIKE 'seed-post-%' GROUP BY titulo HAVING COUNT(*) > 1 LIMIT 10`)).rows;
    console.log(`\n— Títulos duplicados detectados (debería ser 0 o casi 0): ${titulosDuplicados.length} —`);
    if (titulosDuplicados.length) console.table(titulosDuplicados);

    if (DRY) { await q('ROLLBACK'); console.log('\n↩ DRY-RUN: ROLLBACK, la BD quedó intacta.'); }
    else { await q('COMMIT'); console.log('\n✓✓ COMMIT — posts guardados en Neon.'); }

    // 9) Evidencia .sql — volcado literal de lo que quedó (o se habría
    //    quedado, en dry-run) en Neon. No reemplaza este .mjs: es la
    //    prueba concreta de qué terminó exactamente en la base de datos.
    if (!SIN_EVIDENCIA) {
      const ruta = escribirEvidencia({
        dry: DRY, start: START, cantidad: posts.length, posts, tagRows, comentarios: comentariosInsertados,
      });
      console.log(`\n📄 Evidencia escrita en: ${ruta}`);
    }
  } catch (e) {
    await q('ROLLBACK');
    console.error('\n✗ FALLÓ, ROLLBACK. Error:', e.message);
    if (e.detail) console.error('  detalle:', e.detail);
    process.exitCode = 1;
  } finally { c.release(); await pool.end(); }
}
main();
