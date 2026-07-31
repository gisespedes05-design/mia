import { ejecutar, uno, anotar } from '../db.js';
import { ErrorHttp, exigirSesion } from '../auth.js';
import { STRIPE_ENLACES_PAGO, PLANES, ESTADOS_NEGOCIO } from '../config.js';
import { stripe, stripeConfigurado, STRIPE_WEBHOOK_SECRETO } from '../stripe.js';
import { obtenerNegocioPorId, exigirPropiedad } from '../negocios.js';

const PLANES_AUTOMATIZADOS = ['suscripcion', 'membresia'];

/** El dominio real desde donde corre MÍA, para el retorno del Billing Portal. */
function origenDe(ctx) {
  if (process.env.SITIO_URL) return process.env.SITIO_URL.replace(/\/$/, '');
  const protocolo = ctx.req.headers['x-forwarded-proto'] || 'http';
  return `${protocolo}://${ctx.req.headers.host}`;
}

const fechaDeUnix = (segundosUnix) => new Date(segundosUnix * 1000).toISOString().slice(0, 10);

/**
 * Arma la URL del Payment Link de Stripe. Para Suscripción y Membresía es
 * el mismo enlace compartido para todas (STRIPE_ENLACES_PAGO); para Crece
 * con MÍA es el enlace que la administradora crea a mano para ESE negocio,
 * con su precio ya cotizado (`enlace_pago_crece`). No hace ninguna llamada
 * a Stripe: los Payment Links ya existen en el Dashboard, solo se les pega
 * el negocio en `client_reference_id` para que el webhook sepa a quién
 * activarle el plan cuando se complete el pago. El pago NO se confirma
 * aquí — se confirma cuando llega ese webhook, que es la única fuente de
 * verdad sobre si el dinero de verdad entró.
 */
export function crearCheckout(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);

  const plan = ctx.cuerpo.plan;
  if (!PLANES_AUTOMATIZADOS.includes(plan) && plan !== 'crece') {
    throw new ErrorHttp(400, 'Ese plan no se paga por aquí.');
  }
  const enlace = plan === 'crece' ? negocio.enlace_pago_crece : STRIPE_ENLACES_PAGO[plan];
  if (!enlace) {
    throw new ErrorHttp(
      503,
      plan === 'crece'
        ? 'Todavía no hay un enlace de pago para tu cotización. Escríbele a MÍA para completarlo.'
        : `Falta configurar el enlace de pago de Stripe para el plan ${PLANES[plan].nombre}.`
    );
  }

  const url = new URL(enlace);
  url.searchParams.set('client_reference_id', `${negocio.id}:${plan}`);
  if (negocio.propietaria_correo) url.searchParams.set('prefilled_email', negocio.propietaria_correo);
  return { url: url.toString() };
}

/** Sesión del Billing Portal: para que la dueña administre o cancele su pago sola. */
export async function crearPortal(ctx) {
  if (!stripeConfigurado) {
    throw new ErrorHttp(503, 'La organización todavía no configuró el acceso a Stripe para esto.');
  }
  const usuario = exigirSesion(ctx);
  const negocio = exigirPropiedad(obtenerNegocioPorId(ctx.params.id), usuario);

  if (!negocio.stripe_customer_id) {
    throw new ErrorHttp(400, 'Este negocio todavía no tiene un pago registrado con Stripe.');
  }
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: negocio.stripe_customer_id,
      return_url: `${origenDe(ctx)}/?#/panel`,
    });
    return { url: session.url };
  } catch (err) {
    console.error('[Stripe] Error creando el portal:', err.message);
    throw new ErrorHttp(502, 'No se pudo conectar con Stripe. Intenta de nuevo en un momento.');
  }
}

/* ===================================================================== */
/*  Webhook: aquí es donde de verdad se confirma o se cae un pago.        */
/* ===================================================================== */

function yaProcesado(eventoId) {
  return Boolean(uno(`SELECT id FROM pagos_stripe WHERE evento_stripe_id = $id`, { id: eventoId }));
}

function registrarPago({ eventoId, negocioId, tipo, plan, monto, moneda, estado }) {
  ejecutar(
    `INSERT INTO pagos_stripe (evento_stripe_id, negocio_id, tipo, plan, monto, moneda, estado)
     VALUES ($eventoId, $negocioId, $tipo, $plan, $monto, $moneda, $estado)`,
    { eventoId, negocioId: negocioId ?? null, tipo, plan: plan || '', monto: monto ?? null, moneda: moneda || '', estado }
  );
}

function negocioPorSuscripcion(subscriptionId) {
  return uno(`SELECT * FROM negocios WHERE stripe_subscription_id = $id`, { id: subscriptionId });
}

async function manejarCheckoutCompletado(event) {
  const session = event.data.object;
  if (session.mode !== 'subscription' || !session.subscription) return;

  // Los Payment Links no llevan metadata propia: el negocio y el plan
  // viajan en client_reference_id, tal como los armó crearCheckout().
  const [idParte, plan] = String(session.client_reference_id || '').split(':');
  const negocioId = Number(idParte);
  const negocio = negocioId ? obtenerNegocioPorId(negocioId) : null;
  if (!negocio || (!PLANES_AUTOMATIZADOS.includes(plan) && plan !== 'crece')) {
    console.error('[Stripe] checkout.session.completed sin negocio o plan reconocible:', session.id, session.client_reference_id);
    return;
  }

  // Se vincula el negocio con Stripe y se marca el pago como pendiente de
  // confirmar explícitamente (0), sin importar qué tenía antes: la fecha de
  // vigencia y la confirmación real las pone invoice.paid, que llega casi al
  // mismo tiempo y ya trae esa fecha —así no hace falta otra llamada a Stripe.
  ejecutar(
    `UPDATE negocios SET
       plan = $plan, pago_confirmado = 0,
       stripe_customer_id = $cliente, stripe_subscription_id = $suscripcion
     WHERE id = $id`,
    { plan, cliente: String(session.customer), suscripcion: session.subscription, id: negocio.id }
  );
  anotar(null, 'Checkout completado en Stripe', `${negocio.nombre} — ${PLANES[plan].nombre}`);
  registrarPago({
    eventoId: event.id, negocioId: negocio.id, tipo: event.type, plan,
    monto: (session.amount_total ?? 0) / 100, moneda: session.currency, estado: 'pagado',
  });
}

async function manejarFacturaPagada(event) {
  const invoice = event.data.object;
  if (!invoice.subscription) return;

  const negocio = negocioPorSuscripcion(invoice.subscription);
  if (!negocio) {
    // Stripe no garantiza el orden de entrega de sus webhooks: en un pago
    // recién hecho, este invoice.paid puede llegar (o procesarse) antes que
    // el checkout.session.completed que es quien vincula por primera vez el
    // negocio con esta suscripción. En vez de darlo por perdido, se rechaza
    // a propósito para que Stripe lo reintente solo en unos minutos, cuando
    // ese vínculo ya debería existir.
    throw new ErrorHttp(409, `invoice.paid de una suscripción todavía no vinculada: ${invoice.subscription}`);
  }
  const finPeriodo = invoice.lines?.data?.[0]?.period?.end;
  if (finPeriodo) {
    ejecutar(`UPDATE negocios SET plan_vence = $vence, pago_confirmado = 1 WHERE id = $id`, {
      vence: fechaDeUnix(finPeriodo), id: negocio.id,
    });
  }
  // Con el pago ya confirmado por Stripe, se publica sola: ya no hace falta
  // que alguien de MÍA la revise a mano primero. Solo se toca si sigue
  // "pendiente" — si MÍA ya la rechazó o la suspendió a propósito, esa
  // decisión no se pisa nada más porque llegó un cobro. La insignia de
  // verificada sigue siendo aparte y sigue siendo manual.
  if (negocio.estado === ESTADOS_NEGOCIO.PENDIENTE) {
    ejecutar(`UPDATE negocios SET estado = $publicado WHERE id = $id`, {
      publicado: ESTADOS_NEGOCIO.PUBLICADO, id: negocio.id,
    });
    anotar(null, 'Publicado automáticamente', `${negocio.nombre}: se publicó solo al confirmarse el pago con Stripe.`);
  }
  anotar(null, 'Renovación cobrada por Stripe', `${negocio.nombre} — ${PLANES[negocio.plan]?.nombre || negocio.plan}`);
  registrarPago({
    eventoId: event.id, negocioId: negocio.id, tipo: event.type, plan: negocio.plan,
    monto: (invoice.amount_paid ?? 0) / 100, moneda: invoice.currency, estado: 'pagado',
  });
}

async function manejarPagoFallido(event) {
  const invoice = event.data.object;
  if (!invoice.subscription) return;

  const negocio = negocioPorSuscripcion(invoice.subscription);
  if (!negocio) {
    // Mismo caso que en invoice.paid: puede llegar antes que el vínculo
    // exista todavía. Se rechaza para que Stripe lo reintente.
    throw new ErrorHttp(409, `invoice.payment_failed de una suscripción todavía no vinculada: ${invoice.subscription}`);
  }

  anotar(null, 'Pago con Stripe fallido', `${negocio.nombre}: Stripe reintentará el cobro automáticamente.`);
  registrarPago({
    eventoId: event.id, negocioId: negocio.id, tipo: event.type, plan: negocio.plan,
    monto: (invoice.amount_due ?? 0) / 100, moneda: invoice.currency, estado: 'fallido',
  });
}

async function manejarSuscripcionCancelada(event) {
  const suscripcion = event.data.object;
  const negocio = negocioPorSuscripcion(suscripcion.id);
  if (!negocio) return;

  // No se corta el servicio de inmediato: ya pagó hasta plan_vence, y esa
  // fecha ya quedó fija con el último cobro. Al llegar, reglasVigentes() la
  // regresa sola al plan Gratuito.
  ejecutar(`UPDATE negocios SET stripe_subscription_id = NULL WHERE id = $id`, { id: negocio.id });
  anotar(null, 'Suscripción cancelada en Stripe', `${negocio.nombre} conserva su plan hasta ${negocio.plan_vence}.`);
  registrarPago({
    eventoId: event.id, negocioId: negocio.id, tipo: event.type, plan: negocio.plan,
    estado: 'cancelado',
  });
}

export async function webhook(ctx) {
  // La verificación de firma es criptografía local (HMAC) contra el secreto
  // del webhook: no necesita la llave de la API ni hablar con Stripe.
  if (!STRIPE_WEBHOOK_SECRETO) {
    throw new ErrorHttp(503, 'El webhook de Stripe no está configurado en este servidor.');
  }

  const firma = ctx.req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(ctx.cuerpoCrudo, firma, STRIPE_WEBHOOK_SECRETO);
  } catch (err) {
    console.error('[Stripe] Firma de webhook inválida:', err.message);
    throw new ErrorHttp(400, 'Firma inválida.');
  }

  if (yaProcesado(event.id)) return { recibido: true, repetido: true };

  if (event.type === 'checkout.session.completed') await manejarCheckoutCompletado(event);
  else if (event.type === 'invoice.paid') await manejarFacturaPagada(event);
  else if (event.type === 'invoice.payment_failed') await manejarPagoFallido(event);
  else if (event.type === 'customer.subscription.deleted') await manejarSuscripcionCancelada(event);
  else return { recibido: true, ignorado: event.type };

  return { recibido: true };
}
