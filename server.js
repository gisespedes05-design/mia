import { createServer } from 'node:http';
import { join } from 'node:path';
import { Enrutador, crearManejador } from './src/http.js';
import { RAIZ, DIR_SUBIDAS } from './src/db.js';
import { PUERTO } from './src/config.js';

import * as auth from './src/routes/auth.js';
import * as negocios from './src/routes/negocios.js';
import * as resenas from './src/routes/resenas.js';
import * as favoritos from './src/routes/favoritos.js';
import * as admin from './src/routes/admin.js';
import * as blog from './src/routes/blog.js';
import * as catalogo from './src/routes/catalogo.js';
import * as pagos from './src/routes/pagos.js';

const r = new Enrutador();

// --------------------------------------------------------------- catálogo --
r.get('/api/categorias', catalogo.categorias);
r.get('/api/planes', catalogo.planes);

// ------------------------------------------------------------------ auth --
r.post('/api/auth/registro-clienta', auth.registrarClienta);
r.post('/api/auth/registro-negocio', auth.registrarNegocio);
r.post('/api/auth/entrar', auth.entrar);
r.post('/api/auth/salir', auth.salir);
r.get('/api/auth/yo', auth.yo);
r.post('/api/auth/clave', auth.cambiarClave);

// -------------------------------------------------------------- negocios --
// Las rutas literales van antes que ":slug" para que no las intercepte.
r.get('/api/negocios/mapa', negocios.mapa);
r.get('/api/mis-negocios', negocios.misNegocios);
r.get('/api/negocios', negocios.listar);
r.get('/api/negocios/:id/panel', negocios.verPanel);
r.get('/api/negocios/:slug', negocios.verDetalle);
r.patch('/api/negocios/:id', negocios.actualizar);
r.post('/api/negocios/:id/enviar-revision', negocios.enviarRevision);
r.post('/api/negocios/:id/pago/iniciar', pagos.crearCheckout);
r.post('/api/negocios/:id/pago/portal', pagos.crearPortal);
r.post('/api/negocios/:id/logo', negocios.subirLogo);
r.delete('/api/negocios/:id/logo', negocios.quitarLogo);
r.post('/api/negocios/:id/fotos', negocios.subirFoto);
r.delete('/api/negocios/:id/fotos/:fotoId', negocios.quitarFoto);
r.post('/api/negocios/:id/productos', negocios.agregarProducto);
r.patch('/api/negocios/:id/productos/:productoId', negocios.alternarProductoDestacado);
r.delete('/api/negocios/:id/productos/:productoId', negocios.quitarProducto);
r.post('/api/negocios/:id/publicaciones', negocios.agregarPublicacion);
r.patch('/api/negocios/:id/publicaciones/:publicacionId', negocios.alternarPublicacionDestacada);
r.delete('/api/negocios/:id/publicaciones/:publicacionId', negocios.quitarPublicacion);

// --------------------------------------------------------------- reseñas --
r.post('/api/negocios/:id/resenas', resenas.crearOActualizar);
r.delete('/api/resenas/:id', resenas.borrar);
r.post('/api/resenas/:id/responder', resenas.responder);

// ------------------------------------------------------------- favoritos --
r.get('/api/favoritos', favoritos.listar);
r.post('/api/favoritos/:negocioId', favoritos.agregar);
r.delete('/api/favoritos/:negocioId', favoritos.quitar);

// ------------------------------------------------------------------ blog --
r.get('/api/blog', blog.listar);
r.get('/api/blog/:slug', blog.verDetalle);
r.post('/api/admin/blog', blog.crear);
r.patch('/api/admin/blog/:id', blog.alternarPublicado);
r.delete('/api/admin/blog/:id', blog.borrar);

// ----------------------------------------------------------------- admin --
r.get('/api/admin/resumen', admin.resumen);
r.get('/api/admin/solicitudes', admin.listarSolicitudes);
r.patch('/api/admin/solicitudes/:id', admin.alternarSolicitud);
r.get('/api/admin/negocios', admin.listarNegocios);
r.post('/api/admin/negocios/:id/aprobar', admin.aprobar);
r.post('/api/admin/negocios/:id/rechazar', admin.rechazar);
r.post('/api/admin/negocios/:id/suspender', admin.suspender);
r.patch('/api/admin/negocios/:id/verificado', admin.alternarVerificado);
r.patch('/api/admin/negocios/:id/plan', admin.cambiarPlan);
r.post('/api/admin/negocios/:id/confirmar-pago', admin.confirmarPago);
r.get('/api/admin/usuarias', admin.listarUsuarias);
r.patch('/api/admin/usuarias/:id/rol', admin.cambiarRol);
r.patch('/api/admin/usuarias/:id/suspension', admin.alternarSuspensionUsuaria);
r.get('/api/admin/resenas', admin.listarResenas);
r.patch('/api/admin/resenas/:id/oculta', admin.alternarResenaOculta);
r.get('/api/admin/bitacora', admin.listarBitacora);
r.get('/api/admin/pagos', admin.listarPagos);

// ------------------------------------------------------- Stripe webhook --
r.post('/api/pagos/webhook', pagos.webhook);

const manejador = crearManejador({
  enrutador: r,
  dirPublico: join(RAIZ, 'public'),
  dirSubidas: DIR_SUBIDAS,
});

createServer(manejador).listen(PUERTO, () => {
  console.log(`MÍA corriendo en http://localhost:${PUERTO}`);
});
