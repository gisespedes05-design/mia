import { createServer } from 'node:http';
import { join } from 'node:path';
import { Enrutador, crearManejador } from './src/http.js';
import { RAIZ, DIR_DATOS, DIR_SUBIDAS } from './src/db.js';
import { PUERTO } from './src/config.js';
import { crearAdminInicialSiHaceFalta } from './src/auth.js';

crearAdminInicialSiHaceFalta();

import * as auth from './src/routes/auth.js';
import * as negocios from './src/routes/negocios.js';
import * as resenas from './src/routes/resenas.js';
import * as favoritos from './src/routes/favoritos.js';
import * as admin from './src/routes/admin.js';
import * as blog from './src/routes/blog.js';
import * as catalogo from './src/routes/catalogo.js';
import * as pagos from './src/routes/pagos.js';
import * as mensajes from './src/routes/mensajes.js';
import * as notificaciones from './src/routes/notificaciones.js';
import { revisarConsultasPendientes } from './src/seguimientoVentas.js';

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
r.get('/api/mis-mensajes', mensajes.listarDeUsuaria);
r.get('/api/negocios', negocios.listar);
r.get('/api/negocios/:id/panel', negocios.verPanel);
r.get('/api/negocios/:id/mensajes', mensajes.listarDeNegocio);
r.post('/api/negocios/:id/mensajes', mensajes.escribir);
r.get('/api/mensajes/:id', mensajes.verHilo);
r.post('/api/mensajes/:id/responder', mensajes.responder);
r.get('/api/negocios/:slug', negocios.verDetalle);
r.patch('/api/negocios/:id', negocios.actualizar);
r.post('/api/negocios/:id/enviar-revision', negocios.enviarRevision);
r.post('/api/negocios/:id/interaccion', negocios.registrarInteraccion);
r.get('/api/negocios/:id/reporte', negocios.verReporte);
r.get('/api/negocios/:id/consultas', negocios.verConsultas);
r.patch('/api/negocios/:id/consultas/:consultaId', negocios.resolverConsultaProducto);
r.post('/api/negocios/:id/pago/iniciar', pagos.crearCheckout);
r.post('/api/negocios/:id/pago/portal', pagos.crearPortal);
r.post('/api/negocios/:id/logo', negocios.subirLogo);
r.delete('/api/negocios/:id/logo', negocios.quitarLogo);
r.post('/api/negocios/:id/banner', negocios.subirBanner);
r.delete('/api/negocios/:id/banner', negocios.quitarBanner);
r.post('/api/negocios/:id/foto-destacada', negocios.subirFotoDestacada);
r.delete('/api/negocios/:id/foto-destacada', negocios.quitarFotoDestacada);
r.post('/api/negocios/:id/fotos', negocios.subirFoto);
r.delete('/api/negocios/:id/fotos/:fotoId', negocios.quitarFoto);
r.post('/api/negocios/:id/productos', negocios.agregarProducto);
r.patch('/api/negocios/:id/productos/:productoId', negocios.alternarProductoDestacado);
r.delete('/api/negocios/:id/productos/:productoId', negocios.quitarProducto);
r.post('/api/negocios/:id/productos/:productoId/consultar', mensajes.consultarProducto);
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

// --------------------------------------------------------- seguidores --
r.post('/api/negocios/:id/seguir', notificaciones.alternarSeguir);
r.get('/api/mis-seguidos', notificaciones.misSeguidos);
r.get('/api/notificaciones', notificaciones.misNotificaciones);
r.post('/api/notificaciones/:id/leida', notificaciones.marcarLeida);
r.post('/api/notificaciones/marcar-leidas', notificaciones.marcarTodasLeidas);

// ------------------------------------------------------------------ blog --
r.get('/api/blog', blog.listar);
r.get('/api/blog/:slug', blog.verDetalle);
r.post('/api/admin/blog', blog.crear);
r.post('/api/admin/blog/:id/fotos', blog.subirFoto);
r.delete('/api/admin/blog/:id/fotos/:fotoId', blog.quitarFoto);
r.patch('/api/admin/blog/:id', blog.alternarPublicado);
r.delete('/api/admin/blog/:id', blog.borrar);
r.post('/api/blog/:id/comentarios', blog.comentar);
r.delete('/api/blog/comentarios/:id', blog.borrarComentario);
r.post('/api/blog/:id/reaccion', blog.reaccionar);

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
r.patch('/api/admin/negocios/:id/enlace-pago', admin.establecerEnlacePago);
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
  // Sin disco persistente montado exactamente aquí, cada despliegue borra
  // todo lo registrado. Esta ruta es la que hay que poner como "Mount Path"
  // del disco en Render (o la plataforma que sea).
  console.log(`Carpeta de datos (para el disco persistente): ${DIR_DATOS}`);
});

// Le pregunta a los negocios si se concretaron sus ventas: a las 48h y, si no
// contestan, un único recordatorio a las 96h. Se revisa cada hora; también al
// arrancar, por si el servidor estuvo apagado cuando le tocaba a alguna.
revisarConsultasPendientes();
setInterval(revisarConsultasPendientes, 60 * 60 * 1000);
