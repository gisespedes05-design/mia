// Envío de SMS por la API HTTP de Twilio (sin dependencias nuevas: usa el
// fetch nativo de Node). Igual que Stripe y el correo: si no está
// configurado, el módulo queda inerte — nunca debe tronar el flujo que lo usa.
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_DESDE = process.env.TWILIO_NUMERO || '';

export const smsConfigurado = Boolean(TWILIO_SID && TWILIO_TOKEN && TWILIO_DESDE);

/** Si el número no trae "+", se asume celular mexicano (+52). */
function aE164(numero) {
  const limpio = String(numero || '').replace(/[^\d+]/g, '');
  if (!limpio) return '';
  return limpio.startsWith('+') ? limpio : `+52${limpio}`;
}

export async function enviarSms({ para, texto }) {
  const destino = aE164(para);
  if (!smsConfigurado || !destino) {
    console.log(`[MÍA] SMS no configurado o sin teléfono — no se envió a "${para}".`);
    return;
  }
  try {
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    const cuerpo = new URLSearchParams({ To: destino, From: TWILIO_DESDE, Body: texto });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo,
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) {
      console.error(`[MÍA] Twilio respondió ${resp.status} al mandar SMS a ${destino}:`, await resp.text());
    }
  } catch (err) {
    console.error('[MÍA] Error enviando SMS:', err.message);
  }
}
