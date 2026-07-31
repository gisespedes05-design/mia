# MÍA para Android

Esta carpeta convierte el sitio real de MÍA (`https://mia-c2mm.onrender.com`)
en una app de Android con [Capacitor](https://capacitorjs.com/). La app **no**
lleva una copia del sitio adentro: abre un WebView apuntando directo a la
página en vivo, así que cualquier cambio que se publique en el sitio se ve de
inmediato en la app, sin tener que subir una app nueva a la tienda.

Eso sí — si algún día cambia el dominio (por ejemplo, al comprar uno propio),
hay que actualizar `server.url` en `capacitor.config.json` y volver a compilar.

## Compilar sin instalar nada (recomendado)

Cada vez que se hace push a este repositorio y cambia algo dentro de `movil/`,
un flujo de GitHub Actions (`.github/workflows/build-android.yml`) compila la
app sola y deja dos archivos descargables en la pestaña **Actions** del
repositorio, dentro de "Artifacts":

- **mia-android-debug-apk** — un `.apk` para instalar directo en un celular
  Android y probar (hay que activar "orígenes desconocidos" al instalarlo).
- **mia-android-release-aab-sin-firmar** — el paquete `.aab` que pide Google
  Play, pero **todavía sin firmar** (ver siguiente sección).

También se puede lanzar a mano desde GitHub: Actions → "Compilar app de
Android" → "Run workflow".

## Compilar en tu propia computadora (opcional)

Se necesita tener instalado Node.js, Java 21 y el SDK de Android (lo más
fácil es instalar [Android Studio](https://developer.android.com/studio), que
ya trae todo).

```bash
cd movil
npm install
npx cap sync android
cd android
./gradlew assembleDebug      # genera el .apk de prueba
```

## Lo que falta para publicarla de verdad en Google Play

1. **Firmar la app.** Google Play exige que el `.aab` esté firmado con una
   llave que **nunca se pierda** — si se pierde, ya no se puede volver a
   actualizar esa misma app nunca más, hay que publicar una app nueva desde
   cero. Por eso no generamos una automáticamente: cuando quieras, dime y
   creamos la llave juntas, y la guardas tú misma en un lugar seguro (no
   solo en esta sesión, que es temporal) antes de usarla.
2. **Crear tu cuenta de Google Play Console** (https://play.google.com/console) —
   $25 USD, pago único, con tu propia cuenta de Google.
3. **Llenar la ficha de la tienda**: nombre, descripción, capturas de
   pantalla del celular, ícono (ya está listo en `assets/`), y el enlace al
   [aviso de privacidad](https://mia-c2mm.onrender.com/#/privacidad) (Google
   lo pide siempre).
4. **Subir el `.aab` firmado** y enviarlo a revisión. Google normalmente
   revisa en un par de días.

## Estructura

```
movil/
  capacitor.config.json   configuración: apunta al sitio en vivo
  assets/                 ícono e imágenes fuente para generar los íconos
  www/                    página en blanco de respaldo (Capacitor la exige,
                           pero casi nunca se ve: la app carga el sitio real)
  android/                proyecto nativo de Android generado por Capacitor
```
