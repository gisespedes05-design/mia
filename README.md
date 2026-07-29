# MÍA

Directorio inteligente y comunidad para negocios dirigidos por mujeres.
**MÍA no es un marketplace:** no cobra comisión sobre las ventas ni se mete
entre el negocio y su clienta. Lo que hace es que las encuentren.

## Qué hay en este repositorio

| Archivo | Qué es | Datos |
|---|---|---|
| `mia.html` | Maqueta de un solo archivo, para ver y enseñar la plataforma | Se guardan en el navegador de quien la abre — **no se comparten entre personas** |
| `server.js` + `src/` + `public/` | La aplicación real, con servidor y base de datos | Compartidos entre todas las usuarias, en el servidor |

`mia.html` sigue sirviendo para mostrar cómo se ve y se siente MÍA sin instalar
nada. Para que una mujer en Oaxaca registre su negocio y alguien en Monterrey
lo vea, hace falta la versión real — la de esta sección.

## Cómo correrla en tu computadora

Requiere **Node.js 22.5 o superior** (usa `node:sqlite`, integrado en Node, sin
paquetes externos que instalar).

```bash
npm run seed     # crea la base de datos con negocios y cuentas de prueba
npm start        # arranca en http://localhost:3000
```

Ábrela en `http://localhost:3000`. Los datos quedan en `data/mia.db`; para
empezar de cero: `npm run reset`.

## Cómo entrar

Hay tres tipos de cuenta. Todas entran por la misma pantalla y cada una ve algo
distinto. La sección **Entrar** trae botones de acceso rápido.

| Tipo de cuenta | Correo | Contraseña | Qué puede hacer |
|---|---|---|---|
| Organización MÍA | `admin@mia.mx` | `mia2026` | Publicar, rechazar y suspender perfiles; confirmar pagos; cambiar planes; verificar; administrar cuentas; moderar reseñas; escribir el blog |
| Negocio (Membresía) | `lucia@mia.mx` | `demo1234` | Administrar su perfil con todo abierto |
| Negocio (Gratuito) | `beatriz@mia.mx` | `demo1234` | Igual, pero con los avisos de lo que su plan le oculta |
| Clienta | `daniela@mia.mx` | `demo1234` | Buscar negocios, dejar reseñas y guardar favoritos |

Las contraseñas se guardan cifradas con **scrypt** (con sal por cuenta):
nadie, ni la organización, puede leerlas — solo se verifican.

## Secciones

**Inicio · Productos y Servicios · Mapa · Blog · Sobre MÍA**

Cada negocio pertenece a **una categoría principal** y puede estar en **hasta
cinco subcategorías**. Las 18 categorías —Belleza, Moda, Repostería y
Alimentos, Eventos, Flores y Regalos, Hogar y Decoración, Salud y Bienestar,
Fitness y Deporte, Educación, Arte y Diseño, Mascotas, Automotriz, Turismo,
Maternidad e Infancia, Fotografía y Producción, Servicios Profesionales,
Sustentabilidad, y Artesanías y Hecho a Mano— las definió MÍA, con sus
subcategorías. Se ajustan desde `src/config.js`.

## Planes

| | Gratuito | Suscripción | Membresía | Crece con MÍA |
|---|---|---|---|---|
| Precio | $0 | $299/mes | $599/mes | Desde $2,500/mes |
| Subcategorías | 5 | 5 | 5 | 5 |
| Logo | ✓ | ✓ | ✓ | ✓ |
| Publicaciones | 1 | ilimitadas | ilimitadas | ilimitadas |
| Fotografías | — | 12 | 30 | 40 |
| Redes sociales y WhatsApp | — | ✓ | ✓ | ✓ |
| Aparece en el mapa | — | ✓ | ✓ | ✓ |
| Productos destacados | — | ✓ | ✓ | ✓ |
| Responder reseñas | — | ✓ | ✓ | ✓ |
| Perfil verificado | — | — | ✓ | ✓ |
| Prioridad en búsquedas | — | — | ✓ | ✓ |
| Estadísticas | — | — | ✓ | ✓ |
| Campañas de MÍA | — | — | ✓ | ✓ |
| Servicios de marketing | — | — | — | ✓ |

**Crece con MÍA** lleva todo lo de Membresía más estrategia de marketing,
calendario de contenido, diseño, administración de redes sociales, reportes,
reuniones y acompañamiento personalizado. Su precio es *desde*: los $2,500 son
el punto de partida y el precio final depende de los servicios que necesite
cada negocio y del plan personalizado que se le arme. No se cobra automático —
MÍA cotiza el alcance y hasta entonces se activan los beneficios.

Estas reglas se aplican **en el servidor**, no solo en la pantalla: aunque
alguien manipule la página, no puede publicar más fotos o productos de los
que su plan permite.

### Dos reglas que rigen todo

1. **Nada se borra al bajar de plan.** Si un negocio deja de pagar, sus fotos y
   publicaciones se quedan guardadas y sólo dejan de mostrarse. Al renovar
   reaparecen. En su panel le sale exactamente qué le está ocultando su plan.
2. **Un plan de paga no se activa solo.** Entra como solicitud; MÍA confirma el
   pago y hasta entonces el perfil opera con las reglas del plan Gratuito.

## Registro

Cada plan tiene **su propio formulario**, no hay uno solo: lo que se pide
cambia según lo que ese plan incluye (el Gratuito no pregunta redes sociales;
Crece con MÍA sí pregunta en qué quieres que te acompañen).

```
Plan elegido → Formulario de ese plan → Solicitud registrada → Revisión de MÍA → Perfil publicado
```

Las solicitudes se ven en **Administración › Solicitudes**: negocio, plan,
categoría, fecha y estado, con lo que la dueña haya escrito para Crece con MÍA.
Todo se revisa y se marca como atendido dentro de la misma página.

## Cobros automáticos con Stripe

Suscripción y Membresía se cobran solas con Stripe: al registrarse (o al
completar un pago pendiente desde su panel), a la dueña se le manda a la
página de pago de Stripe; en cuanto Stripe confirma el cobro, su plan se
activa sin que nadie de MÍA tenga que hacer nada. Las renovaciones mensuales
y los cobros fallidos también se procesan solos. **Crece con MÍA no pasa por
aquí**: se sigue cotizando y confirmando a mano, como hasta ahora, porque su
precio varía según el alcance.

### Variables de entorno que hay que configurar

| Variable | Qué es | De dónde se saca |
|---|---|---|
| `STRIPE_PAYMENT_LINK_SUSCRIPCION` | URL del Payment Link del plan Suscripción | Stripe Dashboard → Payment Links → el enlace `https://buy.stripe.com/...` de ese producto |
| `STRIPE_PAYMENT_LINK_MEMBRESIA` | URL del Payment Link del plan Membresía | Igual, para el producto de Membresía |
| `STRIPE_WEBHOOK_SECRET` | Firma con la que Stripe sella cada aviso que manda | Se genera al crear el endpoint del webhook (siguiente sección); empieza con `whsec_` |
| `STRIPE_SECRET_KEY` | Llave secreta de la cuenta de Stripe | Developers → API keys → *Secret key* (`sk_live_...` o `sk_test_...`) |
| `SITIO_URL` | El dominio real donde vive MÍA (por ejemplo `https://mia.mx`) | Opcional; sin ella, se infiere de la petición |

Las dos primeras son URL públicas (no secretas): son literalmente el enlace
donde cualquiera puede pagar. `STRIPE_SECRET_KEY` solo hace falta para el
botón **"Administrar mi pago"** del panel (el portal donde la dueña ve sus
facturas o cambia su tarjeta) — sin ella, todo lo demás funciona igual.

### Configurar el webhook (el paso que activa todo)

1. En el Dashboard de Stripe: **Developers → Webhooks → Add endpoint**.
2. URL del endpoint: `https://tu-dominio/api/pagos/webhook`.
3. Eventos a enviar — selecciona exactamente estos cuatro:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
4. Al guardar, Stripe te muestra el **signing secret** (`whsec_...`): eso va en
   `STRIPE_WEBHOOK_SECRET`.
5. Opcional pero recomendable: en cada Payment Link, en **"After payment"**,
   elige *"Redirect customers to your website"* con esta URL:
   `https://tu-dominio/?pago=exito`. Si no lo configuras, no pasa nada malo —
   el plan se activa igual por el webhook — solo que la dueña se queda un
   momento en la pantalla de confirmación de Stripe en vez de volver sola.

### Cómo probarlo sin arriesgar dinero real

Usa las llaves de **modo de prueba** de Stripe (`sk_test_...`) y una tarjeta de
prueba (`4242 4242 4242 4242`, cualquier fecha futura y CVC). El webhook se
puede probar en local con la CLI de Stripe (`stripe listen --forward-to
localhost:3000/api/pagos/webhook`), que te da un `whsec_` temporal para
`STRIPE_WEBHOOK_SECRET`. Cuando todo funcione en modo prueba, se cambian las
mismas variables por las de modo real (`sk_live_...` y los Payment Links del
modo real) y no hay que tocar nada más del código.

### Qué pasa con cada aviso de Stripe

- **Pago recibido** (`checkout.session.completed` + `invoice.paid`): se activa
  el plan y se fija hasta cuándo queda vigente.
- **Se renueva sola cada mes** (`invoice.paid` de nuevo): la vigencia se
  extiende automáticamente, sin que nadie intervenga.
- **Un cobro falla** (`invoice.payment_failed`): no se corta el servicio de
  inmediato — Stripe reintenta el cobro solo. Queda anotado para que la
  organización lo sepa.
- **Se cancela la suscripción** (`customer.subscription.deleted`): el negocio
  conserva su plan hasta el último día ya pagado (no hay corte ni reembolso
  automático); al llegar esa fecha, cae solo al plan Gratuito.

Todo esto queda visible en **Administración › Pagos**, con el monto, el tipo
de evento y el estado de cada uno.

## Correos de bienvenida y entrevista por WhatsApp

Al registrarse, cada cuenta recibe un correo de bienvenida. Los negocios que
se registran con **Membresía** o **Crece con MÍA** reciben además un botón
para agendar por WhatsApp: para Membresía, la entrevista de registro y
verificación; para Crece con MÍA, la cotización de su plan de crecimiento.
Gratuito y Suscripción solo reciben la bienvenida (no necesitan entrevista).

Los correos se mandan con la API de **SendGrid** (sin librerías nuevas, con
el `fetch` nativo de Node). Variables de entorno:

| Variable | Qué es | De dónde se saca |
|---|---|---|
| `SENDGRID_API_KEY` | Llave de la API de SendGrid | SendGrid → Settings → API Keys → Create API Key |
| `CORREO_REMITENTE` | El correo desde el que se manda (debe estar verificado en SendGrid) | SendGrid → Settings → Sender Authentication → Single Sender Verification |
| `CORREO_REMITENTE_NOMBRE` | Nombre que se muestra como remitente | Opcional; por defecto `MÍA` |
| `WHATSAPP_MIA` | Número de WhatsApp de la organización | Solo dígitos con código de país, sin "+" ni espacios (ej. `521XXXXXXXXXX`) |

Si falta `SENDGRID_API_KEY` o `CORREO_REMITENTE`, el registro sigue
funcionando igual — simplemente no se manda el correo (queda anotado en los
logs del servidor). Si falta `WHATSAPP_MIA`, el correo se manda pero sin el
botón de WhatsApp.

## Avisos a las clientas: negocios nuevos, verificados y blog

Toda usuaria activa (rol clienta) recibe un correo cuando:

- **Se publica un negocio nuevo con plan de pago** (Suscripción, Membresía o
  Crece con MÍA — los de plan Gratuito no avisan, para no saturar el correo
  de todas por cada alta gratuita).
- **Un negocio se verifica** (el sello de verificado, plan Membresía o Crece).
- **Se publica un artículo del blog** (tanto al crearlo como al des-ocultarlo).

Estos avisos nunca bloquean la acción de la administradora que los dispara
(publicar, verificar, escribir el blog) — se mandan en segundo plano y
cualquier error solo queda anotado en los logs.

Los enlaces dentro de estos correos (al negocio, al artículo) necesitan la
variable `SITIO_URL` — sin ella, el correo se manda igual pero sin el botón
para entrar directo. Ya se documentó arriba, en la sección de Stripe.

**Importante sobre el volumen:** SendGrid en su plan gratis permite 100
correos al día. Cada uno de estos avisos le llega a *todas* las usuarias
activas, así que en cuanto haya varias decenas de usuarias, unos pocos avisos
pueden agotar ese límite diario — en ese momento hay que subir de plan en
SendGrid (es de paga por volumen).

## Mensajes entre usuarias y negocios

Cualquier clienta con sesión iniciada puede escribirle a un negocio desde su
perfil público. El negocio ve la conversación en **Mi negocio › Mensajes**, y
puede responder si su plan lo permite (Suscripción en adelante — igual que
responder reseñas; con el plan Gratuito el mensaje se recibe igual, solo que
la respuesta se sigue dando fuera de MÍA, por los datos de contacto que ya
son públicos). Cada mensaje nuevo de una clienta le manda a la dueña un aviso
por correo y por SMS para que responda pronto.

El SMS se manda con la API de **Twilio** (otra vez, sin librerías nuevas).
A diferencia del correo, **Twilio cobra por cada mensaje enviado** (no tiene
un nivel gratuito permanente como SendGrid), así que esta parte es opcional:

| Variable | Qué es | De dónde se saca |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Identificador de tu cuenta de Twilio | Twilio Console → dashboard principal |
| `TWILIO_AUTH_TOKEN` | Token de autenticación | Twilio Console → dashboard principal (junto al SID) |
| `TWILIO_NUMERO` | El número de Twilio desde el que se manda el SMS | Twilio Console → Phone Numbers (hay que comprar uno, ~$1 USD/mes) |

Si faltan estas variables, todo lo demás sigue funcionando igual — solo se
omite el SMS (el correo sí se manda, y queda anotado en los logs). Los
teléfonos de negocios sin código de país se asumen de México (`+52`)
automáticamente.

## Estructura del código

```
server.js              punto de entrada: conecta las rutas y arranca
src/
  config.js            planes, categorías y sus reglas — la fuente de verdad
  db.js                 esquema de SQLite
  auth.js               contraseñas (scrypt) y sesiones firmadas
  http.js               enrutador y servidor de archivos, sin frameworks
  negocios.js           reglas de negocio: qué ve el público vs. la dueña
  subidas.js            procesa las fotos que se suben (base64 → archivo)
  stripe.js              cliente de Stripe (se queda inerte si falta la llave)
  correo.js              correos por SendGrid (igual, inerte si falta la llave)
  sms.js                 SMS por Twilio (igual, inerte si falta la llave)
  mensajes.js            conversaciones entre usuarias y negocios
  seed.js               datos de demostración
  routes/               un archivo por grupo de endpoints (auth, negocios,
                        reseñas, favoritos, blog, administración, catálogo,
                        pagos, mensajes)
public/
  index.html            cascarón de la página
  css/estilos.css        estilos (compartidos con mia.html)
  js/app.js              todas las vistas; habla con la API por fetch()
data/                   base de datos y fotos subidas (no se versiona)
```

## Cómo ponerla en línea con un dominio real

Este servidor solo depende del SDK de Stripe (`npm install` lo resuelve solo)
y sirve tanto la API como los archivos del sitio, así que corre en cualquier
plataforma que ejecute Node 22. Render y Railway son las más sencillas para
empezar:

1. **Sube este repositorio a GitHub** (si no está ya) y conéctalo a Render o
   Railway — ambos lo detectan como proyecto Node automáticamente.
2. **Configura el servicio:**
   - Comando de arranque: `npm start`
   - Variable `PORT`: la pone la plataforma sola, el código ya la respeta.
   - Variable `MIA_SECRETO`: defínela tú con un texto largo y aleatorio (por
     ejemplo, generado con `openssl rand -hex 32`). Sin esto, cada reinicio
     del servidor invalida las sesiones de todo el mundo.
   - Las variables de Stripe (`STRIPE_PAYMENT_LINK_SUSCRIPCION`,
     `STRIPE_PAYMENT_LINK_MEMBRESIA`, `STRIPE_WEBHOOK_SECRET`,
     `STRIPE_SECRET_KEY`): ver la sección **Cobros automáticos con Stripe**
     más abajo.
3. **Agrega un disco persistente** montado en la carpeta `data/`. Esto es lo
   más importante y lo más fácil de olvidar: sin disco persistente, cada vez
   que la plataforma reinicie o vuelvas a desplegar, **se borran todos los
   negocios registrados**. Tanto Render como Railway ofrecen esto (a veces de
   paga, revisa el plan que elijas).
4. **Tu cuenta de administradora:** agrega las variables `ADMIN_CORREO` y
   `ADMIN_CLAVE` (tu correo real y una contraseña de al menos 8 caracteres).
   En el primer arranque, si todavía no existe ninguna administradora, MÍA
   crea automáticamente esa cuenta con rol de Organización MÍA — así no hace
   falta entrar por consola ni cargar datos de demostración. Una vez creada,
   puedes quitar esas dos variables si prefieres (no vuelve a usarlas mientras
   ya exista una administradora).
5. **Conecta tu dominio:** en la configuración del servicio agrega el dominio
   que compres (`mía.mx`, `mia.com.mx`, o el que elijas) y sigue las
   instrucciones de la plataforma para apuntar los DNS desde tu registrador —
   ambas plataformas emiten el certificado HTTPS automáticamente.

## Dominio

`mia.mx` ya está registrado por alguien más. Al momento de escribir esto,
`mía.mx` (con acento), `mia.com.mx` y `mia.org.mx` no tienen registros DNS, lo
que sugiere que están libres — hay que confirmarlo en un registrador antes de
contar con ellos.
