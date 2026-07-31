// Envío de correos por la API HTTP de SendGrid (sin dependencias nuevas: usa
// el fetch nativo de Node). Igual que con Stripe, si no está configurado el
// módulo queda inerte — registrarse nunca debe depender de que el correo
// salga bien.
import { PLANES, WHATSAPP_MIA, enlaceWhatsApp } from './config.js';
import { todos } from './db.js';

const SENDGRID_LLAVE = process.env.SENDGRID_API_KEY || '';
const REMITENTE = process.env.CORREO_REMITENTE || '';
const REMITENTE_NOMBRE = process.env.CORREO_REMITENTE_NOMBRE || 'MÍA';
const SITIO_URL = (process.env.SITIO_URL || '').replace(/\/$/, '');

export const correoConfigurado = Boolean(SENDGRID_LLAVE && REMITENTE);

export async function enviarCorreo({ para, asunto, html }) {
  if (!correoConfigurado) {
    console.log(`[MÍA] Correo no configurado — no se envió "${asunto}" a ${para}.`);
    return;
  }
  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SENDGRID_LLAVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: para }] }],
        from: { email: REMITENTE, name: REMITENTE_NOMBRE },
        subject: asunto,
        content: [{ type: 'text/html', value: html }],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) {
      console.error(`[MÍA] SendGrid respondió ${resp.status} al enviar a ${para}:`, await resp.text());
    }
  } catch (err) {
    console.error('[MÍA] Error enviando correo:', err.message);
  }
}

/* ============================================================ plantillas === */

const ENVOLTURA = (contenido) => `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#2D3A47">
    <p style="color:#B46A72;font-weight:800;font-size:22px;margin:0 0 20px">MÍA</p>
    ${contenido}
    <p style="color:#8a8a8a;font-size:13px;margin-top:32px">Directorio de negocios de mujeres mexicanas. No cobramos comisión.</p>
  </div>`;

const botonWhatsApp = (mensaje, texto) => !WHATSAPP_MIA ? '' : `
  <p style="margin-top:20px">
    <a href="${enlaceWhatsApp(mensaje)}"
       style="background:#B46A72;color:#ffffff;padding:12px 22px;border-radius:8px;
       text-decoration:none;font-weight:700;display:inline-block">${texto}</a>
  </p>`;

const botonSitio = (ruta, texto) => !SITIO_URL ? '' : `
  <p style="margin-top:16px">
    <a href="${SITIO_URL}${ruta}"
       style="background:#B46A72;color:#ffffff;padding:12px 22px;border-radius:8px;
       text-decoration:none;font-weight:700;display:inline-block">${texto}</a>
  </p>`;

/* ============================================================ avisos masivos === */
// Le llegan a toda clienta activa: negocio nuevo, negocio verificado, blog
// nuevo. Nunca truenan la acción de la administradora que los dispara — por
// eso nadie los espera (await) donde se llaman.

// Solo a quien aceptó recibir noticias por correo al registrarse. La
// bienvenida y los avisos de mensajes/cuenta no pasan por aquí — esos son
// transaccionales y le llegan a todas sin importar esta preferencia.
function usuariasActivas() {
  return todos(
    `SELECT correo, nombre FROM usuarios WHERE rol = 'usuario' AND estado = 'activo' AND acepta_noticias = 1`
  );
}

function avisarATodas(fabricarCorreo) {
  try {
    for (const u of usuariasActivas()) {
      const { asunto, html } = fabricarCorreo(u);
      enviarCorreo({ para: u.correo, asunto, html });
    }
  } catch (err) {
    console.error('[MÍA] Error avisando a las usuarias:', err.message);
  }
}

export function avisarNuevoNegocio(negocio) {
  avisarATodas((u) => ({
    asunto: `Nuevo negocio en MÍA: ${negocio.nombre}`,
    html: ENVOLTURA(`
      <h1 style="font-size:22px;margin:0 0 12px">Hola, ${u.nombre}</h1>
      <p>Se acaba de unir a MÍA <strong>${negocio.nombre}</strong>${negocio.ciudad ? ` en ${negocio.ciudad}` : ''}.</p>
      ${botonSitio(`/#/negocio/${negocio.slug}`, 'Conocer el negocio')}
    `),
  }));
}

export function avisarNegocioVerificado(negocio) {
  avisarATodas((u) => ({
    asunto: `${negocio.nombre} ya es un negocio verificado en MÍA`,
    html: ENVOLTURA(`
      <h1 style="font-size:22px;margin:0 0 12px">Hola, ${u.nombre}</h1>
      <p><strong>${negocio.nombre}</strong> ya tiene el sello de verificado por MÍA.</p>
      ${botonSitio(`/#/negocio/${negocio.slug}`, 'Ver su perfil')}
    `),
  }));
}

export function avisarNuevoArticulo(articulo) {
  avisarATodas((u) => ({
    asunto: `Nuevo en el blog de MÍA: ${articulo.titulo}`,
    html: ENVOLTURA(`
      <h1 style="font-size:22px;margin:0 0 12px">Hola, ${u.nombre}</h1>
      <p>${articulo.resumen}</p>
      ${botonSitio(`/#/blog/${articulo.slug}`, 'Leer el artículo')}
    `),
  }));
}

export function correoBienvenidaUsuaria(nombre) {
  return {
    asunto: '¡Bienvenida a MÍA!',
    html: ENVOLTURA(`
      <h1 style="font-size:22px;margin:0 0 12px">Hola, ${nombre}</h1>
      <p>Tu cuenta ya está lista. Ya puedes buscar negocios de mujeres mexicanas, guardarlos en
      favoritos y dejar tus reseñas.</p>
    `),
  };
}

export function correoNuevoMensaje(propietariaNombre, negocioNombre, usuariaNombre, extracto) {
  return {
    asunto: `Tienes un nuevo mensaje en MÍA de ${usuariaNombre}`,
    html: ENVOLTURA(`
      <h1 style="font-size:22px;margin:0 0 12px">Hola, ${propietariaNombre}</h1>
      <p><strong>${usuariaNombre}</strong> le escribió a <strong>${negocioNombre}</strong> a través de MÍA:</p>
      <p style="background:#FBE7EC;border-radius:10px;padding:14px 16px;font-style:italic">"${extracto}"</p>
      <p>Entra a tu panel en MÍA para leerlo completo y responder cuanto antes.</p>
    `),
  };
}

export function correoBienvenidaNegocio(nombre, negocioNombre, plan) {
  const nombrePlan = PLANES[plan]?.nombre || plan;
  const base = `
    <h1 style="font-size:22px;margin:0 0 12px">Hola, ${nombre}</h1>
    <p>¡Bienvenida a MÍA! Registramos <strong>${negocioNombre}</strong> con el plan
    <strong>${nombrePlan}</strong>.</p>
  `;

  if (plan !== 'membresia' && plan !== 'crece') {
    return { asunto: '¡Bienvenida a MÍA!', html: ENVOLTURA(base) };
  }

  const esCrece = plan === 'crece';
  const mensajeWA = esCrece
    ? `Hola, soy ${nombre} de ${negocioNombre}. Quiero agendar mi cotización del plan Crece con MÍA.`
    : `Hola, soy ${nombre} de ${negocioNombre}. Quiero agendar mi entrevista para registrar y verificar mi negocio en MÍA (plan Membresía).`;
  const explicacion = esCrece
    ? 'para agendar la cotización de tu plan de crecimiento'
    : 'para agendar tu entrevista de registro y verificación de tu negocio';

  return {
    asunto: '¡Bienvenida a MÍA! Agenda tu entrevista',
    html: ENVOLTURA(base + `
      <div style="background:#F7C8D3;border-radius:12px;padding:18px 20px;margin-top:20px">
        <p style="font-weight:800;margin:0 0 8px">📅 Agenda tu entrevista con MÍA</p>
        <p style="margin:0">Escríbenos por WhatsApp ${explicacion}.</p>
        ${botonWhatsApp(mensajeWA, 'Agendar por WhatsApp')}
      </div>
    `),
  };
}
