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
| Precio | $0 | $199/mes | $599/mes | Desde $2,500/mes |
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
  seed.js               datos de demostración
  routes/               un archivo por grupo de endpoints (auth, negocios,
                        reseñas, favoritos, blog, administración, catálogo)
public/
  index.html            cascarón de la página
  css/estilos.css        estilos (compartidos con mia.html)
  js/app.js              todas las vistas; habla con la API por fetch()
data/                   base de datos y fotos subidas (no se versiona)
```

## Cómo ponerla en línea con un dominio real

Este servidor no tiene dependencias que instalar y sirve tanto la API como los
archivos del sitio, así que corre en cualquier plataforma que ejecute Node 22.
Render y Railway son las más sencillas para empezar:

1. **Sube este repositorio a GitHub** (si no está ya) y conéctalo a Render o
   Railway — ambos lo detectan como proyecto Node automáticamente.
2. **Configura el servicio:**
   - Comando de arranque: `npm start`
   - Variable `PORT`: la pone la plataforma sola, el código ya la respeta.
   - Variable `MIA_SECRETO`: defínela tú con un texto largo y aleatorio (por
     ejemplo, generado con `openssl rand -hex 32`). Sin esto, cada reinicio
     del servidor invalida las sesiones de todo el mundo.
3. **Agrega un disco persistente** montado en la carpeta `data/`. Esto es lo
   más importante y lo más fácil de olvidar: sin disco persistente, cada vez
   que la plataforma reinicie o vuelvas a desplegar, **se borran todos los
   negocios registrados**. Tanto Render como Railway ofrecen esto (a veces de
   paga, revisa el plan que elijas).
4. **Primera carga de datos:** entra a la consola/shell del servicio y corre
   `npm run seed` si quieres arrancar con cuentas de demostración, o déjalo
   vacío si prefieres que MÍA arranque sin nada y las primeras cuentas sean
   reales desde el día uno.
5. **Conecta tu dominio:** en la configuración del servicio agrega el dominio
   que compres (`mía.mx`, `mia.com.mx`, o el que elijas) y sigue las
   instrucciones de la plataforma para apuntar los DNS desde tu registrador —
   ambas plataformas emiten el certificado HTTPS automáticamente.

## Dominio

`mia.mx` ya está registrado por alguien más. Al momento de escribir esto,
`mía.mx` (con acento), `mia.com.mx` y `mia.org.mx` no tienen registros DNS, lo
que sugiere que están libres — hay que confirmarlo en un registrador antes de
contar con ellos.
