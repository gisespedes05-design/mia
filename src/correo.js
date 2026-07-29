// Envío de correos por la API HTTP de SendGrid (sin dependencias nuevas: usa
// el fetch nativo de Node). Igual que con Stripe, si no está configurado el
// módulo queda inerte — registrarse nunca debe depender de que el correo
// salga bien.
import { PLANES, WHATSAPP_MIA, enlaceWhatsApp } from './config.js';

const SENDGRID_LLAVE = process.env.SENDGRID_API_KEY || '';
const REMITENTE = process.env.CORREO_REMITENTE || '';
const REMITENTE_NOMBRE = process.env.CORREO_REMITENTE_NOMBRE || 'MÍA';

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
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#2E2247">
    <p style="color:#B35A8A;font-weight:800;font-size:22px;margin:0 0 20px">MÍA</p>
    ${contenido}
    <p style="color:#8a8a8a;font-size:13px;margin-top:32px">Directorio de negocios de mujeres mexicanas. No cobramos comisión.</p>
  </div>`;

const botonWhatsApp = (mensaje, texto) => !WHATSAPP_MIA ? '' : `
  <p style="margin-top:20px">
    <a href="${enlaceWhatsApp(mensaje)}"
       style="background:#B35A8A;color:#ffffff;padding:12px 22px;border-radius:8px;
       text-decoration:none;font-weight:700;display:inline-block">${texto}</a>
  </p>`;

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
      <div style="background:#F6B7C7;border-radius:12px;padding:18px 20px;margin-top:20px">
        <p style="font-weight:800;margin:0 0 8px">📅 Agenda tu entrevista con MÍA</p>
        <p style="margin:0">Escríbenos por WhatsApp ${explicacion}.</p>
        ${botonWhatsApp(mensajeWA, 'Agendar por WhatsApp')}
      </div>
    `),
  };
}
