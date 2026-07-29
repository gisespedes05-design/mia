import { ErrorHttp, exigirSesion, exigirRol } from '../auth.js';
import { ROLES, reglasVigentes } from '../config.js';
import { obtenerNegocioPorId, texto } from '../negocios.js';
import { anotar } from '../db.js';
import {
  conversacionesDeNegocio, conversacionesDeUsuaria, obtenerConversacion,
  exigirParteDe, mensajesDe, marcarLeidos, escribirA,
} from '../mensajes.js';
import { enviarCorreo, correoNuevoMensaje } from '../correo.js';
import { enviarSms } from '../sms.js';

const MAXIMO = 2000;

async function avisarNegocioDeNuevoMensaje(negocio, usuaria, cuerpo) {
  const extracto = cuerpo.length > 140 ? cuerpo.slice(0, 140) + '…' : cuerpo;
  await enviarCorreo({
    para: negocio.propietaria_correo,
    ...correoNuevoMensaje(negocio.propietaria_nombre, negocio.nombre, usuaria.nombre, extracto),
  });
  await enviarSms({
    para: negocio.telefono,
    texto: `MÍA: tienes un nuevo mensaje de ${usuaria.nombre} para ${negocio.nombre}. Entra a tu panel para responder.`,
  });
}

/** Una usuaria le escribe por primera vez (o de nuevo) a un negocio. */
export async function escribir(ctx) {
  const usuaria = exigirRol(ctx, ROLES.USUARIO);
  const negocio = obtenerNegocioPorId(ctx.params.id);
  if (!negocio || negocio.estado !== 'publicado') throw new ErrorHttp(404, 'No encontramos ese negocio.');

  const cuerpo = texto(ctx.cuerpo.cuerpo, MAXIMO);
  if (cuerpo.length < 2) throw new ErrorHttp(400, 'Escribe tu mensaje.');

  const conversacionId = escribirA({ negocioId: negocio.id, usuarioId: usuaria.id, autor: 'usuario', cuerpo });
  anotar(usuaria.id, 'Escribió a un negocio', negocio.nombre);
  await avisarNegocioDeNuevoMensaje(negocio, usuaria, cuerpo);
  return { conversacionId };
}

/** Conversaciones de un negocio (panel de la dueña o de la administradora). */
export function listarDeNegocio(ctx) {
  const usuario = exigirSesion(ctx);
  const negocio = obtenerNegocioPorId(ctx.params.id);
  if (!negocio) throw new ErrorHttp(404, 'No encontramos ese negocio.');
  if (usuario.rol !== 'admin' && negocio.propietaria_id !== usuario.id) {
    throw new ErrorHttp(403, 'Ese negocio no es tuyo.');
  }
  return conversacionesDeNegocio(negocio.id);
}

/** Conversaciones de la usuaria que ha escrito a negocios. */
export function listarDeUsuaria(ctx) {
  const usuaria = exigirRol(ctx, ROLES.USUARIO);
  return conversacionesDeUsuaria(usuaria.id);
}

export function verHilo(ctx) {
  const usuario = exigirSesion(ctx);
  const conversacion = obtenerConversacion(Number(ctx.params.id));
  const lado = exigirParteDe(conversacion, usuario);
  marcarLeidos(conversacion.id, lado);
  const puedeResponder = lado === 'usuario' ||
    reglasVigentes(obtenerNegocioPorId(conversacion.negocio_id)).permisos.responder;
  return { conversacion, mensajes: mensajesDe(conversacion.id), lado, puedeResponder };
}

export async function responder(ctx) {
  const usuario = exigirSesion(ctx);
  const conversacion = obtenerConversacion(Number(ctx.params.id));
  const lado = exigirParteDe(conversacion, usuario);

  const cuerpo = texto(ctx.cuerpo.cuerpo, MAXIMO);
  if (cuerpo.length < 2) throw new ErrorHttp(400, 'Escribe tu respuesta.');

  if (lado === 'negocio') {
    const negocio = obtenerNegocioPorId(conversacion.negocio_id);
    if (!reglasVigentes(negocio).permisos.responder) {
      throw new ErrorHttp(403, 'Responder mensajes empieza en el plan Suscripción. Lo que ya recibiste no se pierde.');
    }
  }

  escribirA({ negocioId: conversacion.negocio_id, usuarioId: conversacion.usuario_id, autor: lado, cuerpo });
  if (lado === 'negocio') anotar(usuario.id, 'Respondió un mensaje', conversacion.negocio_nombre);

  return { mensajes: mensajesDe(conversacion.id) };
}
