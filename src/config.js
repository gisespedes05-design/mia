// Configuración central de MÍA: roles, planes y catálogos.
// Los límites de cada plan se aplican en el servidor (no sólo en la interfaz).

export const ROLES = {
  ADMIN: 'admin',      // La organización MÍA
  NEGOCIO: 'negocio',  // Dueña de uno o varios negocios
  USUARIO: 'usuario',  // Visitante registrada: reseñas y favoritos
};

export const ESTADOS_NEGOCIO = {
  BORRADOR: 'borrador',      // La dueña lo está llenando, nadie más lo ve
  PENDIENTE: 'pendiente',    // Enviado a revisión de MÍA
  PUBLICADO: 'publicado',    // Visible en el directorio
  RECHAZADO: 'rechazado',    // MÍA pidió cambios
  SUSPENDIDO: 'suspendido',  // MÍA detuvo el acceso
};

// Un negocio sólo aparece en el directorio público en este estado.
export const ESTADO_VISIBLE = ESTADOS_NEGOCIO.PUBLICADO;

/**
 * Planes de membresía.
 *
 * `limites` define cuánto puede cargar un negocio.
 * `permisos` define qué funciones puede usar.
 *
 * Si la membresía vence, el negocio cae automáticamente a las reglas de
 * "gratis" sin perder su información: lo que exceda el límite se guarda
 * pero deja de mostrarse hasta que renueve.
 */
export const PLANES = {
  gratis: {
    id: 'gratis',
    nombre: 'Semilla',
    etiqueta: 'Gratis',
    precioMensual: 0,
    resumen: 'Para que tu negocio exista en línea desde hoy, sin pagar nada.',
    limites: {
      negocios: 1,
      fotos: 1,
      productos: 0,
      caracteresDescripcion: 300,
    },
    permisos: {
      whatsapp: false,
      sitioWeb: false,
      redesSociales: false,
      catalogo: false,
      responderResenas: false,
      estadisticas: false,
      prioridadBusqueda: false,
      insigniaVerificado: false,
    },
    incluye: [
      '1 negocio publicado en el directorio',
      '1 fotografía de portada',
      'Descripción de hasta 300 caracteres',
      'Teléfono de contacto',
      'Recibe reseñas y favoritos',
    ],
  },

  emprende: {
    id: 'emprende',
    nombre: 'Emprende',
    etiqueta: '$149 MXN / mes',
    precioMensual: 149,
    resumen: 'Para negocios que ya venden y quieren que las encuentren mejor.',
    limites: {
      negocios: 2,
      fotos: 6,
      productos: 12,
      caracteresDescripcion: 1200,
    },
    permisos: {
      whatsapp: true,
      sitioWeb: true,
      redesSociales: true,
      catalogo: true,
      responderResenas: true,
      estadisticas: true,
      prioridadBusqueda: false,
      insigniaVerificado: false,
    },
    incluye: [
      'Hasta 2 negocios',
      'Galería de 6 fotografías',
      'Descripción de hasta 1,200 caracteres',
      'Botón de WhatsApp y sitio web',
      'Redes sociales (Instagram, Facebook, TikTok)',
      'Catálogo de hasta 12 productos o servicios',
      'Responde públicamente a las reseñas',
      'Estadísticas de visitas y favoritos',
    ],
  },

  impulsa: {
    id: 'impulsa',
    nombre: 'Impulsa',
    etiqueta: '$349 MXN / mes',
    precioMensual: 349,
    resumen: 'Máxima visibilidad, verificación e insignia de MÍA.',
    limites: {
      negocios: 5,
      fotos: 20,
      productos: 60,
      caracteresDescripcion: 3000,
    },
    permisos: {
      whatsapp: true,
      sitioWeb: true,
      redesSociales: true,
      catalogo: true,
      responderResenas: true,
      estadisticas: true,
      prioridadBusqueda: true,
      insigniaVerificado: true,
    },
    incluye: [
      'Hasta 5 negocios',
      'Galería de 20 fotografías',
      'Descripción de hasta 3,000 caracteres',
      'Todo lo del plan Emprende',
      'Aparece primero en las búsquedas de su categoría',
      'Insignia "Verificado por MÍA"',
      'Estadísticas ampliadas',
    ],
  },
};

export const PLAN_POR_DEFECTO = 'gratis';
export const ORDEN_PLANES = ['gratis', 'emprende', 'impulsa'];

/**
 * Devuelve las reglas que le tocan a un negocio ahora mismo.
 * Si la membresía está vencida, regresa las reglas del plan gratuito
 * pero conserva el nombre del plan contratado para poder avisarle a la dueña.
 */
export function reglasVigentes(negocio) {
  const contratado = PLANES[negocio?.plan] ? negocio.plan : PLAN_POR_DEFECTO;
  const vencida = membresiaVencida(negocio);
  const efectivo = vencida ? PLAN_POR_DEFECTO : contratado;
  const plan = PLANES[efectivo];
  return {
    planContratado: contratado,
    planEfectivo: efectivo,
    vencida,
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

export const CATEGORIAS = [
  { id: 'alimentos', nombre: 'Comida y repostería', icono: '🍰' },
  { id: 'moda', nombre: 'Moda y accesorios', icono: '👗' },
  { id: 'belleza', nombre: 'Belleza y bienestar', icono: '💅' },
  { id: 'artesania', nombre: 'Artesanía y arte popular', icono: '🧶' },
  { id: 'salud', nombre: 'Salud y cuidado', icono: '🩺' },
  { id: 'educacion', nombre: 'Educación y talleres', icono: '📚' },
  { id: 'servicios', nombre: 'Servicios profesionales', icono: '💼' },
  { id: 'hogar', nombre: 'Hogar y decoración', icono: '🏡' },
  { id: 'tecnologia', nombre: 'Tecnología y diseño', icono: '💻' },
  { id: 'turismo', nombre: 'Turismo y experiencias', icono: '🌵' },
  { id: 'agro', nombre: 'Campo y productos naturales', icono: '🌽' },
  { id: 'otros', nombre: 'Otros giros', icono: '✨' },
];

export const ENTIDADES = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
  'Chiapas', 'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango',
  'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco',
  'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla',
  'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora',
  'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas',
];

export const PUERTO = Number(process.env.PORT || 3000);
