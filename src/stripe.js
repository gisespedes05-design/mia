import Stripe from 'stripe';

// La llave nunca vive en el código: se configura como variable de entorno
// en el servidor donde corra MÍA (Render, Railway, etc.), nunca en el
// repositorio. Sin ella, el cliente existe pero cualquier llamada real falla
// con un mensaje claro en vez de tronar el servidor entero al arrancar.
const LLAVE_SECRETA = process.env.STRIPE_SECRET_KEY || '';

export const stripeConfigurado = Boolean(LLAVE_SECRETA);

// Sin especificar apiVersion: el SDK usa la versión con la que se compiló,
// que siempre existe y es consistente con sus propios tipos.
export const stripe = new Stripe(LLAVE_SECRETA || 'sk_test_sin_configurar');

export const STRIPE_WEBHOOK_SECRETO = process.env.STRIPE_WEBHOOK_SECRET || '';
