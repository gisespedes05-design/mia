// Carga datos de demostración: los mismos ocho negocios y ocho cuentas que
// trae mia.html, para poder comparar ambas versiones lado a lado.
// Uso:  npm run seed        (solo si la base está vacía)
//       npm run reset       (borra todo y vuelve a cargar la demo)
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { db, ejecutar, uno, DIR_SUBIDAS } from './db.js';
import { cifrarContrasena } from './auth.js';
import { generarSlug } from './negocios.js';

const reset = process.argv.includes('--reset');

const TABLAS = [
  'bitacora', 'solicitudes', 'articulos', 'favoritos', 'resenas',
  'publicacion_comentarios', 'publicaciones', 'productos', 'fotos', 'negocios', 'usuarios',
];

if (reset) {
  for (const t of TABLAS) db.exec(`DELETE FROM ${t}`);
  db.exec(`DELETE FROM sqlite_sequence`);
  console.log('Base reiniciada.');
} else if (uno('SELECT id FROM usuarios LIMIT 1')) {
  console.log('Ya hay datos: usa "npm run reset" si quieres reemplazarlos.');
  process.exit(0);
}

/* ------------------------------------------------------------ imágenes --- */
// Fotos de muestra: un degradado con la inicial del negocio, para que la
// demostración se vea completa sin depender de fotos reales.
const TONOS = [
  ['#B35A8A', '#6B3459'], ['#7880AE', '#454B72'], ['#523F77', '#2E2247'],
  ['#4A6E96', '#2A3F57'], ['#0B7A5E', '#053F30'], ['#B8860B', '#5C4406'],
];

function crearFotoDemo(nombreArchivo, letra, indiceTono) {
  const [a, b] = TONOS[indiceTono % TONOS.length];
  const ruta = join(DIR_SUBIDAS, nombreArchivo);
  if (existsSync(ruta)) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
    </linearGradient></defs>
    <rect width="640" height="400" fill="url(#g)"/>
    <text x="320" y="230" font-family="system-ui,sans-serif" font-size="120" font-weight="800"
      fill="#ffffff" fill-opacity=".92" text-anchor="middle">${letra}</text>
  </svg>`;
  writeFileSync(ruta, svg);
}

let contadorFoto = 0;
function fotosPara(negocioId, nombre, cantidad) {
  const letra = nombre.trim()[0]?.toUpperCase() || 'M';
  for (let i = 0; i < cantidad; i++) {
    const archivo = `demo-${negocioId}-${i}.svg`;
    crearFotoDemo(archivo, letra, contadorFoto++);
    ejecutar(`INSERT INTO fotos (negocio_id, archivo, orden) VALUES ($n, $a, $i)`, {
      n: negocioId, a: archivo, i,
    });
  }
}

/* -------------------------------------------------------------- fechas --- */
const hoy = new Date();
const enMeses = (m) => {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() + m, hoy.getDate());
  return d.toISOString().slice(0, 10);
};
const haceDias = (d) => new Date(Date.now() - d * 864e5).toISOString();
const haceDiasFecha = (d) => haceDias(d).slice(0, 10);

/* ------------------------------------------------------------- usuarios -- */
function crearUsuaria(nombre, correo, clave, rol) {
  const hash = cifrarContrasena(clave);
  const r = ejecutar(
    `INSERT INTO usuarios (nombre, correo, hash, rol) VALUES ($nombre, $correo, $hash, $rol)`,
    { nombre, correo, hash, rol }
  );
  return Number(r.lastInsertRowid);
}

const idAdmin = crearUsuaria('Equipo MÍA', 'admin@mia.mx', 'mia2026', 'admin');
const idLucia = crearUsuaria('Lucía Márquez', 'lucia@mia.mx', 'demo1234', 'negocio');
const idRosario = crearUsuaria('Rosario Jiménez', 'rosario@mia.mx', 'demo1234', 'negocio');
const idAnaSofia = crearUsuaria('Ana Sofía Rentería', 'anasofia@mia.mx', 'demo1234', 'negocio');
const idDaniela = crearUsuaria('Daniela Ortiz', 'daniela@mia.mx', 'demo1234', 'usuario');
const idCarmen = crearUsuaria('Carmen Solís', 'carmen@mia.mx', 'demo1234', 'usuario');
const idBeatriz = crearUsuaria('Beatriz Fuentes', 'beatriz@mia.mx', 'demo1234', 'negocio');
const idPaulina = crearUsuaria('Paulina Cordero', 'paulina@mia.mx', 'demo1234', 'negocio');

console.log('Usuarias creadas.');

/* ------------------------------------------------------------- negocios -- */
function crearNegocio(o) {
  const slug = generarSlug(o.nombre);
  const r = ejecutar(
    `INSERT INTO negocios (
       propietaria_id, nombre, slug, categoria, categoria2, sub, descripcion, ciudad, direccion,
       telefono, redes, plan, plan_vence, pago_confirmado, estado, verificado, vistas
     ) VALUES (
       $duena, $nombre, $slug, $categoria, $categoria2, $sub, $descripcion, $ciudad, $direccion,
       $telefono, $redes, $plan, $vence, $pago, $estado, $verificado, $vistas
     )`,
    {
      duena: o.duena, nombre: o.nombre, slug, categoria: o.categoria, categoria2: o.categoria2 || null,
      sub: JSON.stringify(o.sub), descripcion: o.descripcion, ciudad: o.ciudad,
      direccion: o.direccion || '', telefono: o.telefono || '',
      redes: JSON.stringify(o.redes || {}), plan: o.plan, vence: o.vence || null,
      pago: o.pago === false ? 0 : 1, estado: o.estado, verificado: o.verificado ? 1 : 0,
      vistas: o.vistas || 0,
    }
  );
  return Number(r.lastInsertRowid);
}

function crearProducto(negocioId, nombre, descripcion, precio, destacado, orden) {
  ejecutar(
    `INSERT INTO productos (negocio_id, nombre, descripcion, precio, destacado, orden)
     VALUES ($n, $nombre, $desc, $precio, $destacado, $orden)`,
    { n: negocioId, nombre, desc: descripcion, precio, destacado: destacado ? 1 : 0, orden }
  );
}

function crearPublicacion(negocioId, titulo, texto, diasAntes, destacada) {
  ejecutar(
    `INSERT INTO publicaciones (negocio_id, titulo, texto, destacada, creado_en)
     VALUES ($n, $titulo, $texto, $destacada, $fecha)`,
    { n: negocioId, titulo, texto, destacada: destacada ? 1 : 0, fecha: haceDias(diasAntes) }
  );
}

const idGlow = crearNegocio({
  duena: idLucia, nombre: 'Glow Studio', categoria: 'belleza',
  sub: ['Maquillaje', 'Pestañas', 'Cejas'], ciudad: 'Guadalajara',
  descripcion: 'Estudio de belleza especializado en maquillaje social y de novia, extensiones de pestañas pelo a pelo y diseño de cejas con henna. Trabajamos con cita y atendemos a domicilio para bodas y XV años en toda la zona metropolitana. Nuestro equipo se certifica cada año y usamos producto profesional hipoalergénico.',
  direccion: 'Av. Pablo Neruda 2222, Providencia', telefono: '33 1188 4400',
  redes: { instagram: '@glowstudio.gdl', facebook: 'glowstudiogdl', tiktok: '@glowstudio', whatsapp: '3311884400' },
  plan: 'membresia', vence: enMeses(6), estado: 'publicado', verificado: true, vistas: 1420,
});
fotosPara(idGlow, 'Glow Studio', 4);
crearProducto(idGlow, 'Maquillaje de novia', 'Prueba previa incluida.', 3500, true, 0);
crearProducto(idGlow, 'Extensiones pelo a pelo', 'Duración de 4 semanas.', 1200, true, 1);
crearProducto(idGlow, 'Diseño de cejas con henna', 'Incluye depilación.', 450, false, 2);
crearPublicacion(idGlow, 'Agenda abierta para bodas de diciembre',
  'Ya puedes apartar tu fecha para la temporada de bodas. Este año incluimos prueba de maquillaje sin costo para novias que reserven antes de octubre.', 4, true);
crearPublicacion(idGlow, 'Nuevo servicio: laminado de cejas',
  'Llegó el laminado de cejas a Glow Studio. Es un tratamiento que alinea y fija el vello por seis a ocho semanas.', 18, false);

const idDulce = crearNegocio({
  duena: idRosario, nombre: 'Dulce Raíz', categoria: 'reposteria', categoria2: 'mascotas',
  sub: ['Pasteles', 'Cupcakes', 'Chocolatería', 'Alimentos'], ciudad: 'Ciudad de México',
  descripcion: 'Repostería artesanal sin conservadores. Pasteles de temporada, mesas de postres para eventos y chocolatería fina con cacao mexicano de Tabasco y Chiapas. También horneamos galletas y pasteles para perros con ingredientes seguros para ellos. Hacemos opciones sin gluten y sin azúcar refinada con dos días de anticipación.',
  direccion: 'Colonia Roma Norte', telefono: '55 2244 8890',
  redes: { instagram: '@dulceraiz', tiktok: '@dulceraiz', whatsapp: '5522448890' },
  plan: 'suscripcion', vence: enMeses(3), estado: 'publicado', vistas: 860,
});
fotosPara(idDulce, 'Dulce Raíz', 3);
crearProducto(idDulce, 'Pastel de temporada 15 porciones', 'Sabores del mes.', 850, true, 0);
crearProducto(idDulce, 'Mesa de postres para 50', 'Siete variedades y montaje.', 6500, false, 1);
crearPublicacion(idDulce, 'Sabores de temporada: guayaba y cardamomo',
  'Durante noviembre y diciembre trabajamos con guayaba de Calvillo. El pastel lleva bizcocho de vainilla, relleno de guayaba y crema de cardamomo.', 9, false);

const idBloom = crearNegocio({
  duena: idAnaSofia, nombre: 'Bloom Eventos', categoria: 'eventos',
  sub: ['Decoración', 'Florería', 'Coctelería', 'Fotografía'], ciudad: 'Querétaro',
  descripcion: 'Diseñamos y producimos bodas, XV años y eventos de empresa. Cubrimos decoración floral, mobiliario, barra de coctelería y cobertura fotográfica con un solo contacto, para que no tengas que coordinar cinco proveedores distintos.',
  direccion: 'Centro Histórico', telefono: '442 331 7788',
  redes: { instagram: '@bloomeventos.qro', facebook: 'bloomeventos', whatsapp: '4423317788' },
  plan: 'crece', vence: enMeses(8), estado: 'publicado', verificado: true, vistas: 1105,
});
fotosPara(idBloom, 'Bloom Eventos', 4);
crearProducto(idBloom, 'Paquete boda completo', 'Decoración, flores, barra y foto.', 78000, true, 0);
crearProducto(idBloom, 'Barra de coctelería 100 personas', 'Cuatro cocteles de autor.', 18500, true, 1);
crearPublicacion(idBloom, 'Cómo elegir tu paleta de color',
  'La paleta manda sobre flores, mantelería y papelería. Nuestro consejo: elige tres colores, uno dominante y dos de acento, y llévalos a todo el evento.', 2, true);

const idUnas = crearNegocio({
  duena: idBeatriz, nombre: 'Uñas de Azúcar', categoria: 'belleza',
  sub: ['Uñas'], ciudad: 'Puebla',
  descripcion: 'Salón de uñas especializado en acrílico, gel y nail art a mano alzada. Atendemos con cita en un espacio pequeño y tranquilo.',
  direccion: 'La Paz', telefono: '222 411 3355',
  redes: { instagram: '@unasdeazucar', facebook: 'unasdeazucar', whatsapp: '2224113355' },
  plan: 'gratuito', estado: 'publicado', vistas: 240,
});
fotosPara(idUnas, 'Uñas de Azúcar', 3);
crearProducto(idUnas, 'Acrílico con diseño', 'Dos horas.', 550, false, 0);
crearPublicacion(idUnas, 'Nuevos horarios de sábado',
  'A partir de este mes abrimos sábados de 9 a 3 con cita previa.', 6, false);
crearPublicacion(idUnas, 'Diseños de temporada',
  'Ya tenemos catálogo de diseños navideños para reservar tu cita de diciembre.', 12, false);
crearPublicacion(idUnas, 'Nuevos colores de esmalte',
  'Llegaron seis colores nuevos, todos de larga duración.', 20, false);
crearPublicacion(idUnas, 'Promoción de apertura',
  'Con el plan Gratuito se muestran las 3 publicaciones más recientes. Esta ya no entra, pero no se borró: al subir de plan o borrar otra vuelve a aparecer.', 30, false);

const idCasa = crearNegocio({
  duena: idPaulina, nombre: 'Casa Cempasúchil', categoria: 'artesania',
  sub: ['Bordado', 'Tejido'], ciudad: 'Oaxaca de Juárez',
  descripcion: 'Taller de textiles bordados a mano por doce artesanas de los Valles Centrales. Blusas, rebozos y piezas de decoración con tintes naturales.',
  direccion: 'Jalatlaco', telefono: '951 220 4477',
  redes: { instagram: '@casacempasuchil', whatsapp: '9512204477' },
  plan: 'suscripcion', vence: enMeses(-1), estado: 'publicado', vistas: 390,
});
fotosPara(idCasa, 'Casa Cempasúchil', 3);
crearProducto(idCasa, 'Blusa bordada', 'Tres semanas de trabajo.', 1450, true, 0);
crearPublicacion(idCasa, 'Taller abierto en noviembre', 'Recibimos visitas al taller con cita.', 20, false);

const idContadora = crearNegocio({
  duena: idRosario, nombre: 'Contadora Ríos', categoria: 'profesionales',
  sub: ['Contadoras'], ciudad: 'Monterrey',
  descripcion: 'Contabilidad y cumplimiento fiscal para negocios pequeños dirigidos por mujeres. Damos de alta tu RFC, te llevamos la declaración mensual y te explicamos en español, no en tecnicismos.',
  direccion: 'San Pedro Garza García', telefono: '81 2277 9911',
  redes: { instagram: '@contadorarios', whatsapp: '8122779911' },
  plan: 'suscripcion', vence: enMeses(5), estado: 'publicado', vistas: 512,
});
fotosPara(idContadora, 'Contadora Ríos', 2);
crearProducto(idContadora, 'Contabilidad mensual', 'Persona física con actividad empresarial.', 1800, true, 0);
crearPublicacion(idContadora, 'Cierre anual: lo que debes juntar',
  'Antes de enero reúne tus constancias, tus facturas de gastos y tus estados de cuenta.', 11, false);

const idPan = crearNegocio({
  duena: idBeatriz, nombre: 'Pan de Nube', categoria: 'reposteria',
  sub: ['Galletas', 'Postres'], ciudad: 'Mérida',
  descripcion: 'Galletas decoradas y postres individuales para regalo corporativo y fiestas.',
  direccion: 'García Ginerés', telefono: '999 330 2288',
  plan: 'gratuito', estado: 'pendiente',
});
fotosPara(idPan, 'Pan de Nube', 1);

const idYoga = crearNegocio({
  duena: idPaulina, nombre: 'Estudio Raíz Yoga', categoria: 'bienestar',
  sub: ['Yoga', 'Terapia'], ciudad: 'Cuernavaca',
  descripcion: 'Clases de hatha y vinyasa en grupos pequeños, con enfoque en mujeres que empiezan de cero.',
  direccion: 'Tlaltenango', telefono: '777 190 6600',
  plan: 'gratuito', estado: 'pendiente',
});

console.log('Negocios creados.');

/* -------------------------------------------------------------- reseñas -- */
function crearResena(negocioId, usuarioId, cal, comentario, respuesta, diasAntes, estado = 'publicada') {
  ejecutar(
    `INSERT INTO resenas (negocio_id, usuario_id, calificacion, comentario, respuesta, estado, creado_en)
     VALUES ($n, $u, $cal, $c, $r, $estado, $fecha)`,
    { n: negocioId, u: usuarioId, cal, c: comentario, r: respuesta || '', estado, fecha: haceDias(diasAntes) }
  );
}

crearResena(idGlow, idDaniela, 5,
  'Me maquillaron para mi boda y duró impecable las 14 horas. Hicieron prueba antes y ajustaron todo lo que pedí.',
  '¡Gracias Daniela! Fue un gusto ser parte de tu día.', 30);
crearResena(idGlow, idCarmen, 4, 'Muy buen trabajo en pestañas. El lugar es pequeño pero muy limpio.', '', 12);
crearResena(idBloom, idDaniela, 5,
  'Coordinaron toda mi boda y no tuve que preocuparme por nada. La barra de coctelería fue lo que más gustó.',
  'Gracias por confiarnos un día tan importante.', 45);
crearResena(idDulce, idCarmen, 5, 'El pastel de guayaba con cardamomo estaba increíble y llegó puntual.', '', 8);
crearResena(idContadora, idDaniela, 5, 'Por fin alguien que me explica mis impuestos sin hacerme sentir tonta.', '', 22);
crearResena(idUnas, idCarmen, 4, 'Buen diseño y muy detallista. Solo tarda un poco más de lo que dice.', '', 15);
// Cada clienta solo puede reseñar un negocio una vez, así que la reseña de
// spam va en un negocio que Daniela no haya reseñado ya con una opinión real.
crearResena(idCasa, idDaniela, 1, 'SIGUEME PARA SEGUIDORES GRATIS WWW.EJEMPLO', '', 2, 'oculta');

/* ------------------------------------------------------------ favoritos -- */
ejecutar(`INSERT INTO favoritos (usuario_id, negocio_id) VALUES ($u, $n)`, { u: idDaniela, n: idGlow });
ejecutar(`INSERT INTO favoritos (usuario_id, negocio_id) VALUES ($u, $n)`, { u: idDaniela, n: idBloom });
ejecutar(`INSERT INTO favoritos (usuario_id, negocio_id) VALUES ($u, $n)`, { u: idCarmen, n: idDulce });

console.log('Reseñas y favoritos creados.');

/* ------------------------------------------------------------- artículos - */
function crearArticulo(slug, titulo, resumen, cuerpo, diasAntes) {
  ejecutar(
    `INSERT INTO articulos (slug, titulo, resumen, cuerpo, autora, publicado, creado_en)
     VALUES ($slug, $titulo, $resumen, $cuerpo, 'Equipo MÍA', 1, $fecha)`,
    { slug, titulo, resumen, cuerpo, fecha: haceDias(diasAntes) }
  );
}

crearArticulo('como-cobrar-lo-que-vales', 'Cómo cobrar lo que vales sin perder clientas',
  'Poner precio es la decisión que más miedo da y la que más define si tu negocio aguanta.',
  'La mayoría de las emprendedoras que llegan a MÍA cobran por debajo de su costo real. No por falta de talento, sino porque nadie les enseñó a calcularlo.\n\nEmpieza por sumar todo lo que gastas para entregar una pieza: material, transporte, empaque y la parte de la renta y la luz que te corresponde. A eso súmale tu hora de trabajo. Sí, tu hora vale, aunque trabajes desde tu casa.\n\nEse número es tu piso. Nunca vendas por debajo de ahí. Encima de ese piso pones tu margen, que es lo que te permite crecer, comprar más material y no depender de un solo cliente.\n\nCuando subas precios, avisa con tiempo y explica el porqué. Las clientas que valoran tu trabajo se quedan. Las que solo buscaban lo más barato nunca fueron tu cliente.',
  5);

crearArticulo('fotos-con-celular', 'Fotos de producto con tu celular: guía rápida',
  'No necesitas cámara profesional. Necesitas luz de ventana y un fondo limpio.',
  'La primera foto de tu perfil decide si alguien entra o pasa de largo. Y se puede tomar con el celular que ya tienes.\n\nBusca una ventana y coloca tu producto a un costado, nunca de frente al sol. La luz lateral marca la textura. Apaga la luz del techo: mezclar luz cálida con luz de día ensucia los colores.\n\nUsa un fondo liso. Una cartulina blanca o una mesa de madera clara funcionan mejor que cualquier decorado. Limpia el lente antes de disparar, se ensucia más de lo que crees.\n\nToma la foto desde arriba o a la altura del producto, nunca desde abajo. Y no uses el zoom: acércate tú.',
  16);

crearArticulo('que-es-una-comunidad', 'MÍA no es un marketplace, y esa es la idea',
  'Aquí no vendemos por ti. Te ayudamos a que te encuentren y a que no camines sola.',
  'Un marketplace se queda con una comisión de cada venta y decide quién aparece según quién paga más publicidad. MÍA funciona distinto.\n\nAquí tu clienta te contacta directo: por teléfono, por WhatsApp o llegando a tu local. No pasamos por en medio ni cobramos comisión sobre lo que vendes.\n\nLo que hacemos es que te encuentren: un directorio ordenado por categorías, un mapa, y campañas donde presentamos negocios de la comunidad. Y hacemos algo que un marketplace no hace: te ponemos en contacto con otras que están en tu misma etapa.',
  28);

console.log('Artículos creados.');
console.log('\nListo. Cuentas de prueba:');
console.log('  admin@mia.mx      / mia2026    (organización MÍA)');
console.log('  lucia@mia.mx      / demo1234   (negocio, Membresía)');
console.log('  beatriz@mia.mx    / demo1234   (negocio, Gratuito)');
console.log('  daniela@mia.mx    / demo1234   (clienta)');
