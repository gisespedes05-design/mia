# MÍA

Directorio inteligente y comunidad para negocios dirigidos por mujeres.
**MÍA no es un marketplace:** no cobra comisión sobre las ventas ni se mete
entre el negocio y su clienta. Lo que hace es que las encuentren.

## Qué hay en este repositorio

| Archivo | Qué es | Estado |
|---|---|---|
| `mia.html` | La aplicación completa, en un solo archivo | **Funciona y está probada** |
| `src/` | Andamiaje para la versión con servidor y base de datos compartida | Incompleto, no arranca todavía |

`mia.html` se abre en cualquier navegador sin instalar nada. Guarda los datos
en el navegador de quien la abre (`localStorage`), así que sirve para ver y
enseñar la plataforma, **pero no comparte información entre personas**. Para
que una mujer en Oaxaca registre su negocio y alguien en Monterrey lo vea hace
falta la versión con servidor.

## Cómo entrar

Hay tres tipos de cuenta. Todas entran por la misma pantalla y cada una ve algo
distinto. La sección **Entrar** trae botones de acceso rápido.

| Tipo de cuenta | Correo | Contraseña | Qué puede hacer |
|---|---|---|---|
| Organización MÍA | `admin@mia.mx` | `mia2026` | Publicar, rechazar y suspender perfiles; confirmar pagos; cambiar planes; verificar; administrar cuentas; moderar reseñas; escribir el blog; descargar solicitudes |
| Negocio (Membresía) | `lucia@mia.mx` | `demo1234` | Administrar su perfil con todo abierto |
| Negocio (Gratuito) | `beatriz@mia.mx` | `demo1234` | Igual, pero con los avisos de lo que su plan le oculta |
| Clienta | `daniela@mia.mx` | `demo1234` | Buscar negocios, dejar reseñas y guardar favoritos |

## Secciones

**Inicio · Productos y Servicios · Mapa · Blog · Sobre MÍA**

Cada negocio pertenece a **una categoría principal** y puede estar en **hasta
cinco subcategorías**. Las 18 categorías —Belleza, Moda, Repostería y
Alimentos, Eventos, Flores y Regalos, Hogar y Decoración, Salud y Bienestar,
Fitness y Deporte, Educación, Arte y Diseño, Mascotas, Automotriz, Turismo,
Maternidad e Infancia, Fotografía y Producción, Servicios Profesionales,
Sustentabilidad, y Artesanías y Hecho a Mano— las definió MÍA, con sus
subcategorías. Se ajustan desde `src/config.js` o desde `mia.html`.

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
reuniones y acompañamiento personalizado. Su precio es *desde*: los $2,500 son el punto de partida y el precio final
depende de los servicios que necesite cada negocio y del plan personalizado que
se le arme. No se cobra automático — MÍA cotiza el alcance y hasta entonces se
activan los beneficios.

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
No hay exportación a hojas de cálculo ni a ningún servicio externo — todo se
revisa y se marca como atendido dentro de la misma página.

## Versión con servidor

`src/` tiene la base para cuando MÍA necesite datos compartidos: esquema de
base de datos (SQLite), contraseñas cifradas con scrypt, sesiones firmadas y
las reglas de plan aplicadas del lado del servidor. Le faltan las rutas HTTP y
el arranque. Requiere Node 22 o superior y no usa dependencias externas.

## Dominio

`mia.mx` ya está registrado por alguien más. Al momento de escribir esto,
`mía.mx` (con acento), `mia.com.mx` y `mia.org.mx` no tienen registros DNS, lo
que sugiere que están libres — hay que confirmarlo en un registrador antes de
contar con ellos.
