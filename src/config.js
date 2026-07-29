// Configuración central de MÍA: roles, planes y catálogos.
// Esta es la única fuente de verdad de precios y límites: si cambia un plan,
// se cambia aquí y el resto del sistema lo respeta.

export const ROLES = {
  ADMIN: 'admin',      // La organización MÍA
  NEGOCIO: 'negocio',  // Dueña de uno o varios negocios
  USUARIO: 'usuario',  // Clienta registrada: reseñas y favoritos
};

export const ESTADOS_NEGOCIO = {
  BORRADOR: 'borrador',      // La dueña lo está llenando, nadie más lo ve
  PENDIENTE: 'pendiente',    // Enviado a revisión de MÍA
  PUBLICADO: 'publicado',    // Visible en el directorio
  RECHAZADO: 'rechazado',    // MÍA pidió cambios
  SUSPENDIDO: 'suspendido',  // MÍA detuvo el perfil
};

// Un negocio sólo aparece en el directorio público en este estado.
export const ESTADO_VISIBLE = ESTADOS_NEGOCIO.PUBLICADO;

// Una empresa pertenece a una categoría principal y hasta cinco subcategorías.
export const MAX_SUBCATEGORIAS = 5;

/**
 * Planes de MÍA.
 *
 * `limites` define cuánto puede cargar un negocio; `permisos`, qué funciones
 * puede usar. Si la membresía vence o el pago no está confirmado, el negocio
 * opera con las reglas del plan gratuito sin perder nada de lo capturado.
 */
export const PLANES = {
  gratuito: {
    id: 'gratuito',
    nombre: 'Gratuito',
    etiqueta: '$0',
    precioMensual: 0,
    peso: 0,
    resumen: 'Para que tu negocio aparezca en el directorio desde hoy.',
    limites: { subcategorias: 5, publicaciones: 1, fotos: 0, caracteresDescripcion: 400 },
    permisos: {
      logo: true, contacto: true, redes: false, mapa: false, productosDestacados: false,
      verificado: false, prioridad: false, publicacionesDestacadas: false,
      estadisticas: false, campanas: false, responder: false, acompanamiento: false,
    },
    incluye: [
      'Perfil básico', 'Logo', 'Una publicación', 'Datos de contacto',
      'Categoría principal', 'Hasta cinco subcategorías',
    ],
    excluye: ['No aparece en el mapa'],
  },

  suscripcion: {
    id: 'suscripcion',
    nombre: 'Suscripción',
    etiqueta: '$199 MXN al mes',
    precioMensual: 199,
    peso: 1,
    resumen: 'Para negocios que ya venden y quieren que las encuentren.',
    limites: { subcategorias: 5, publicaciones: Infinity, fotos: 12, caracteresDescripcion: 2000 },
    permisos: {
      logo: true, contacto: true, redes: true, mapa: true, productosDestacados: true,
      verificado: false, prioridad: false, publicacionesDestacadas: false,
      estadisticas: false, campanas: false, responder: true, acompanamiento: false,
    },
    incluye: [
      'Todo lo del plan Gratuito', 'Fotografías', 'Publicaciones ilimitadas',
      'Redes sociales', 'Descripción ampliada', 'Aparición en el mapa',
      'Mejor posicionamiento', 'Productos destacados',
    ],
    excluye: [],
  },

  membresia: {
    id: 'membresia',
    nombre: 'Membresía',
    etiqueta: '$599 MXN al mes',
    precioMensual: 599,
    peso: 2,
    resumen: 'Para negocios que quieren liderar su categoría dentro de MÍA.',
    limites: { subcategorias: 5, publicaciones: Infinity, fotos: 30, caracteresDescripcion: 4000 },
    permisos: {
      logo: true, contacto: true, redes: true, mapa: true, productosDestacados: true,
      verificado: true, prioridad: true, publicacionesDestacadas: true,
      estadisticas: true, campanas: true, responder: true, acompanamiento: false,
    },
    incluye: [
      'Todo lo de Suscripción', 'Perfil verificado', 'Prioridad en búsquedas',
      'Publicaciones destacadas', 'Estadísticas',
      'Participación en campañas de MÍA', 'Mayor visibilidad',
    ],
    excluye: [],
  },

  // El plan más alto: todo lo de Membresía más los servicios de marketing.
  // `cotizado` marca que el precio es "desde" y no se cobra automático: MÍA
  // arma la propuesta y hasta entonces se activan los beneficios.
  crece: {
    id: 'crece',
    nombre: 'Crece con MÍA',
    etiqueta: 'Desde $2,500 MXN al mes',
    precioMensual: 2500,
    peso: 3,
    cotizado: true,
    resumen: 'Todo lo de Membresía más tu marketing llevado de manera profesional.',
    limites: { subcategorias: 5, publicaciones: Infinity, fotos: 40, caracteresDescripcion: 6000 },
    permisos: {
      logo: true, contacto: true, redes: true, mapa: true, productosDestacados: true,
      verificado: true, prioridad: true, publicacionesDestacadas: true,
      estadisticas: true, campanas: true, responder: true, acompanamiento: true,
    },
    incluye: ['Todo lo de Membresía'],
    servicios: [
      'Estrategia de marketing', 'Calendario de contenido', 'Diseño',
      'Administración de redes sociales', 'Reportes', 'Reuniones',
      'Acompañamiento personalizado',
    ],
    excluye: [],
  },
};

export const PLAN_POR_DEFECTO = 'gratuito';
export const ORDEN_PLANES = ['gratuito', 'suscripcion', 'membresia', 'crece'];

/**
 * Reglas que le tocan a un negocio ahora mismo. Si la membresía venció o el
 * pago no está confirmado, devuelve las del plan gratuito pero conserva el
 * nombre del plan contratado para poder avisarle a la dueña.
 */
export function reglasVigentes(negocio) {
  const contratado = PLANES[negocio?.plan] ? negocio.plan : PLAN_POR_DEFECTO;
  const vencida = membresiaVencida(negocio);
  const sinPago = contratado !== PLAN_POR_DEFECTO && negocio?.pago_confirmado === 0;
  const efectivo = vencida || sinPago ? PLAN_POR_DEFECTO : contratado;
  const plan = PLANES[efectivo];
  return {
    planContratado: contratado,
    planEfectivo: efectivo,
    vencida,
    sinPago,
    limites: plan.limites,
    permisos: plan.permisos,
  };
}

export function membresiaVencida(negocio) {
  if (!negocio) return false;
  const plan = negocio.plan || PLAN_POR_DEFECTO;
  if (plan === PLAN_POR_DEFECTO) return false;
  if (!negocio.plan_vence) return false;
  return new Date(negocio.plan_vence).getTime() < Date.now();
}

/**
 * Payment Link de Stripe ("https://buy.stripe.com/...") de cada plan que se
 * cobra solo. Se configura por variable de entorno — son URL públicas, no
 * secretas, pero igual conviene poder cambiarlas sin tocar código, por si
 * un día se recrean en Stripe.
 *
 * "Crece con MÍA" no aparece aquí a propósito: su precio se cotiza caso por
 * caso, así que ese pago lo sigue confirmando la organización a mano.
 */
export const STRIPE_ENLACES_PAGO = {
  suscripcion: process.env.STRIPE_PAYMENT_LINK_SUSCRIPCION || '',
  membresia: process.env.STRIPE_PAYMENT_LINK_MEMBRESIA || '',
};

/** Taxonomía definida por MÍA. */
export const CATEGORIAS = [
  { id: 'belleza', nombre: 'Belleza', icono: '💄',
    sub: ['Maquillaje', 'Pestañas', 'Cejas', 'Uñas', 'Peinado', 'Barbería', 'Spa', 'Faciales',
      'Masajes', 'Depilación', 'Micropigmentación', 'Tratamientos capilares', 'Skincare', 'Perfumería'] },
  { id: 'moda', nombre: 'Moda', icono: '👗',
    sub: ['Ropa para mujer', 'Boutique', 'Ropa infantil', 'Lencería', 'Bolsos', 'Zapatos',
      'Accesorios', 'Bisutería', 'Joyería', 'Relojes'] },
  { id: 'reposteria', nombre: 'Repostería y Alimentos', icono: '🍰',
    sub: ['Pasteles', 'Cupcakes', 'Galletas', 'Postres', 'Chocolatería', 'Panadería',
      'Repostería personalizada', 'Mesas de postres', 'Comida saludable', 'Catering',
      'Comida casera', 'Snacks', 'Bebidas artesanales'] },
  { id: 'eventos', nombre: 'Eventos', icono: '🎉',
    sub: ['Coctelería', 'Mocktails', 'Decoración', 'Florería', 'Organización de eventos',
      'Wedding Planner', 'Fotografía', 'Video', 'DJ', 'Audio e iluminación', 'Banquetes',
      'Renta de mobiliario', 'Animación', 'Invitaciones', 'Recuerdos'] },
  { id: 'flores', nombre: 'Flores y Regalos', icono: '🌸',
    sub: ['Florerías', 'Arreglos florales', 'Plantas', 'Suculentas', 'Regalos personalizados',
      'Globos', 'Cajas sorpresa', 'Velas artesanales'] },
  { id: 'hogar', nombre: 'Hogar y Decoración', icono: '🏠',
    sub: ['Decoración', 'Organización', 'Muebles', 'Artesanías', 'Cerámica', 'Cuadros',
      'Textiles', 'Cortinas', 'Iluminación', 'Jardinería'] },
  { id: 'bienestar', nombre: 'Salud y Bienestar', icono: '🩺',
    sub: ['Nutrición', 'Psicología', 'Terapia', 'Medicina', 'Fisioterapia', 'Quiropráctica',
      'Yoga', 'Pilates', 'Meditación'] },
  { id: 'fitness', nombre: 'Fitness y Deporte', icono: '🏋️',
    sub: ['Entrenamiento personal', 'Gimnasio', 'Yoga', 'Pilates', 'Danza', 'CrossFit',
      'Running', 'Ciclismo', 'Artes marciales'] },
  { id: 'educacion', nombre: 'Educación', icono: '📚',
    sub: ['Idiomas', 'Regularización', 'Clases particulares', 'Cursos', 'Talleres', 'Música',
      'Arte', 'Pintura', 'Manualidades', 'Programación', 'Robótica'] },
  { id: 'arte', nombre: 'Arte y Diseño', icono: '🎨',
    sub: ['Ilustración', 'Pintura', 'Escultura', 'Lettering', 'Caligrafía'] },
  { id: 'mascotas', nombre: 'Mascotas', icono: '🐶',
    sub: ['Estética canina', 'Veterinaria', 'Paseadores', 'Guardería', 'Adiestramiento',
      'Accesorios', 'Alimentos', 'Hospedaje'] },
  { id: 'automotriz', nombre: 'Automotriz', icono: '🚗',
    sub: ['Mecánica', 'Hojalatería', 'Pintura', 'Estética automotriz', 'Lavado', 'Accesorios'] },
  { id: 'turismo', nombre: 'Turismo', icono: '✈️',
    sub: ['Agencia de viajes', 'Guías turísticos', 'Hospedaje', 'Experiencias', 'Transporte turístico'] },
  { id: 'infantil', nombre: 'Maternidad e Infancia', icono: '👶',
    sub: ['Ropa para bebés', 'Juguetes', 'Estimulación temprana', 'Lactancia', 'Guarderías',
      'Fiestas infantiles'] },
  { id: 'fotografia', nombre: 'Fotografía y Producción', icono: '📷',
    sub: ['Fotografía de eventos', 'Fotografía de producto', 'Fotografía de retrato', 'Video',
      'Edición', 'Drones'] },
  { id: 'profesionales', nombre: 'Servicios Profesionales', icono: '⚖️',
    sub: ['Abogadas', 'Contadoras', 'Arquitectas', 'Ingenieras', 'Traductoras', 'Notarias', 'Auditoría'] },
  { id: 'sustentabilidad', nombre: 'Sustentabilidad', icono: '🌱',
    sub: ['Productos ecológicos', 'Cosmética natural', 'Moda sostenible', 'Reciclaje', 'Huertos', 'Compostaje'] },
  { id: 'artesania', nombre: 'Artesanías y Hecho a Mano', icono: '✨',
    sub: ['Tejido', 'Bordado', 'Crochet', 'Macramé', 'Cerámica', 'Jabones artesanales', 'Velas',
      'Papelería', 'Resina', 'Bisutería artesanal'] },
];

/** Entidades federativas, para el filtro por ubicación. */
export const ENTIDADES = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
  'Chiapas', 'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango',
  'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco',
  'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla',
  'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora',
  'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas',
];

export const PUERTO = Number(process.env.PORT || 3000);
