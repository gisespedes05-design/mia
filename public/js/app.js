"use strict";
/* ===================================================================== API */
/* Todo pasa por el servidor: nada se guarda en el navegador. La cookie de
   sesión la pone y la lee el propio servidor (HttpOnly), así que aquí solo
   hace falta mandar `credentials:"same-origin"` para que viaje sola. */

class ErrorApi extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status; }
}

async function pedir(metodo, ruta, cuerpo) {
  const resp = await fetch(ruta, {
    method: metodo,
    credentials: "same-origin",
    headers: cuerpo !== undefined ? { "Content-Type": "application/json" } : {},
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await resp.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = null; }
  if (!resp.ok) throw new ErrorApi(resp.status, (datos && datos.error) || "Ocurrió un error inesperado.");
  return datos;
}

const api = {
  get: (ruta) => pedir("GET", ruta),
  post: (ruta, cuerpo) => pedir("POST", ruta, cuerpo ?? {}),
  patch: (ruta, cuerpo) => pedir("PATCH", ruta, cuerpo ?? {}),
  del: (ruta) => pedir("DELETE", ruta),
};

/* ================================================================= ESTADO */
/* Lo único que se guarda en el cliente es lo que ya es público y cambia
   poco: categorías y planes. La sesión se vuelve a preguntar al servidor
   cada vez que hace falta saber quién eres. */
let CATEGORIAS = [];
let PLANES = {};
let ORDEN_PLANES = [];
let YO = null;

const MAX_SUBCATEGORIAS = 5;

// Los únicos dos planes que se cobran solos, sin que nadie de MÍA intervenga.
// Crece con MÍA no entra aquí a propósito: se cotiza y se confirma a mano.
const PLANES_AUTOMATIZADOS = ["suscripcion", "membresia"];

/** Manda a pagar con Stripe. Sale de verdad del sitio: no es un cambio de hash. */
async function iniciarPago(negocioId, plan) {
  try {
    const { url } = await api.post("/api/negocios/" + negocioId + "/pago/iniciar", { plan });
    window.location.href = url;
  } catch (err) { avisarError(err); }
}

/** Portal de Stripe: para que la dueña vea sus facturas, cambie su tarjeta o cancele ella misma. */
async function abrirPortalPago(negocioId) {
  try {
    const { url } = await api.post("/api/negocios/" + negocioId + "/pago/portal");
    window.location.href = url;
  } catch (err) { avisarError(err); }
}

async function arrancar() {
  const [categorias, planes, sesion] = await Promise.all([
    api.get("/api/categorias"),
    api.get("/api/planes"),
    api.get("/api/auth/yo"),
  ]);
  CATEGORIAS = categorias;
  PLANES = {};
  ORDEN_PLANES = planes.map((p) => {
    // Infinity no existe en JSON: el servidor manda null y aquí se restaura,
    // para que el resto del código pueda seguir comparando con Infinity.
    const limites = { ...p.limites };
    for (const k of Object.keys(limites)) if (limites[k] === null) limites[k] = Infinity;
    PLANES[p.id] = { ...p, limites };
    return p.id;
  });
  YO = sesion;
  avisarRetornoDeStripe();
  pintar();
}

/**
 * Si el Payment Link de Stripe está configurado para volver a MÍA después de
 * pagar, esto avisa el resultado y limpia el "?pago=" de la URL. Si Stripe
 * no vuelve aquí (se quedó en su propia pantalla de confirmación), no pasa
 * nada: el webhook ya activó el plan de todas formas.
 */
function avisarRetornoDeStripe() {
  const parametros = new URLSearchParams(location.search);
  const resultado = parametros.get("pago");
  if (!resultado) return;
  history.replaceState(null, "", location.pathname + location.hash);
  if (resultado === "exito") avisar("¡Pago recibido! Tu plan se activa en cuanto Stripe lo confirme (unos segundos).");
  else if (resultado === "cancelado") avisar("Cancelaste el pago. Tu perfil sigue con las reglas del plan Gratuito.");
}

async function refrescarSesion() {
  YO = await api.get("/api/auth/yo");
}

const cat = (id) => CATEGORIAS.find((c) => c.id === id) || CATEGORIAS[CATEGORIAS.length - 1] || { nombre: "", icono: "", sub: [] };
const esAdmin = () => YO?.rol === "admin";

/* ================================================================ ESTADOS */
const ESTADOS = {
  borrador: { et: "Borrador", chip: "" },
  pendiente: { et: "Esperando revisión", chip: "sol" },
  publicado: { et: "Publicado", chip: "jade" },
  rechazado: { et: "Necesita cambios", chip: "peligro" },
  suspendido: { et: "Suspendido por MÍA", chip: "peligro" },
};

/* ================================================================= CIUDADES */
/* Solo sirve para ubicar los pines en el mapa y llenar el <select> de
   ciudad; no es una regla de negocio, así que no hace falta que venga del
   servidor. */
const CIUDADES = {
  "Ciudad de México": [-99.13, 19.43], "Guadalajara": [-103.35, 20.67], "Monterrey": [-100.31, 25.69],
  "Puebla": [-98.21, 19.04], "Querétaro": [-100.39, 20.59], "Mérida": [-89.62, 20.97],
  "Cancún": [-86.85, 21.16], "Tijuana": [-117.02, 32.51], "León": [-101.68, 21.12],
  "Oaxaca de Juárez": [-96.73, 17.07], "San Luis Potosí": [-100.98, 22.15], "Aguascalientes": [-102.29, 21.88],
  "Toluca": [-99.66, 19.29], "Culiacán": [-107.39, 24.80], "Hermosillo": [-110.96, 29.07],
  "Chihuahua": [-106.07, 28.63], "Veracruz": [-96.13, 19.17], "Xalapa": [-96.92, 19.53],
  "Morelia": [-101.19, 19.71], "Cuernavaca": [-99.23, 18.92], "Tuxtla Gutiérrez": [-93.11, 16.75],
  "Villahermosa": [-92.93, 17.99], "Saltillo": [-101.00, 25.42], "Durango": [-104.65, 24.02],
  "Zacatecas": [-102.58, 22.77], "Tepic": [-104.89, 21.51], "Colima": [-103.72, 19.24],
  "Pachuca": [-98.74, 20.12], "Tlaxcala": [-98.24, 19.32], "Campeche": [-90.53, 19.83],
  "Chetumal": [-88.30, 18.50], "La Paz": [-110.31, 24.14], "Mexicali": [-115.45, 32.62],
  "Ciudad Victoria": [-99.14, 23.74], "Playa del Carmen": [-87.07, 20.63], "Puerto Vallarta": [-105.23, 20.62],
  "San Cristóbal de las Casas": [-92.64, 16.74], "Guanajuato": [-101.26, 21.02], "Acapulco": [-99.88, 16.86],
  "Mazatlán": [-106.42, 23.25], "Tampico": [-97.87, 22.25], "Irapuato": [-101.35, 20.68],
};
const ENTIDADES_CIUDAD = Object.keys(CIUDADES).sort((a, b) => a.localeCompare(b, "es"));

/* ================================================================= UTILIDAD */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id) ? $(id).value.trim() : "");

function avisar(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("ver");
  clearTimeout(avisar._t); avisar._t = setTimeout(() => t.classList.remove("ver"), 3400);
}

function avisarError(err) {
  avisar(err instanceof ErrorApi ? err.message : "Ocurrió un error. Intenta de nuevo.");
}

const pesos = (v) => (v === null || v === undefined || v === "") ? ""
  : "$" + Number(v).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function fecha(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return isNaN(d) ? iso : d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

/* --------------------------------------------------------------- estrellas */
const estrellasHtml = (v) => v
  ? '<span class="estrellas" aria-label="' + v + ' de 5">' + "★".repeat(Math.round(v)) +
    "☆".repeat(5 - Math.round(v)) + "</span>"
  : '<span class="apagado diminuto">Sin reseñas</span>';

/* ---------------------------------------------------------------- imágenes */
const TONOS = [["#B35A8A", "#6B3459"], ["#7880AE", "#454B72"], ["#523F77", "#2E2247"],
  ["#4A6E96", "#2A3F57"], ["#0B7A5E", "#053F30"], ["#B8860B", "#5C4406"]];
const tonoDe = (txt) => TONOS[[...String(txt)].reduce((a, c) => a + c.charCodeAt(0), 0) % TONOS.length];

function imagenHtml(src, alt, clase) {
  if (src) return '<img class="' + (clase || "") + '" src="' + esc(src) + '" alt="' + esc(alt || "") + '">';
  const t = tonoDe(alt || "M");
  return '<div class="' + (clase || "") + '" style="width:100%;height:100%;background:linear-gradient(135deg,' +
    t[0] + "," + t[1] + ')"></div>';
}

function logoHtml(n, grande) {
  const clase = "logo-negocio" + (grande ? " grande" : "");
  if (n.logo) return '<img class="' + clase + '" src="' + esc(n.logo) + '" alt="Logo de ' + esc(n.nombre) + '">';
  const t = tonoDe(n.nombre);
  return '<div class="' + clase + ' logo-vacio" style="background:linear-gradient(135deg,' +
    t[0] + "," + t[1] + ')">' + esc((n.nombre || "M").trim()[0] || "M") + "</div>";
}

/** El primer plano de un negocio: la portada pública, o la primera foto capturada. */
function primeraFotoUrl(n) {
  if (n.portada) return n.portada;
  if (Array.isArray(n.fotos) && n.fotos.length) {
    const f = n.fotos[0];
    return typeof f === "string" ? f : f.url;
  }
  return null;
}

function portadaHtml(n, alto) {
  const f = primeraFotoUrl(n);
  const estilo = alto ? ' style="aspect-ratio:21/9"' : "";
  return '<div class="portada"' + estilo + ">" +
    (f ? imagenHtml(f, n.nombre) :
      '<div style="position:absolute;inset:0;background:linear-gradient(135deg,' +
      tonoDe(n.nombre).join(",") + ')"></div><span class="inicial">' +
      esc((n.nombre || "M").trim()[0] || "M") + "</span>") + "</div>";
}
/* ===================================================================== RUTAS */
function ruta() {
  const h = (location.hash || "#/inicio").replace(/^#\/?/, "");
  const p = h.split("/").filter(Boolean);
  return { vista: p[0] || "inicio", arg: p[1] ? decodeURIComponent(p[1]) : null,
    arg2: p[2] ? decodeURIComponent(p[2]) : null };
}

const MENU_PUBLICO = [["inicio", "Inicio"], ["directorio", "Productos y Servicios"],
  ["mapa", "Mapa"], ["blog", "Blog"], ["sobre", "Sobre MÍA"]];

function menu() {
  const v = ruta().vista;
  let items = MENU_PUBLICO.map(([h, t]) =>
    '<a href="#/' + h + '" class="' + (v === h ? "activo" : "") + '">' + t + "</a>").join("");
  if (!YO) {
    items += '<a href="#/planes" class="' + (v === "planes" ? "activo" : "") + '">Planes</a>' +
      '<a href="#/entrar" class="btn chico" style="margin-left:6px">Entrar</a>';
  } else {
    if (YO.rol === "admin") items += '<a href="#/admin" class="' + (v === "admin" ? "activo" : "") + '">Administración</a>';
    if (YO.rol === "negocio") items += '<a href="#/panel" class="' + (v === "panel" ? "activo" : "") + '">Mi negocio</a>';
    if (YO.rol === "usuario") items += '<a href="#/favoritos" class="' + (v === "favoritos" ? "activo" : "") + '">Favoritos</a>';
    items += '<button class="btn fantasma chico" onclick="salir()">Salir</button>';
  }
  $("menu").innerHTML = items;
}

/** Cada vista es una función async que arma su propio HTML. */
async function pintar() {
  const { vista, arg } = ruta();
  const app = $("app");
  app.setAttribute("aria-busy", "true");
  try {
    let html;
    if (vista === "directorio") html = arg ? await vistaCategoria(arg) : await vistaDirectorio();
    else if (vista === "negocio") html = await vistaNegocio(arg);
    else if (vista === "mapa") html = await vistaMapa();
    else if (vista === "blog") html = arg ? await vistaArticulo(arg) : await vistaBlog();
    else if (vista === "sobre") html = vistaSobre();
    else if (vista === "planes") html = vistaPlanes();
    else if (vista === "registro") html = vistaRegistro(arg);
    else if (vista === "entrar") html = vistaEntrar();
    else if (vista === "ayuda") html = vistaAyuda();
    else if (vista === "favoritos") html = YO ? await vistaFavoritos() : sinAcceso();
    else if (vista === "panel") html = YO && (YO.rol === "negocio" || YO.rol === "admin") ? await vistaPanel() : sinAcceso();
    else if (vista === "editar") html = YO ? await vistaEditar(arg) : sinAcceso();
    else if (vista === "admin") html = esAdmin() ? await vistaAdmin(arg) : sinAcceso();
    else html = await vistaInicio();

    app.innerHTML = html;
  } catch (err) {
    app.innerHTML = '<div class="envoltura bloque"><h2>No se pudo cargar esta página</h2>' +
      '<p class="apagado" style="margin-top:10px">' + esc(err instanceof ErrorApi ? err.message : String(err)) + "</p>" +
      '<p style="margin-top:14px"><a class="btn" href="#/inicio">Volver al inicio</a></p></div>';
  }
  app.removeAttribute("aria-busy");
  menu();
  window.scrollTo(0, 0);
  if (vista === "mapa") dibujarMapa(ultimoMapa);
}

function sinAcceso() {
  return '<div class="envoltura bloque pila g16" style="max-width:520px">' +
    "<h2>Esta sección no es para tu tipo de cuenta</h2>" +
    '<p class="apagado">En MÍA cada quien ve lo suyo: la organización administra, los negocios ' +
    "editan su perfil y las visitantes dejan reseñas y guardan favoritos.</p>" +
    '<div class="fila g8"><a class="btn" href="#/entrar">Entrar</a>' +
    '<a class="btn linea" href="#/ayuda">Ver las cuentas de prueba</a></div></div>';
}

const vacio = (msg) => '<div class="tarjeta p24 pila g8"><h3>Nada por aquí todavía</h3>' +
  '<p class="apagado pequeno">' + esc(msg) + "</p></div>";

const escalon = (n, t, d) => '<div class="escalon"><span class="num">' + n + "</span>" +
  "<div><strong>" + esc(t) + '</strong><p class="pequeno apagado">' + esc(d) + "</p></div></div>";

window.addEventListener("hashchange", pintar);

/* ==================================================================== SESIÓN */
async function entrar(correo, clave) {
  try {
    await api.post("/api/auth/entrar", { correo, clave });
    await refrescarSesion();
    location.hash = YO.rol === "admin" ? "#/admin" : YO.rol === "negocio" ? "#/panel" : "#/inicio";
    await pintar();
    avisar("Bienvenida, " + YO.nombre.split(" ")[0] + ".");
    return null;
  } catch (err) {
    return err instanceof ErrorApi ? err.message : "No se pudo iniciar sesión.";
  }
}

async function salir() {
  await api.post("/api/auth/salir");
  YO = null;
  location.hash = "#/inicio";
  await pintar();
  avisar("Cerraste tu sesión.");
}

const CUENTAS_DEMO = {
  "admin@mia.mx": "mia2026", "lucia@mia.mx": "demo1234", "beatriz@mia.mx": "demo1234",
  "daniela@mia.mx": "demo1234", "rosario@mia.mx": "demo1234", "anasofia@mia.mx": "demo1234",
  "carmen@mia.mx": "demo1234", "paulina@mia.mx": "demo1234",
};
async function accesoRapido(correo) {
  const err = await entrar(correo, CUENTAS_DEMO[correo]);
  if (err) avisar(err);
}

/* ==================================================================== MAPA */
/* Contorno aproximado de México. Es esquemático, no cartográfico: sirve para
   ubicar los negocios por ciudad sin depender de mapas externos. */
const MEXICO = [[-114.8, 31.8], [-113.0, 31.3], [-112.3, 30.0], [-112.8, 28.5], [-111.5, 27.0],
  [-110.5, 25.5], [-109.4, 23.5], [-108.0, 22.5], [-106.4, 21.5], [-105.7, 20.5], [-105.3, 19.9],
  [-104.4, 19.2], [-103.5, 18.8], [-102.2, 17.9], [-101.0, 17.3], [-99.9, 16.7], [-98.0, 16.2],
  [-96.5, 15.7], [-95.0, 15.9], [-94.0, 16.2], [-93.0, 15.7], [-92.2, 14.6], [-91.7, 15.1],
  [-91.5, 16.1], [-90.4, 16.1], [-90.5, 17.3], [-89.2, 17.8], [-88.3, 18.5], [-87.8, 19.6],
  [-87.4, 20.5], [-86.9, 21.2], [-88.0, 21.6], [-89.7, 21.5], [-90.4, 21.0], [-90.6, 19.8],
  [-91.6, 18.7], [-92.9, 18.5], [-94.5, 18.2], [-95.8, 18.7], [-96.4, 19.5], [-97.2, 20.7],
  [-97.6, 22.2], [-97.8, 23.8], [-97.7, 25.9], [-97.2, 26.0], [-99.5, 27.6], [-101.4, 29.8],
  [-103.0, 29.0], [-104.5, 29.6], [-106.5, 31.8], [-111.0, 31.3], [-114.8, 32.5]];
const BAJA = [[-114.7, 32.5], [-117.1, 32.5], [-116.9, 31.0], [-116.0, 29.5], [-115.2, 28.0],
  [-114.2, 27.0], [-112.9, 26.0], [-112.2, 24.5], [-111.0, 23.4], [-109.9, 22.9], [-109.5, 23.5],
  [-110.5, 24.5], [-111.5, 25.8], [-112.5, 27.5], [-113.5, 29.0], [-114.3, 30.5], [-114.7, 31.7]];

const LIM = { oe: -118.5, es: -85.5, no: 33.5, su: 14.0 };
const AN = 900, AL = 620;
const proyectar = ([lng, lat]) => [
  ((lng - LIM.oe) / (LIM.es - LIM.oe)) * AN,
  ((LIM.no - lat) / (LIM.no - LIM.su)) * AL,
];
const trazo = (pts) => pts.map(proyectar).map(([x, y], i) =>
  (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1)).join(" ") + " Z";

let ultimoMapa = [];

function dibujarMapa(negocios) {
  const caja = $("mapa"); if (!caja) return;

  const porCiudad = {};
  for (const n of negocios) if (CIUDADES[n.ciudad]) (porCiudad[n.ciudad] = porCiudad[n.ciudad] || []).push(n);

  const pins = Object.entries(porCiudad).map(([ciudad, lista]) => {
    const [x, y] = proyectar(CIUDADES[ciudad]);
    return lista.map((n, i) => {
      const ang = i * (Math.PI * 2 / Math.max(lista.length, 1));
      const rad = lista.length > 1 ? 9 : 0;
      const cx = x + Math.cos(ang) * rad, cy = y + Math.sin(ang) * rad;
      const clase = n.plan === "membresia" || n.plan === "crece" ? "membresia" : "suscripcion";
      return '<g class="pin ' + clase + '" onclick="location.hash=\'#/negocio/' + esc(n.slug) + '\'">' +
        "<title>" + esc(n.nombre + " — " + ciudad) + "</title>" +
        '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="7"></circle></g>';
    }).join("") +
    '<text x="' + (x + 11).toFixed(1) + '" y="' + (y + 4).toFixed(1) +
      '" font-size="12" fill="currentColor" opacity=".62">' + esc(ciudad) + "</text>";
  }).join("");

  caja.innerHTML = '<svg viewBox="0 0 ' + AN + " " + AL + '" role="img" ' +
    'aria-label="Mapa de México con los negocios de MÍA">' +
    '<path class="tierra" d="' + trazo(MEXICO) + '"></path>' +
    '<path class="tierra" d="' + trazo(BAJA) + '"></path>' + pins + "</svg>";
}
/* ==================================================================== INICIO */
async function vistaInicio() {
  const { resultados } = await api.get("/api/negocios?porPagina=48");
  const destacados = resultados.slice(0, 6);
  const arts = (await api.get("/api/blog")).slice(0, 2);

  const ultimas = resultados
    .filter((n) => n.ultimaPublicacion)
    .sort((a, b) => String(b.ultimaPublicacion.creado_en).localeCompare(String(a.ultimaPublicacion.creado_en)))
    .slice(0, 3);

  return (
  '<section class="hero"><div class="envoltura">' +
    '<p class="eyebrow">Directorio y comunidad</p>' +
    "<h1>Negocios dirigidos por mujeres</h1>" +
    '<p class="entrada">MÍA no vende por ti ni cobra comisión. Te ayudamos a que te ' +
    "encuentren: un directorio ordenado por categorías, un mapa y una comunidad que te acompaña.</p>" +
    '<div class="buscador">' +
      '<input id="q" placeholder="Busca maquillaje, pasteles, contabilidad…" ' +
        'onkeydown="if(event.key===\'Enter\')buscarDesdeInicio()" aria-label="Buscar negocios">' +
      '<button class="btn claro" onclick="buscarDesdeInicio()">Buscar</button>' +
    "</div>" +
  "</div></section>" +

  '<div class="envoltura bloque pila g48">' +
    '<div class="pila g16">' +
      '<div class="fila entre g12"><h2>Explora por categoría</h2>' +
      '<a class="btn fantasma chico" href="#/directorio">Ver todas</a></div>' +
      '<div class="rejilla cats">' + CATEGORIAS.slice(0, 8).map((c) => {
        const cuantos = resultados.filter((n) => n.categoria === c.id).length;
        return '<a class="tarjeta-cat" href="#/directorio/' + c.id + '">' +
          "<strong>" + c.icono + " " + esc(c.nombre) + "</strong>" +
          '<span class="diminuto apagado">' + c.sub.slice(0, 3).join(" · ") +
          (c.sub.length > 3 ? "…" : "") + "</span>" +
          '<span class="diminuto apagado">' + cuantos +
          (cuantos === 1 ? " negocio" : " negocios") + "</span></a>";
      }).join("") + "</div>" +
    "</div>" +

    '<div class="pila g16">' +
      '<div class="fila entre g12"><h2>Negocios de la comunidad</h2>' +
      '<a class="btn fantasma chico" href="#/directorio">Ver el directorio</a></div>' +
      (destacados.length ? '<div class="rejilla">' + destacados.map(tarjeta).join("") + "</div>"
        : vacio("Todavía no hay negocios publicados.")) +
    "</div>" +

    (ultimas.length ? '<div class="pila g16"><h2>Lo último de las emprendedoras</h2>' +
      '<div class="rejilla dos">' + ultimas.map((n) =>
        '<a class="publicacion' + (n.ultimaPublicacion.destacada ? " destacada" : "") +
        '" style="text-decoration:none" href="#/negocio/' + esc(n.slug) + '">' +
        '<div class="fila g8">' + logoHtml(n) +
          '<div><strong class="pequeno">' + esc(n.nombre) + "</strong>" +
          '<p class="diminuto apagado">' + esc(fecha(n.ultimaPublicacion.creado_en)) + "</p></div></div>" +
        "<strong>" + esc(n.ultimaPublicacion.titulo) + "</strong>" +
        '<p class="pequeno apagado">' + esc(n.ultimaPublicacion.texto.slice(0, 140)) +
        (n.ultimaPublicacion.texto.length > 140 ? "…" : "") + "</p></a>").join("") + "</div></div>" : "") +

    (arts.length ? '<div class="pila g16">' +
      '<div class="fila entre g12"><h2>Del blog de MÍA</h2>' +
      '<a class="btn fantasma chico" href="#/blog">Ver el blog</a></div>' +
      '<div class="rejilla dos">' + arts.map(tarjetaArticulo).join("") + "</div></div>" : "") +

    '<div class="tarjeta p24 pila g12">' +
      '<p class="eyebrow">¿Tienes un negocio?</p>' +
      "<h2>Aparece en MÍA desde hoy</h2>" +
      '<p class="apagado" style="max-width:56ch">El plan Gratuito no cuesta nada e incluye tu ' +
      "perfil, tu logo, tus datos de contacto y hasta cinco subcategorías.</p>" +
      '<div class="fila g8"><a class="btn" href="#/registro/gratuito">Registrar mi negocio gratis</a>' +
      '<a class="btn linea" href="#/planes">Comparar planes</a></div>' +
    "</div>" +
  "</div>");
}

function buscarDesdeInicio() {
  filtro.q = val("q"); filtro.categoria = ""; filtro.sub = "";
  location.hash = "#/directorio"; pintar();
}

/* ============================================================== TARJETAS */
function tarjeta(n) {
  const c = cat(n.categoria);
  return '<a class="tarjeta tarjeta-negocio" href="#/negocio/' + esc(n.slug) + '">' +
    portadaHtml(n) +
    '<div class="cuerpo">' +
      '<div class="fila g8">' +
        (n.verificado ? '<span class="chip jade">Verificado</span>' : "") +
        '<span class="chip">' + c.icono + " " + esc(c.nombre) + "</span>" +
      "</div>" +
      "<h3>" + esc(n.nombre) + "</h3>" +
      '<p class="diminuto apagado">' + esc((n.sub || []).slice(0, 3).join(" · ")) + "</p>" +
      '<p class="diminuto apagado">' + esc(n.ciudad || "") + "</p>" +
      '<p class="pequeno" style="color:var(--texto2);flex:1">' + esc((n.descripcion || "").slice(0, 90)) +
        ((n.descripcion || "").length > 90 ? "…" : "") + "</p>" +
      '<div class="fila g8">' + estrellasHtml(n.calificacion) +
        (n.totalResenas ? '<span class="diminuto apagado">(' + n.totalResenas + ")</span>" : "") + "</div>" +
    "</div></a>";
}

const tarjetaArticulo = (a) => '<a class="tarjeta p20 pila g8" style="text-decoration:none" ' +
  'href="#/blog/' + esc(a.slug) + '"><p class="eyebrow">' + esc(fecha(a.creado_en)) + "</p>" +
  "<h3>" + esc(a.titulo) + '</h3><p class="pequeno apagado">' + esc(a.resumen) + "</p></a>";

/* ================================================ PRODUCTOS Y SERVICIOS */
let filtro = { q: "", categoria: "", sub: "", ciudad: "" };
let catActual = { id: null, sub: "" };

async function vistaDirectorio() {
  const params = new URLSearchParams({ porPagina: "48" });
  if (filtro.q) params.set("q", filtro.q);
  if (filtro.categoria) params.set("categoria", filtro.categoria);
  if (filtro.ciudad) params.set("ciudad", filtro.ciudad);
  const { resultados, total } = await api.get("/api/negocios?" + params.toString());
  const res = filtro.sub ? resultados.filter((n) => (n.sub || []).includes(filtro.sub)) : resultados;

  const { resultados: todosParaConteo } = await api.get("/api/negocios?porPagina=48");

  return '<div class="envoltura bloque pila g24">' +
    '<div class="pila g8"><p class="eyebrow">Productos y Servicios</p>' +
      "<h1>El directorio de MÍA</h1>" +
      '<p class="apagado" style="max-width:58ch">Cada negocio pertenece a una categoría ' +
      "principal y puede estar en hasta cinco subcategorías.</p></div>" +

    filtrosHtml() +
    '<hr class="separador">' +
    '<p class="pequeno apagado">' + res.length +
      (res.length === 1 ? " negocio encontrado" : " negocios encontrados") + "</p>" +
    (res.length ? '<div class="rejilla">' + res.map(tarjeta).join("") + "</div>"
      : vacio("No encontramos negocios con esos filtros.")) +

    '<hr class="separador">' +
    '<div class="pila g16"><h2>Todas las categorías</h2>' +
      '<div class="rejilla cats">' + CATEGORIAS.map((c) => {
        const cuantos = todosParaConteo.filter((n) => n.categoria === c.id).length;
        return '<a class="tarjeta-cat" href="#/directorio/' + c.id + '">' +
          "<strong>" + c.icono + " " + esc(c.nombre) + '</strong><span class="diminuto apagado">' +
          c.sub.length + " subcategorías · " + cuantos +
          (cuantos === 1 ? " negocio" : " negocios") + "</span></a>";
      }).join("") + "</div></div>" +
  "</div>";
}

async function vistaCategoria(id) {
  const c = CATEGORIAS.find((x) => x.id === id);
  if (!c) return vistaDirectorio();
  if (catActual.id !== id) catActual = { id, sub: "" };

  const params = new URLSearchParams({ categoria: id, porPagina: "48" });
  const { resultados: enCat } = await api.get("/api/negocios?" + params.toString());
  const res = catActual.sub ? enCat.filter((n) => (n.sub || []).includes(catActual.sub)) : enCat;

  return '<div class="envoltura bloque pila g24">' +
    '<div class="pila g8"><a class="pequeno apagado" href="#/directorio">← Todas las categorías</a>' +
      '<p class="eyebrow">Productos y Servicios</p><h1>' + c.icono + " " + esc(c.nombre) + "</h1>" +
      '<p class="apagado">' + enCat.length +
      (enCat.length === 1 ? " negocio en esta categoría" : " negocios en esta categoría") + "</p></div>" +

    '<div class="pila g8"><p class="eyebrow">Subcategorías</p><div class="subcats">' +
      '<button class="chip ' + (!catActual.sub ? "rosa" : "") + '" onclick="filtrarSub(\'\')">Todas</button>' +
      c.sub.map((s) => {
        const cuantos = enCat.filter((n) => (n.sub || []).includes(s)).length;
        return '<button class="chip ' + (catActual.sub === s ? "rosa" : "") +
          '" onclick="filtrarSub(' + JSON.stringify(s).replace(/"/g, "&quot;") + ')">' +
          esc(s) + (cuantos ? ' <span class="apagado">' + cuantos + "</span>" : "") + "</button>";
      }).join("") + "</div></div>" +

    '<hr class="separador">' +
    '<p class="pequeno apagado">' + res.length +
      (res.length === 1 ? " negocio" : " negocios") + "</p>" +
    (res.length ? '<div class="rejilla">' + res.map(tarjeta).join("") + "</div>"
      : vacio("Todavía no hay negocios publicados en esta subcategoría.")) +
  "</div>";
}

function filtrosHtml() {
  const c = filtro.categoria ? CATEGORIAS.find((x) => x.id === filtro.categoria) : null;
  return '<div class="pila g12">' +
    '<div class="rejilla-campos">' +
      '<label class="campo">Buscar<input id="q" value="' + esc(filtro.q) +
        '" placeholder="Palabra clave" onkeydown="if(event.key===\'Enter\')aplicarFiltros()"></label>' +
      '<label class="campo">Categoría<select id="fc" onchange="aplicarFiltros()">' +
        '<option value="">Todas</option>' + CATEGORIAS.map((x) => '<option value="' + x.id + '"' +
          (filtro.categoria === x.id ? " selected" : "") + ">" + esc(x.icono + " " + x.nombre) + "</option>").join("") +
      "</select></label>" +
      '<label class="campo">Subcategoría<select id="fs" onchange="aplicarFiltros()"' +
        (c ? "" : " disabled") + '><option value="">Todas</option>' +
        (c ? c.sub.map((s) => '<option value="' + esc(s) + '"' + (filtro.sub === s ? " selected" : "") +
          ">" + esc(s) + "</option>").join("") : "") + "</select></label>" +
      '<label class="campo">Ciudad<select id="fu" onchange="aplicarFiltros()">' +
        '<option value="">Todas</option>' + ENTIDADES_CIUDAD.map((x) => '<option value="' + esc(x) + '"' +
          (filtro.ciudad === x ? " selected" : "") + ">" + esc(x) + "</option>").join("") +
      "</select></label>" +
    "</div>" +
    ((filtro.q || filtro.categoria || filtro.sub || filtro.ciudad)
      ? '<div><button class="btn fantasma chico" onclick="limpiarFiltros()">Quitar filtros</button></div>' : "") +
  "</div>";
}

function aplicarFiltros() {
  const antes = filtro.categoria;
  filtro.q = val("q"); filtro.categoria = val("fc"); filtro.ciudad = val("fu");
  filtro.sub = antes === filtro.categoria ? val("fs") : "";
  pintar();
}
function filtrarSub(s) { catActual.sub = catActual.sub === s ? "" : s; pintar(); }
function limpiarFiltros() {
  filtro = { q: "", categoria: "", sub: "", ciudad: "" }; catActual = { id: null, sub: "" };
  location.hash = "#/directorio"; pintar();
}

/* ====================================================================== MAPA */
async function vistaMapa() {
  const enMapa = await api.get("/api/negocios/mapa");
  const { resultados: todos } = await api.get("/api/negocios?porPagina=48");
  const fuera = todos.length - enMapa.length;
  ultimoMapa = enMapa;

  return '<div class="envoltura bloque pila g24">' +
    '<div class="pila g8"><p class="eyebrow">Mapa</p><h1>Dónde están</h1>' +
      '<p class="apagado" style="max-width:58ch">Aparecer en el mapa es parte de los planes ' +
      "Suscripción, Membresía y Crece con MÍA. Toca un punto para abrir el perfil del negocio.</p></div>" +

    '<div class="fila g12">' +
      '<span class="chip rosa">Membresía / Crece con MÍA</span>' +
      '<span class="chip cobalto">Suscripción</span>' +
      '<span class="pequeno apagado">' + enMapa.length +
        (enMapa.length === 1 ? " negocio en el mapa" : " negocios en el mapa") + "</span>" +
    "</div>" +

    '<div class="mapa-caja" id="mapa"></div>' +

    (fuera > 0 ? '<div class="aviso">' + fuera + (fuera === 1
      ? " negocio con plan Gratuito no aparece en el mapa."
      : " negocios con plan Gratuito no aparecen en el mapa.") +
      ' <a href="#/planes" style="color:var(--acento);font-weight:700">Ver planes</a></div>' : "") +

    (enMapa.length ? '<div class="pila g16"><h2>Negocios en el mapa</h2>' +
      '<div class="rejilla">' + enMapa.map(tarjeta).join("") + "</div></div>" : "") +
  "</div>";
}

/* ====================================================================== BLOG */
async function vistaBlog() {
  const arts = await api.get("/api/blog");
  return '<div class="envoltura bloque pila g24" style="max-width:900px">' +
    '<div class="pila g8"><p class="eyebrow">Blog</p><h1>Lo que compartimos en MÍA</h1>' +
      '<p class="apagado" style="max-width:56ch">Herramientas prácticas para que tu negocio ' +
      "crezca, escritas por el equipo de MÍA y por la comunidad.</p></div>" +
    (arts.length ? '<div class="rejilla dos">' + arts.map(tarjetaArticulo).join("") + "</div>"
      : vacio("Todavía no hay artículos publicados.")) +
  "</div>";
}

async function vistaArticulo(slug) {
  let a;
  try { a = await api.get("/api/blog/" + encodeURIComponent(slug)); }
  catch { return '<div class="envoltura bloque"><h2>No encontramos ese artículo</h2>' +
    '<p style="margin-top:14px"><a class="btn" href="#/blog">Volver al blog</a></p></div>'; }

  return '<div class="envoltura bloque pila g24" style="max-width:720px">' +
    '<div class="pila g8"><a class="pequeno apagado" href="#/blog">← Blog</a>' +
      '<p class="eyebrow">' + esc(fecha(a.creado_en)) + " · " + esc(a.autora) + "</p>" +
      "<h1>" + esc(a.titulo) + "</h1>" +
      '<p class="apagado" style="font-size:1.05rem">' + esc(a.resumen) + "</p></div>" +
    '<hr class="separador">' +
    '<div class="articulo">' + a.cuerpo.split("\n\n").map((p) => "<p>" + esc(p) + "</p>").join("") + "</div>" +
  "</div>";
}

/* ================================================================= SOBRE MÍA */
function vistaSobre() {
  return '<section class="hero"><div class="envoltura">' +
    '<p class="eyebrow">Sobre MÍA</p><h1>No somos un marketplace</h1>' +
    '<p class="entrada">Somos un directorio inteligente y una comunidad para negocios ' +
    "dirigidos por mujeres.</p></div></section>" +

  '<div class="envoltura bloque pila g32" style="max-width:760px">' +
    '<div class="articulo pila g16">' +
      "<p>En un marketplace tú subes tu producto, la plataforma se queda con una comisión de " +
      "cada venta y decide quién aparece primero según quién paga más publicidad. Tu clienta " +
      "es de la plataforma, no tuya.</p>" +
      "<p><strong>MÍA funciona al revés.</strong> Tu clienta te contacta directo: por teléfono, " +
      "por WhatsApp o llegando a tu local. No pasamos por en medio, no cobramos comisión sobre " +
      "lo que vendes y tu relación con ella es tuya.</p>" +
      "<p>Lo que hacemos es que te encuentren, y que no camines sola.</p>" +
    "</div>" +

    '<div class="rejilla dos">' +
      '<div class="tarjeta p20 pila g8"><p class="eyebrow">Directorio</p>' +
        "<strong>Que te encuentren</strong>" +
        '<p class="pequeno apagado">Categorías y subcategorías bien ordenadas, búsqueda y ' +
        "un mapa para que tu clienta sepa dónde estás.</p></div>" +
      '<div class="tarjeta p20 pila g8"><p class="eyebrow">Comunidad</p>' +
        "<strong>Que no camines sola</strong>" +
        '<p class="pequeno apagado">Publicaciones, campañas donde presentamos negocios de ' +
        "la comunidad y acompañamiento para las que quieren crecer.</p></div>" +
    "</div>" +

    '<div class="pila g16"><h2>Cómo entras a MÍA</h2>' +
      '<div class="escalones">' +
        escalon(1, "Eliges tu plan", "Cada plan tiene su propio formulario, con lo que ese plan necesita.") +
        escalon(2, "Llenas el formulario", "Tus datos, tu categoría principal y hasta cinco subcategorías.") +
        escalon(3, "MÍA revisa tu perfil", "Confirmamos los datos y, si aplica, tu pago.") +
        escalon(4, "Tu perfil se publica", "Apareces en el directorio y empiezas a recibir clientas.") +
      "</div>" +
      '<div><a class="btn" href="#/planes">Ver los planes</a></div>' +
    "</div>" +
  "</div>";
}
/* ============================================================ PERFIL NEGOCIO */
async function vistaNegocio(slug) {
  let n;
  try { n = await api.get("/api/negocios/" + encodeURIComponent(slug) + "?contar=1"); }
  catch {
    return '<div class="envoltura bloque"><h2>No encontramos ese negocio</h2>' +
      '<p style="margin-top:14px"><a class="btn" href="#/directorio">Ver el directorio</a></p></div>';
  }

  const mio = YO && YO.rol === "admin"; // la comparación con la dueña real se resuelve en el servidor
  const c = cat(n.categoria);
  let esFav = false;
  if (YO && YO.rol === "usuario") {
    try { esFav = (await api.get("/api/favoritos")).some((f) => f.id === n.id); } catch { /* sin favoritos */ }
  }
  const miReseña = YO && YO.rol === "usuario" ? n.resenas.find((r) => r.usuario_id === YO.id) : null;

  const contacto = [];
  if (n.telefono) contacto.push('<a class="btn linea" href="tel:' +
    esc(n.telefono.replace(/\s/g, "")) + '">Llamar ' + esc(n.telefono) + "</a>");
  if (n.redes.whatsapp) contacto.push('<a class="btn" target="_blank" rel="noopener" href="https://wa.me/52' +
    esc(String(n.redes.whatsapp).replace(/\D/g, "")) + '">WhatsApp</a>');

  const redes = [];
  if (n.redes.instagram) redes.push("Instagram " + esc(n.redes.instagram));
  if (n.redes.facebook) redes.push("Facebook " + esc(n.redes.facebook));
  if (n.redes.tiktok) redes.push("TikTok " + esc(n.redes.tiktok));

  const destacados = n.productos.filter((x) => x.destacado);
  const normales = n.productos.filter((x) => !x.destacado);

  return portadaHtml(n, true) +
  '<div class="envoltura bloque pila g24">' +
    '<div class="fila arriba g16">' + logoHtml(n, true) +
      '<div class="pila g8" style="flex:1;min-width:220px">' +
        '<div class="fila g8">' +
          (n.verificado ? '<span class="chip jade">Perfil verificado</span>' : "") +
          (n.plan === "crece" ? '<span class="chip cobalto">Crece con MÍA</span>' : "") +
          (n.estado && n.estado !== "publicado" ? '<span class="chip ' + ESTADOS[n.estado].chip + '">' +
            esc(ESTADOS[n.estado].et) + "</span>" : "") +
        "</div>" +
        "<h1>" + esc(n.nombre) + "</h1>" +
        '<div class="fila g12">' + estrellasHtml(n.calificacion) +
          '<span class="pequeno apagado">' + n.totalResenas + (n.totalResenas === 1 ? " reseña" : " reseñas") + "</span>" +
          (n.ciudad ? '<span class="pequeno apagado">· ' + esc(n.ciudad) + "</span>" : "") +
        "</div>" +
        '<div class="fila g8"><a class="chip rosa" style="text-decoration:none" href="#/directorio/' +
          c.id + '">' + c.icono + " " + esc(c.nombre) + "</a>" +
          (n.sub || []).map((s) => '<span class="chip">' + esc(s) + "</span>").join("") + "</div>" +
      "</div>" +
    "</div>" +

    '<p style="max-width:66ch;white-space:pre-wrap">' + esc(n.descripcion) + "</p>" +
    (n.direccion ? '<p class="pequeno apagado">📍 ' + esc(n.direccion) +
      (n.ciudad ? ", " + esc(n.ciudad) : "") + "</p>" : "") +

    '<div class="fila g8">' + contacto.join("") +
      (YO && YO.rol === "usuario"
        ? '<button class="btn ' + (esFav ? "" : "linea") + '" onclick="alternarFavorito(' + n.id + ',' + esFav + ')">' +
          (esFav ? "♥ En tus favoritos" : "♡ Guardar en favoritos") + "</button>" : "") +
    "</div>" +
    (redes.length ? '<p class="pequeno apagado">' + redes.join(" · ") + "</p>" : "") +

    (n.fotos.length > 1 ? '<div class="pila g12"><p class="eyebrow">Fotografías</p>' +
      '<div class="galeria">' + n.fotos.map((f) =>
        '<div class="foto">' + imagenHtml(f, n.nombre) + "</div>").join("") + "</div></div>" : "") +

    (n.productos.length ? '<div class="pila g12"><p class="eyebrow">Productos y servicios</p>' +
      (destacados.length ? '<div class="rejilla">' + destacados.map((x) => fichaProducto(x, true)).join("") + "</div>" : "") +
      (normales.length ? '<div class="rejilla">' + normales.map((x) => fichaProducto(x, false)).join("") + "</div>" : "") +
      "</div>" : "") +

    (n.publicaciones.length ? '<div class="pila g12"><p class="eyebrow">Publicaciones</p>' +
      '<div class="pila g12">' + n.publicaciones.map((x) =>
        '<div class="publicacion' + (x.destacada ? " destacada" : "") + '">' +
        '<div class="fila entre g8"><strong>' + esc(x.titulo) + "</strong>" +
        (x.destacada ? '<span class="chip rosa">Destacada</span>' : "") + "</div>" +
        '<p class="diminuto apagado">' + esc(fecha(x.creado_en)) + "</p>" +
        '<p class="pequeno" style="white-space:pre-wrap">' + esc(x.texto) + "</p></div>").join("") +
      "</div></div>" : "") +

    '<hr class="separador">' +
    '<div class="pila g16"><p class="eyebrow">Reseñas de clientas</p>' +
      (YO && YO.rol === "usuario" ? formularioResena(n, miReseña)
        : !YO ? '<div class="aviso">Para dejar una reseña ' +
            '<a href="#/entrar" style="color:var(--acento);font-weight:700">entra con tu correo</a>.</div>' : "") +
      (n.resenas.length ? n.resenas.map((r) => bloqueResena(r, n)).join("")
        : '<p class="apagado pequeno">Este negocio todavía no tiene reseñas.</p>') +
    "</div>" +
  "</div>";
}

const fichaProducto = (x, destacado) => '<div class="tarjeta p16 pila g8"' +
  (destacado ? ' style="border-left:3px solid var(--acento)"' : "") + ">" +
  (destacado ? '<span class="chip rosa">Destacado</span>' : "") +
  "<strong>" + esc(x.nombre) + "</strong>" +
  (x.descripcion ? '<p class="pequeno apagado">' + esc(x.descripcion) + "</p>" : "") +
  (x.precio ? '<p class="mono" style="font-weight:700">' + pesos(x.precio) + "</p>" : "") + "</div>";

function formularioResena(n, mia) {
  const cal = mia ? mia.calificacion : 0;
  return '<div class="tarjeta p20 pila g12"><strong>' +
    (mia ? "Edita tu reseña" : "Deja tu reseña") + "</strong>" +
    '<div class="selector-estrellas" id="sel">' + [1, 2, 3, 4, 5].map((i) =>
      '<button type="button" class="' + (i <= cal ? "on" : "") + '" onclick="elegirEstrella(' + i +
      ')" aria-label="' + i + ' estrellas">★</button>').join("") + "</div>" +
    '<input type="hidden" id="cal" value="' + cal + '">' +
    '<textarea id="texto" placeholder="Cuéntanos cómo te fue.">' + esc(mia ? mia.comentario : "") + "</textarea>" +
    '<div class="fila g8"><button class="btn" onclick="guardarResena(' + n.id + ')">' +
      (mia ? "Actualizar reseña" : "Publicar reseña") + "</button>" +
      (mia ? '<button class="btn linea" onclick="borrarResena(' + mia.id + ')">Borrar</button>' : "") +
    "</div></div>";
}

function bloqueResena(r, n) {
  const puede = YO && (YO.rol === "admin" || n.puedeResponderResenas) && !r.respuesta;
  return '<div class="tarjeta p16 pila g8">' +
    '<div class="fila entre g8"><strong class="pequeno">' + esc(r.autora || "Usuaria") + "</strong>" +
      '<span class="diminuto apagado">' + esc(fecha(r.creado_en)) + "</span></div>" +
    estrellasHtml(r.calificacion) + "<p>" + esc(r.comentario) + "</p>" +
    (r.respuesta ? '<div style="border-left:3px solid var(--acento);padding-left:11px">' +
      '<p class="eyebrow">Respuesta del negocio</p><p class="pequeno">' + esc(r.respuesta) + "</p></div>" : "") +
    (puede ? '<div class="pila g8">' +
      '<textarea id="resp' + r.id + '" style="min-height:64px" placeholder="Responde con amabilidad…"></textarea>' +
      '<div><button class="btn chico" onclick="responder(' + r.id + "," + n.id + ')">Responder</button></div></div>' : "") +
    (YO && YO.rol === "negocio" && !n.puedeResponderResenas && !r.respuesta
      ? '<p class="diminuto apagado">Responder reseñas empieza en el plan Suscripción.</p>' : "") +
    "</div>";
}

function elegirEstrella(i) {
  $("cal").value = i;
  [...$("sel").children].forEach((b, k) => b.classList.toggle("on", k < i));
}

async function guardarResena(negocioId) {
  const calificacion = Number(val("cal"));
  if (!calificacion) return avisar("Elige de 1 a 5 estrellas.");
  const comentario = val("texto");
  if (comentario.length < 4) return avisar("Escribe unas palabras sobre tu experiencia.");
  try {
    await api.post("/api/negocios/" + negocioId + "/resenas", { calificacion, comentario });
    await pintar();
    avisar("Guardamos tu reseña. Gracias.");
  } catch (err) { avisarError(err); }
}

async function borrarResena(id) {
  try { await api.del("/api/resenas/" + id); await pintar(); avisar("Borramos tu reseña."); }
  catch (err) { avisarError(err); }
}

async function responder(id, negocioId) {
  const respuesta = val("resp" + id);
  if (!respuesta) return avisar("Escribe tu respuesta.");
  try {
    await api.post("/api/resenas/" + id + "/responder", { respuesta });
    await pintar();
    avisar("Publicamos tu respuesta.");
  } catch (err) { avisarError(err); }
}

async function alternarFavorito(negocioId, eraFavorito) {
  try {
    if (eraFavorito) await api.del("/api/favoritos/" + negocioId);
    else await api.post("/api/favoritos/" + negocioId);
    await pintar();
    avisar(eraFavorito ? "Lo quitamos de tus favoritos." : "Lo guardamos en tus favoritos.");
  } catch (err) { avisarError(err); }
}

async function vistaFavoritos() {
  const lista = await api.get("/api/favoritos");
  return '<div class="envoltura bloque pila g24">' +
    '<div class="pila g8"><p class="eyebrow">Tu cuenta</p><h1>Tus favoritos</h1></div>' +
    (lista.length ? '<div class="rejilla">' + lista.map(tarjeta).join("") + "</div>"
      : vacio("Abre cualquier negocio y toca “Guardar en favoritos”.")) + "</div>";
}
/* ==================================================================== PLANES */
function vistaPlanes() {
  return '<div class="envoltura bloque pila g32">' +
    '<div class="pila g8"><p class="eyebrow">Planes</p>' +
      "<h1>Elige cómo quieres aparecer en MÍA</h1>" +
      '<p class="apagado" style="max-width:60ch">Cada plan tiene su propio formulario de ' +
      "registro, con exactamente lo que ese plan necesita.</p></div>" +

    '<div class="rejilla planes">' + ORDEN_PLANES.map((k) => {
      const p = PLANES[k];
      return '<div class="plan' + (k === "suscripcion" ? " destacado" : "") +
        (p.cotizado ? " servicio" : "") + '">' +
        '<div class="fila entre g8"><p class="eyebrow">' + esc(p.nombre) + "</p>" +
          (k === "suscripcion" ? '<span class="chip cobalto">Más elegido</span>' : "") +
          (p.cotizado ? '<span class="chip cobalto">Con acompañamiento</span>' : "") + "</div>" +
        '<div class="precio">' + (p.cotizado ? "Desde $" + p.precioMensual.toLocaleString("es-MX")
            : p.precioMensual ? "$" + p.precioMensual : "$0") +
          (p.precioMensual ? '<span style="font-size:.84rem;font-weight:600;color:var(--texto2)"> MXN/mes</span>' : "") + "</div>" +
        '<p class="pequeno apagado">' + esc(p.resumen) + "</p><ul>" +
          p.incluye.map((x) => "<li>" + esc(x) + "</li>").join("") +
          (p.servicios || []).map((x) => "<li>" + esc(x) + "</li>").join("") +
          p.excluye.map((x) => '<li class="no">' + esc(x) + "</li>").join("") + "</ul>" +
        '<a class="btn' + (p.cotizado ? " linea" : "") + ' ancho" href="#/registro/' + k + '">' +
          (p.cotizado ? "Solicitar una cotización" : "Registrarme con " + esc(p.nombre)) + "</a>" +
      "</div>";
    }).join("") + "</div>" +

    '<div class="aviso"><div><strong>Sobre el precio de Crece con MÍA.</strong> Los $2,500 son ' +
    "el punto de partida, no una cuota fija: el precio final depende de los servicios que " +
    "necesite tu negocio y del plan personalizado que armemos contigo. No se cobra automático — " +
    "primero platicamos, después cotizamos y hasta entonces se activa.</div></div>" +

    '<div class="pila g16"><h2>Así funciona el registro</h2>' +
      '<div class="escalones">' +
        escalon(1, "Eliges tu plan", "Cada plan abre su propio formulario.") +
        escalon(2, "Llenas tus datos", "Categoría principal y hasta cinco subcategorías.") +
        escalon(3, "MÍA recibe tu solicitud", "Queda registrada para el equipo, lista para revisión.") +
        escalon(4, "Se publica tu perfil", "Confirmamos datos y pago, y entras al directorio.") +
      "</div></div>" +
  "</div>";
}

/* =============================================== FORMULARIOS POR PLAN */
let subSeleccionadas = [];

function vistaRegistro(planId) {
  const plan = PLANES[planId];
  if (!plan) return vistaPlanes();
  subSeleccionadas = [];
  const P = plan.permisos, L = plan.limites;

  return '<div class="envoltura bloque pila g24" style="max-width:660px">' +
    '<div class="pila g8"><a class="pequeno apagado" href="#/planes">← Todos los planes</a>' +
      '<p class="eyebrow">Formulario ' + esc(plan.nombre) + "</p>" +
      "<h1>Registra tu negocio</h1>" +
      '<div class="fila g8"><span class="chip rosa">' + esc(plan.etiqueta) + "</span>" +
      '<span class="chip">Hasta ' + L.subcategorias + " subcategorías</span>" +
      (P.mapa ? '<span class="chip jade">Aparece en el mapa</span>' : '<span class="chip">Sin mapa</span>') +
      "</div></div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Tus datos</p>' +
      '<div class="rejilla-campos">' +
        '<label class="campo">Tu nombre<input id="g_nombre" placeholder="María López"></label>' +
        '<label class="campo">Correo electrónico<input id="g_correo" type="email"></label>' +
        '<label class="campo">Contraseña<input id="g_clave" type="password" placeholder="Mínimo 8 caracteres"></label>' +
        '<label class="campo">Teléfono de contacto<input id="g_telefono" placeholder="55 1234 5678"></label>' +
      "</div>" +
    "</div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Tu negocio</p>' +
      '<div class="rejilla-campos">' +
        '<label class="campo">Nombre del negocio<input id="g_negocio"></label>' +
        '<label class="campo">Ciudad<select id="g_ciudad"><option value="">Elige…</option>' +
          ENTIDADES_CIUDAD.map((x) => '<option value="' + esc(x) + '">' + esc(x) + "</option>").join("") +
        "</select></label>" +
      "</div>" +
      '<label class="campo">Dirección <span class="apagado">(opcional)</span>' +
        '<input id="g_direccion" placeholder="Calle, número, colonia"></label>' +
      '<label class="campo">Categoría principal' +
        '<select id="g_categoria" onchange="pintarSub()"><option value="">Elige…</option>' +
          CATEGORIAS.map((c) => '<option value="' + c.id + '">' + esc(c.icono + " " + c.nombre) + "</option>").join("") +
        "</select></label>" +
      '<div class="pila g8"><span class="campo">Subcategorías <span class="apagado">' +
        "(elige hasta " + L.subcategorias + ')</span></span>' +
        '<div class="subcats" id="g_sub"><span class="pequeno apagado">' +
        "Primero elige una categoría principal.</span></div></div>" +
      '<label class="campo">Descripción <span class="apagado">(hasta ' +
        L.caracteresDescripcion + " caracteres con este plan)</span>" +
        '<textarea id="g_descripcion" maxlength="' + L.caracteresDescripcion +
        '" placeholder="Cuenta qué haces y qué te distingue."></textarea></label>' +
    "</div>" +

    (P.redes ? '<div class="tarjeta p20 pila g16"><p class="eyebrow">Redes sociales</p>' +
      '<p class="pequeno apagado">Incluidas en tu plan.</p>' +
      '<div class="rejilla-campos">' +
        '<label class="campo">WhatsApp<input id="g_whatsapp"></label>' +
        '<label class="campo">Instagram<input id="g_instagram" placeholder="@tunegocio"></label>' +
        '<label class="campo">Facebook<input id="g_facebook"></label>' +
        '<label class="campo">TikTok<input id="g_tiktok" placeholder="@tunegocio"></label>' +
      "</div></div>"
      : '<div class="aviso">Las redes sociales y el botón de WhatsApp empiezan en el plan ' +
        'Suscripción. <a href="#/registro/suscripcion" style="color:var(--acento);font-weight:700">Ver ese formulario</a></div>') +

    (plan.servicios ? '<div class="tarjeta p20 pila g16"><p class="eyebrow">Servicios de marketing</p>' +
      '<p class="pequeno apagado">Además de todo lo de Membresía, este plan incluye:</p>' +
      '<ul style="margin:0;padding-left:18px;font-size:.88rem;display:flex;flex-direction:column;gap:5px">' +
        plan.servicios.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" +
      '<label class="campo">¿En qué quieres que te acompañemos?' +
        '<textarea id="g_mensaje" placeholder="Cuéntanos dónde sientes que se está atorando tu ' +
        'negocio: ventas, redes, contenido, imagen…"></textarea></label></div>' : "") +

    (plan.precioMensual ? '<div class="tarjeta p20 pila g12"><p class="eyebrow">' +
      (plan.cotizado ? "Cotización" : "Pago con Stripe") + "</p>" +
      "<p><strong>" + esc(plan.etiqueta) + "</strong></p>" +
      '<p class="pequeno apagado">' + (plan.cotizado
        ? "Los $2,500 son el punto de partida. El precio final depende de los servicios que " +
          "necesite tu negocio y del plan personalizado que armemos contigo, así que no se cobra " +
          "automático: al enviar, el equipo de MÍA te contacta para platicar el alcance y " +
          "cotizarte. El plan se activa cuando ambas partes están de acuerdo; mientras tanto tu " +
          "perfil funciona con las reglas del plan Gratuito."
        : "Al enviar, te llevamos directo a pagar con Stripe de forma segura. En cuanto Stripe " +
          "confirme el pago —normalmente toma segundos— tu plan se activa solo, sin que nadie " +
          "tenga que hacer nada más. Mientras tanto tu perfil funciona con las reglas del plan Gratuito.")
        + "</p></div>" : "") +

    '<div class="pila g12">' +
      '<button class="btn ancho" onclick="enviarRegistro(\'' + planId + '\')">' +
        (plan.cotizado ? "Enviar mi solicitud"
          : PLANES_AUTOMATIZADOS.includes(planId) ? "Continuar y pagar con Stripe" : "Enviar mi registro") +
        "</button>" +
      '<p id="g_error" class="pequeno" style="color:var(--peligro)"></p>' +
      '<p class="diminuto apagado">Al enviar, tu solicitud queda guardada para el equipo de MÍA ' +
      "y se crea tu perfil en espera de revisión.</p>" +
    "</div>" +
  "</div>";
}

function pintarSub() {
  const c = CATEGORIAS.find((x) => x.id === val("g_categoria"));
  subSeleccionadas = [];
  $("g_sub").innerHTML = c
    ? c.sub.map((s) => '<button type="button" class="chip" data-sub="' + esc(s) +
        '" onclick="alternarSub(this)">' + esc(s) + "</button>").join("")
    : '<span class="pequeno apagado">Primero elige una categoría principal.</span>';
}

function alternarSub(btn) {
  const s = btn.dataset.sub;
  const i = subSeleccionadas.indexOf(s);
  if (i >= 0) { subSeleccionadas.splice(i, 1); btn.classList.remove("rosa"); }
  else {
    if (subSeleccionadas.length >= MAX_SUBCATEGORIAS) return avisar("Puedes elegir hasta " + MAX_SUBCATEGORIAS + " subcategorías.");
    subSeleccionadas.push(s); btn.classList.add("rosa");
  }
}

async function enviarRegistro(planId) {
  const decir = (m) => { if ($("g_error")) $("g_error").textContent = m; avisar(m); };
  if (!val("g_categoria")) return decir("Elige la categoría principal de tu negocio.");
  if (!subSeleccionadas.length) return decir("Elige al menos una subcategoría.");

  const cuerpo = {
    nombre: val("g_nombre"), correo: val("g_correo"), clave: val("g_clave"), telefono: val("g_telefono"),
    plan: planId, mensaje: val("g_mensaje"),
    negocio: {
      nombre: val("g_negocio"), categoria: val("g_categoria"), sub: subSeleccionadas.slice(),
      ciudad: val("g_ciudad"), direccion: val("g_direccion"), descripcion: val("g_descripcion"),
      redes: { whatsapp: val("g_whatsapp"), instagram: val("g_instagram"), facebook: val("g_facebook"), tiktok: val("g_tiktok") },
    },
  };
  try {
    const r = await api.post("/api/auth/registro-negocio", cuerpo);
    await refrescarSesion();

    if (PLANES_AUTOMATIZADOS.includes(planId)) {
      avisar("Ya casi. Te llevamos a pagar con Stripe…");
      return iniciarPago(r.negocioId, planId);
    }
    location.hash = "#/panel";
    await pintar();
    avisar(planId === "crece"
      ? "Recibimos tu registro. MÍA te contacta para cotizarte."
      : "¡Listo! Tu perfil quedó en espera de revisión.");
  } catch (err) { decir(err instanceof ErrorApi ? err.message : "No se pudo completar el registro."); }
}

/* ==================================================================== ENTRAR */
function vistaEntrar() {
  return '<div class="envoltura bloque pila g24" style="max-width:440px">' +
    '<div class="pila g8"><p class="eyebrow">Tu cuenta</p><h1>Entrar a MÍA</h1></div>' +
    '<div class="tarjeta p20 pila g12">' +
      '<label class="campo">Correo electrónico<input id="e_correo" type="email" autocomplete="username"></label>' +
      '<label class="campo">Contraseña<input id="e_clave" type="password" autocomplete="current-password" ' +
        'onkeydown="if(event.key===\'Enter\')hacerEntrar()"></label>' +
      '<button class="btn ancho" onclick="hacerEntrar()">Entrar</button>' +
      '<p id="e_error" class="pequeno" style="color:var(--peligro)"></p>' +
    "</div>" +
    '<div class="tarjeta p20 pila g12"><p class="eyebrow">¿Tienes un negocio?</p>' +
      '<p class="pequeno apagado">El registro se hace desde el plan que elijas: cada uno tiene ' +
      "su propio formulario.</p>" +
      '<a class="btn linea ancho" href="#/planes">Ver los planes y registrarme</a></div>' +
    '<div class="tarjeta p20 pila g12"><p class="eyebrow">¿Solo quieres comprar?</p>' +
      '<label class="campo">Tu nombre<input id="r_nombre"></label>' +
      '<label class="campo">Correo electrónico<input id="r_correo" type="email"></label>' +
      '<label class="campo">Contraseña<input id="r_clave" type="password" placeholder="Mínimo 8 caracteres"></label>' +
      '<button class="btn linea ancho" onclick="hacerRegistroCliente()">Crear cuenta de clienta</button>' +
      '<p id="r_error" class="pequeno" style="color:var(--peligro)"></p></div>' +
    '<div class="tarjeta p20 pila g12"><p class="eyebrow">Cuentas de prueba</p>' +
      botonDemo("admin@mia.mx", "Organización MÍA", "Administra todo el directorio") +
      botonDemo("lucia@mia.mx", "Negocio con Membresía", "Todo abierto, $599") +
      botonDemo("beatriz@mia.mx", "Negocio con plan Gratuito", "Verás qué le bloquea el plan") +
      botonDemo("daniela@mia.mx", "Clienta", "Reseñas y favoritos") +
    "</div></div>";
}

const botonDemo = (correo, titulo, nota) =>
  '<button class="btn linea ancho" style="justify-content:flex-start;text-align:left;padding:12px 14px" ' +
  "onclick=\"accesoRapido('" + correo + "')\"><span><strong>" + esc(titulo) + "</strong><br>" +
  '<span class="diminuto apagado" style="font-weight:500">' + esc(nota) + "</span></span></button>";

async function hacerEntrar() {
  const err = await entrar(val("e_correo"), val("e_clave"));
  if (err && $("e_error")) $("e_error").textContent = err;
}

async function hacerRegistroCliente() {
  const decir = (m) => { if ($("r_error")) $("r_error").textContent = m; };
  try {
    await api.post("/api/auth/registro-clienta", { nombre: val("r_nombre"), correo: val("r_correo"), clave: val("r_clave") });
    await refrescarSesion();
    location.hash = "#/inicio";
    await pintar();
    avisar("Tu cuenta quedó lista, " + YO.nombre.split(" ")[0] + ".");
  } catch (err) { decir(err instanceof ErrorApi ? err.message : "No se pudo crear tu cuenta."); }
}

/* ===================================================================== AYUDA */
function vistaAyuda() {
  return '<div class="envoltura bloque pila g32" style="max-width:760px">' +
    '<div class="pila g8"><p class="eyebrow">Guía rápida</p><h1>Cómo se entra a MÍA</h1>' +
      '<p class="apagado">Hay tres tipos de cuenta. Todas entran por el mismo lugar, ' +
      "pero cada una ve algo distinto.</p></div>" +

    '<div class="tarjeta p24 pila g16"><p class="eyebrow">1 · La organización MÍA</p>' +
      "<p>Administra el directorio completo: publica o rechaza los perfiles que llegan, los " +
      "suspende, les cambia el plan, confirma pagos, verifica negocios, administra cuentas, " +
      "modera reseñas y escribe el blog.</p>" +
      '<p class="mono pequeno">admin@mia.mx · mia2026</p>' +
      '<div><button class="btn" onclick="accesoRapido(\'admin@mia.mx\')">Entrar como MÍA</button></div></div>' +

    '<div class="tarjeta p24 pila g16"><p class="eyebrow">2 · Negocio</p>' +
      "<p>Administra su perfil: logo, fotografías, descripción, productos, publicaciones y " +
      "respuestas a reseñas. Lo que puede hacer depende de su plan.</p>" +
      '<p class="mono pequeno">lucia@mia.mx · demo1234 — Membresía<br>' +
      "beatriz@mia.mx · demo1234 — Gratuito, con los avisos de lo que le falta</p>" +
      '<div class="fila g8"><button class="btn" onclick="accesoRapido(\'lucia@mia.mx\')">Entrar con Membresía</button>' +
      '<button class="btn linea" onclick="accesoRapido(\'beatriz@mia.mx\')">Entrar con Gratuito</button></div></div>' +

    '<div class="tarjeta p24 pila g16"><p class="eyebrow">3 · Clienta</p>' +
      "<p>Se registra con su correo. Busca negocios, los guarda en favoritos y deja reseñas.</p>" +
      '<p class="mono pequeno">daniela@mia.mx · demo1234</p>' +
      '<div><button class="btn" onclick="accesoRapido(\'daniela@mia.mx\')">Entrar como clienta</button></div></div>' +
  "</div>";
}
/* ============================================================ PANEL NEGOCIO */
async function vistaPanel() {
  const mios = await api.get("/api/mis-negocios");
  return '<div class="envoltura bloque pila g24">' +
    '<div class="fila entre g12"><div class="pila g8"><p class="eyebrow">Mi negocio</p>' +
      "<h1>Mis perfiles</h1></div>" +
      '<a class="btn linea" href="#/planes">Registrar otro negocio</a></div>' +
    (mios.length ? '<div class="pila g16">' + mios.map(fichaPanel).join("")
      : vacio("Todavía no tienes perfiles. Elige un plan para registrar tu negocio.")) + "</div>";
}

function fichaPanel(n) {
  const pubsVisibles = n.publicaciones.filter((p) => p.visible).length;
  return '<div class="tarjeta p20 pila g12">' +
    '<div class="fila entre g12 arriba">' +
      '<div class="fila g12" style="flex:1;min-width:220px">' + logoHtml(n) +
        '<div class="pila g4">' +
          '<div class="fila g8">' +
            '<span class="chip ' + ESTADOS[n.estado].chip + '">' + esc(ESTADOS[n.estado].et) + "</span>" +
            '<span class="chip ' + (n.planEfectivo !== n.plan ? "peligro" : "cobalto") + '">' +
              esc(PLANES[n.plan].nombre) +
              (n.membresiaVencida ? " · vencido" : !n.pagoConfirmado ? " · sin confirmar" : "") + "</span>" +
            (n.verificado && n.permisos.verificado ? '<span class="chip jade">Verificado</span>' : "") +
          "</div>" +
          "<h3>" + esc(n.nombre) + "</h3>" +
          '<p class="diminuto apagado">' + cat(n.categoria).icono + " " + esc(cat(n.categoria).nombre) +
            (n.sub.length ? " · " + esc(n.sub.join(", ")) : "") + "</p>" +
        "</div></div>" +
      '<div class="fila g8">' +
        '<button class="btn linea chico" onclick="location.hash=\'#/editar/' + n.id + '\'">Editar perfil</button>' +
        (n.estado === "publicado" ? '<a class="btn fantasma chico" href="#/negocio/' +
          esc(n.slug) + '">Ver perfil</a>' : "") +
      "</div></div>" +

    (n.estado === "borrador" ? '<div class="aviso">Este perfil todavía no lo ve nadie.' +
      '<button class="btn chico" style="margin-left:auto" onclick="mandarRevision(' + n.id +
      ')">Mandar a revisión</button></div>' : "") +
    (n.estado === "rechazado" && n.notaRevision ? '<div class="aviso alerta"><div>' +
      "<strong>MÍA pidió cambios:</strong> " + esc(n.notaRevision) +
      '<br><button class="btn chico" style="margin-top:8px" onclick="mandarRevision(' + n.id +
      ')">Volver a mandar</button></div></div>' : "") +
    (n.estado === "pendiente" ? '<div class="aviso">MÍA está revisando este perfil. ' +
      "Te avisamos en cuanto se publique.</div>" : "") +
    (n.estado === "suspendido" ? '<div class="aviso alerta">MÍA detuvo este perfil' +
      (n.notaRevision ? ": " + esc(n.notaRevision) : ".") + "</div>" : "") +

    (PLANES_AUTOMATIZADOS.includes(n.plan)
      ? (!n.pagoConfirmado || n.membresiaVencida
        ? '<div class="aviso alerta"><div><strong>' +
            (n.membresiaVencida ? `Tu ${esc(PLANES[n.plan].nombre)} venció.` : "Todavía falta confirmar tu pago.") +
            '</strong> Complétalo con Stripe para activar tus beneficios.' +
            '<br><button class="btn chico" style="margin-top:8px" onclick="iniciarPago(' + n.id + ",'" + n.plan +
            '\')">Pagar con Stripe</button></div></div>'
        : '<div class="fila g8"><span class="chip jade">Pago al día con Stripe</span>' +
          '<button class="btn fantasma chico" onclick="abrirPortalPago(' + n.id + ')">Administrar mi pago</button></div>')
      : "") +

    (n.bloqueos.length ? '<div class="aviso candado"><div><strong>Tu plan está ocultando cosas:</strong>' +
      '<ul style="margin:6px 0 0;padding-left:18px">' + n.bloqueos.map((x) => "<li>" + esc(x) + "</li>").join("") +
      '</ul><a class="btn chico" style="margin-top:9px" href="#/planes">Ver planes</a></div></div>' : "") +

    (n.estadisticas
      ? '<div class="metricas">' + metrica(n.estadisticas.vistas, "Visitas") +
        metrica(n.estadisticas.favoritos, "Favoritos", "cobalto") +
        metrica(n.estadisticas.resenas, "Reseñas", "jade") +
        metrica(n.estadisticas.calificacion ? n.estadisticas.calificacion.toFixed(1) : "—", "Calificación", "sol") +
        metrica(pubsVisibles + (n.publicaciones.length > pubsVisibles ? " / " + n.publicaciones.length : ""), "Publicaciones") +
        "</div>"
      : '<p class="diminuto apagado">Las estadísticas de tu perfil empiezan en el plan Membresía.</p>') +
  "</div>";
}

const metrica = (v, et, tono) => '<div class="metrica ' + (tono || "") + '"><div class="n">' +
  esc(v) + '</div><div class="et">' + esc(et) + "</div></div>";

async function mandarRevision(id) {
  try {
    await api.post("/api/negocios/" + id + "/enviar-revision");
    await pintar();
    avisar("Lo mandamos a revisión. MÍA te avisa cuando se publique.");
  } catch (err) { avisarError(err); }
}

/* ==================================================================== EDITOR */
async function vistaEditar(id) {
  let n;
  try { n = await api.get("/api/negocios/" + id + "/panel"); }
  catch { return sinAcceso(); }

  const L = n.limites, P = n.permisos, c = cat(n.categoria);
  const cerrado = (t) => '<p class="pequeno apagado">🔒 ' + esc(t) + "</p>";
  const pubs = n.publicaciones;
  const tope = L.publicaciones === Infinity ? Infinity : L.publicaciones;

  return '<div class="envoltura bloque pila g24" style="max-width:800px">' +
    '<div class="pila g8"><a class="pequeno apagado" href="#/panel">← Mis perfiles</a>' +
      '<div class="fila g12">' + logoHtml(n) + "<h1>" + esc(n.nombre) + "</h1></div>" +
      '<div class="fila g8"><span class="chip ' + ESTADOS[n.estado].chip + '">' +
        esc(ESTADOS[n.estado].et) + '</span><span class="chip cobalto">' +
        esc(PLANES[n.plan].nombre) + "</span></div></div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Logo</p>' +
      '<div class="fila g12">' + logoHtml(n, true) +
        '<div class="pila g8"><label class="btn linea chico" style="align-self:flex-start">Subir logo' +
        '<input type="file" accept="image/*" style="display:none" onchange="subirLogo(' + n.id + ',this)"></label>' +
        (n.logo ? '<button class="btn fantasma chico" onclick="quitarLogo(' + n.id +
          ')">Quitar logo</button>' : "") +
        '<p class="diminuto apagado">Incluido en todos los planes.</p></div></div></div>' +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Datos del negocio</p>' +
      '<div class="rejilla-campos">' +
        '<label class="campo">Nombre<input id="f_nombre" value="' + esc(n.nombre) + '"></label>' +
        '<label class="campo">Ciudad<select id="f_ciudad"><option value="">Elige…</option>' +
          ENTIDADES_CIUDAD.map((x) => '<option value="' + esc(x) + '"' +
            (n.ciudad === x ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select></label>" +
      "</div>" +
      '<label class="campo">Dirección<input id="f_direccion" value="' + esc(n.direccion || "") + '"></label>' +
      '<label class="campo">Teléfono<input id="f_telefono" value="' + esc(n.telefono || "") + '"></label>' +
      '<label class="campo">Categoría principal<select id="f_categoria" onchange="cambiarCategoria(' +
        n.id + ',this.value)">' + CATEGORIAS.map((x) => '<option value="' + x.id + '"' +
          (n.categoria === x.id ? " selected" : "") + ">" + esc(x.icono + " " + x.nombre) + "</option>").join("") +
        "</select></label>" +
      '<div class="pila g8"><span class="campo">Subcategorías <span class="apagado">(hasta ' +
        MAX_SUBCATEGORIAS + " · llevas " + n.sub.length + ')</span></span>' +
        '<div class="subcats">' + c.sub.map((s) =>
          '<button type="button" class="chip ' + (n.sub.includes(s) ? "rosa" : "") +
          '" onclick="alternarSubNegocio(' + n.id + "," + JSON.stringify(s).replace(/"/g, "&quot;") +
          ')">' + esc(s) + "</button>").join("") + "</div></div>" +
      '<label class="campo">Descripción <span class="apagado">(' + L.caracteresDescripcion +
        " caracteres con tu plan)</span>" +
        '<textarea id="f_descripcion" maxlength="' + L.caracteresDescripcion + '">' +
        esc(n.descripcion || "") + "</textarea></label>" +
    "</div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Redes sociales y WhatsApp</p>' +
      '<div class="rejilla-campos">' +
        '<label class="campo">WhatsApp<input id="f_whatsapp" value="' + esc(n.redes.whatsapp || "") +
          '"' + (P.redes ? "" : " disabled") + "></label>" +
        '<label class="campo">Instagram<input id="f_instagram" value="' + esc(n.redes.instagram || "") +
          '"' + (P.redes ? "" : " disabled") + "></label>" +
        '<label class="campo">Facebook<input id="f_facebook" value="' + esc(n.redes.facebook || "") +
          '"' + (P.redes ? "" : " disabled") + "></label>" +
        '<label class="campo">TikTok<input id="f_tiktok" value="' + esc(n.redes.tiktok || "") +
          '"' + (P.redes ? "" : " disabled") + "></label>" +
      "</div>" +
      (P.redes ? "" : cerrado("Las redes sociales y el WhatsApp empiezan en el plan Suscripción. Lo que ya capturaste no se borra.")) +
    "</div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Fotografías</p>' +
      (L.fotos === 0
        ? cerrado("Las fotografías empiezan en el plan Suscripción.")
        : '<p class="pequeno apagado">Tu plan muestra hasta ' + L.fotos + ". Tienes " + n.fotos.length + ".</p>") +
      (n.fotos.length ? '<div class="galeria">' + n.fotos.map((f) =>
        '<div class="foto' + (f.visible ? "" : " oculta") + '">' + imagenHtml(f.url, n.nombre) +
        '<button class="quitar" onclick="quitarFoto(' + n.id + "," + f.id + ')">Quitar</button>' +
        (f.visible ? "" : '<span class="sello">No se muestra</span>') + "</div>").join("") + "</div>" : "") +
      (L.fotos > 0 ? '<label class="btn linea" style="align-self:flex-start">Subir fotografía' +
        '<input type="file" accept="image/*" style="display:none" onchange="subirFoto(' + n.id +
        ',this)"></label>' : "") +
    "</div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Publicaciones</p>' +
      '<p class="pequeno apagado">' + (tope === Infinity
        ? "Publicaciones ilimitadas con tu plan."
        : "Tu plan muestra " + tope + (tope === 1 ? " publicación." : " publicaciones.")) +
        " Tienes " + pubs.length + ".</p>" +
      (pubs.length ? '<div class="pila g8">' + pubs.map((p) =>
        '<div class="publicacion' + (p.destacada ? " destacada" : "") +
        (p.visible ? '"' : '" style="opacity:.5"') + '>' +
        '<div class="fila entre g8"><strong>' + esc(p.titulo) + "</strong>" +
        '<div class="fila g8">' +
          (P.publicacionesDestacadas ? '<button class="btn fantasma chico" onclick="alternarDestacadaPub(' +
            n.id + "," + p.id + ')">' + (p.destacada ? "Quitar destacada" : "Destacar") + "</button>" : "") +
          '<button class="btn fantasma chico" onclick="quitarPublicacion(' + n.id + "," + p.id +
            ')">Borrar</button></div></div>' +
        '<p class="diminuto apagado">' + esc(fecha(p.creado_en)) +
          (p.visible ? "" : " · no se muestra con tu plan") + "</p>" +
        '<p class="pequeno">' + esc(p.texto) + "</p></div>").join("") + "</div>" : "") +
      '<div class="pila g8"><label class="campo">Título<input id="pu_titulo" ' +
        'placeholder="Agenda abierta para diciembre"></label>' +
        '<label class="campo">Texto<textarea id="pu_texto" style="min-height:80px"></textarea></label>' +
        '<div><button class="btn linea" onclick="agregarPublicacion(' + n.id +
          ')">Publicar</button></div></div>' +
    "</div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Productos y servicios</p>' +
      (n.productos.length ? '<div class="pila g8">' + n.productos.map((p) =>
        '<div class="fila entre g8 tarjeta p12"><div><strong>' + esc(p.nombre) + "</strong>" +
        (p.precio ? ' <span class="mono">' + pesos(p.precio) + "</span>" : "") +
        (p.destacado ? ' <span class="chip rosa">Destacado</span>' : "") +
        (p.descripcion ? '<p class="diminuto apagado">' + esc(p.descripcion) + "</p>" : "") + "</div>" +
        '<div class="fila g8">' +
        (P.productosDestacados ? '<button class="btn fantasma chico" onclick="alternarDestacadoProd(' +
          n.id + "," + p.id + ')">' + (p.destacado ? "Quitar" : "Destacar") + "</button>" : "") +
        '<button class="btn fantasma chico" onclick="quitarProducto(' + n.id + "," + p.id +
          ')">Borrar</button></div></div>').join("") + "</div>"
        : '<p class="pequeno apagado">Todavía no agregas productos.</p>') +
      (P.productosDestacados ? "" : cerrado("Destacar productos empieza en el plan Suscripción.")) +
      '<div class="rejilla-campos">' +
        '<label class="campo">Producto o servicio<input id="p_nombre"></label>' +
        '<label class="campo">Precio<input id="p_precio" type="number" min="0"></label>' +
      "</div>" +
      '<label class="campo">Descripción corta<input id="p_desc"></label>' +
      '<div><button class="btn linea" onclick="agregarProducto(' + n.id + ')">Agregar</button></div>' +
    "</div>" +

    '<div class="tarjeta p20 pila g12"><p class="eyebrow">Tu plan</p>' +
      "<p><strong>" + esc(PLANES[n.plan].nombre) + "</strong> · " + esc(PLANES[n.plan].etiqueta) +
        (n.planVence ? '<span class="apagado"> · ' + (n.membresiaVencida ? "venció" : "vigente hasta") + " el " +
          esc(fecha(n.planVence)) + "</span>" : "") + "</p>" +
      (n.bloqueos.length ? '<div class="aviso candado"><ul style="margin:0;padding-left:18px">' +
        n.bloqueos.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul></div>"
        : '<p class="pequeno apagado">Tu plan cubre todo lo que tienes capturado.</p>') +
      '<div class="fila g8"><a class="btn" href="#/planes">Ver planes</a></div>' +
    "</div>" +

    '<div class="fila g8">' +
      '<button class="btn" onclick="guardarNegocio(' + n.id + ')">Guardar cambios</button>' +
      (n.estado === "borrador" || n.estado === "rechazado"
        ? '<button class="btn linea" onclick="mandarRevision(' + n.id + ')">Mandar a revisión</button>' : "") +
    "</div></div>";
}

async function guardarNegocio(id) {
  const nombre = val("f_nombre");
  if (!nombre) return avisar("El negocio necesita un nombre.");
  try {
    await api.patch("/api/negocios/" + id, {
      nombre, ciudad: val("f_ciudad"), direccion: val("f_direccion"), telefono: val("f_telefono"),
      descripcion: val("f_descripcion"),
      redes: { whatsapp: val("f_whatsapp"), instagram: val("f_instagram"), facebook: val("f_facebook"), tiktok: val("f_tiktok") },
    });
    await pintar();
    avisar("Guardamos los cambios.");
  } catch (err) { avisarError(err); }
}

async function cambiarCategoria(id, categoria) {
  try {
    await api.patch("/api/negocios/" + id, { categoria, sub: [] });
    await pintar();
    avisar("Cambiaste de categoría. Vuelve a elegir tus subcategorías.");
  } catch (err) { avisarError(err); }
}

async function alternarSubNegocio(id, s) {
  const n = await api.get("/api/negocios/" + id + "/panel");
  const sub = n.sub.includes(s) ? n.sub.filter((x) => x !== s) : [...n.sub, s];
  if (sub.length > MAX_SUBCATEGORIAS) return avisar("Puedes elegir hasta " + MAX_SUBCATEGORIAS + " subcategorías.");
  try { await api.patch("/api/negocios/" + id, { sub }); await pintar(); }
  catch (err) { avisarError(err); }
}

/* --------------------------------------------------------------- imágenes */
function procesarImagen(input, maxLado, calidad, alGuardar) {
  const archivo = input.files && input.files[0];
  if (!archivo) return;
  const lector = new FileReader();
  lector.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > maxLado || h > maxLado) { const k = Math.min(maxLado / w, maxLado / h); w = Math.round(w * k); h = Math.round(h * k); }
      const lienzo = document.createElement("canvas");
      lienzo.width = w; lienzo.height = h;
      lienzo.getContext("2d").drawImage(img, 0, 0, w, h);
      alGuardar(lienzo.toDataURL("image/jpeg", calidad));
    };
    img.onerror = () => avisar("No pudimos leer esa imagen. Intenta con otra.");
    img.src = ev.target.result;
  };
  lector.readAsDataURL(archivo);
}

function subirFoto(id, input) {
  procesarImagen(input, 900, 0.72, async (dataUrl) => {
    try { await api.post("/api/negocios/" + id + "/fotos", { imagen: dataUrl }); await pintar(); avisar("Subimos tu fotografía."); }
    catch (err) { avisarError(err); }
  });
}
function subirLogo(id, input) {
  procesarImagen(input, 320, 0.8, async (dataUrl) => {
    try { await api.post("/api/negocios/" + id + "/logo", { imagen: dataUrl }); await pintar(); avisar("Actualizamos tu logo."); }
    catch (err) { avisarError(err); }
  });
}
async function quitarLogo(id) {
  try { await api.del("/api/negocios/" + id + "/logo"); await pintar(); avisar("Quitamos el logo."); }
  catch (err) { avisarError(err); }
}
async function quitarFoto(id, fotoId) {
  try { await api.del("/api/negocios/" + id + "/fotos/" + fotoId); await pintar(); avisar("Quitamos la fotografía."); }
  catch (err) { avisarError(err); }
}

/* ---------------------------------------------------------- publicaciones */
async function agregarPublicacion(id) {
  const titulo = val("pu_titulo"), texto = val("pu_texto");
  if (!titulo) return avisar("Ponle título a tu publicación.");
  try {
    const n = await api.post("/api/negocios/" + id + "/publicaciones", { titulo, texto });
    await pintar();
    const L = n.limites.publicaciones;
    avisar(L !== Infinity && n.publicaciones.length > L
      ? "Publicamos, pero tu plan muestra solo " + L + ". Las más recientes se ocultan."
      : "Publicamos tu novedad.");
  } catch (err) { avisarError(err); }
}
async function quitarPublicacion(id, pubId) {
  try { await api.del("/api/negocios/" + id + "/publicaciones/" + pubId); await pintar(); avisar("Borramos la publicación."); }
  catch (err) { avisarError(err); }
}
async function alternarDestacadaPub(id, pubId) {
  try { await api.patch("/api/negocios/" + id + "/publicaciones/" + pubId); await pintar(); }
  catch (err) { avisarError(err); }
}

/* -------------------------------------------------------------- productos */
async function agregarProducto(id) {
  const nombre = val("p_nombre");
  if (!nombre) return avisar("Escribe el nombre del producto.");
  try {
    await api.post("/api/negocios/" + id + "/productos", { nombre, precio: val("p_precio"), descripcion: val("p_desc") });
    await pintar();
    avisar("Agregamos el producto.");
  } catch (err) { avisarError(err); }
}
async function quitarProducto(id, prodId) {
  try { await api.del("/api/negocios/" + id + "/productos/" + prodId); await pintar(); avisar("Quitamos el producto."); }
  catch (err) { avisarError(err); }
}
async function alternarDestacadoProd(id, prodId) {
  try { await api.patch("/api/negocios/" + id + "/productos/" + prodId); await pintar(); }
  catch (err) { avisarError(err); }
}
/* =========================================================== ADMINISTRACIÓN */
async function vistaAdmin(seccion) {
  const s = seccion || "resumen";
  const solicitudes = s === "solicitudes" || s === "resumen" ? await api.get("/api/admin/solicitudes") : [];
  const nuevas = solicitudes.filter((x) => x.estado === "nueva").length;
  const tabs = [["resumen", "Resumen"], ["solicitudes", "Solicitudes" + (nuevas ? " (" + nuevas + ")" : "")],
    ["negocios", "Negocios"], ["usuarias", "Usuarias"], ["resenas", "Reseñas"],
    ["pagos", "Pagos"], ["blog", "Blog"], ["bitacora", "Bitácora"]];

  let contenido;
  if (s === "resumen") contenido = await adminResumen();
  else if (s === "solicitudes") contenido = adminSolicitudes(solicitudes);
  else if (s === "negocios") contenido = await adminNegocios();
  else if (s === "usuarias") contenido = await adminUsuarias();
  else if (s === "resenas") contenido = await adminResenas();
  else if (s === "pagos") contenido = await adminPagos();
  else if (s === "blog") contenido = await adminBlog();
  else contenido = await adminBitacora();

  return '<div class="envoltura shell"><aside class="lateral">' +
    tabs.map(([k, t]) => '<button class="' + (s === k ? "activo" : "") +
      '" onclick="location.hash=\'#/admin/' + k + '\'">' + esc(t) + "</button>").join("") +
    '</aside><div class="pila g24">' + contenido + "</div></div>";
}

const encabezado = (t, d) => '<div class="pila g8"><p class="eyebrow">Organización MÍA</p>' +
  "<h1>" + esc(t) + "</h1>" + (d ? '<p class="apagado pequeno">' + esc(d) + "</p>" : "") + "</div>";

async function adminResumen() {
  const r = await api.get("/api/admin/resumen");
  return encabezado("Resumen") +
    '<div class="metricas">' +
      metrica(r.publicados, "Perfiles publicados") +
      metrica(r.pendientes, "Esperando revisión", "sol") +
      metrica(r.nuevasSolicitudes, "Solicitudes nuevas", "cobalto") +
      metrica(r.enMapa, "En el mapa", "jade") +
      metrica(pesos(r.ingresoMensual), "Ingreso mensual", "jade") +
      metrica(r.totalUsuarios, "Cuentas") +
    "</div>" +
    (r.nuevasSolicitudes ? '<div class="aviso alerta">Tienes ' + r.nuevasSolicitudes + " solicitud(es) sin atender. " +
      '<a href="#/admin/solicitudes" style="color:var(--acento);font-weight:700;margin-left:auto">Verlas</a></div>' : "") +
    (r.pendientes ? '<div class="aviso alerta">Hay ' + r.pendientes + " perfil(es) esperando revisión. " +
      '<a href="#/admin/negocios" style="color:var(--acento);font-weight:700;margin-left:auto">Revisarlos</a></div>' : "") +
    (r.sinPagoConfirmar ? '<div class="aviso">' + r.sinPagoConfirmar +
      " perfil(es) con plan de paga sin confirmar. Operan con reglas del plan Gratuito hasta que confirmes el pago.</div>" : "") +
    (r.membresiasVencidas ? '<div class="aviso">' + r.membresiasVencidas + " perfil(es) con plan vencido.</div>" : "") +
    '<div class="pila g12"><p class="eyebrow">Negocios por plan</p><div class="metricas">' +
      ORDEN_PLANES.map((k) => metrica(r.porPlan[k] || 0, PLANES[k].nombre,
        { gratuito: "sol", suscripcion: "cobalto", membresia: "", crece: "jade" }[k])).join("") +
    "</div></div>";
}

/* ------------------------------------------------------------ solicitudes */
function adminSolicitudes(solicitudes) {
  const filas = solicitudes.map((s) =>
    "<tr><td><strong>" + esc(s.negocio_nombre || s.nombre) + '</strong><br><span class="diminuto apagado mono">' +
      esc(s.correo) + (s.telefono ? " · " + esc(s.telefono) : "") + "</span>" +
      (s.mensaje ? '<p class="diminuto apagado" style="margin-top:4px;max-width:26ch">' + esc(s.mensaje) + "</p>" : "") + "</td>" +
    '<td><span class="chip ' + (s.tipo === "crece" ? "cobalto" : s.tipo === "gratuito" ? "" : "rosa") + '">' +
      esc(s.plan_nombre) + "</span></td>" +
    '<td class="pequeno">' + esc(s.categoria || "—") +
      (s.subcategorias ? '<br><span class="diminuto apagado">' + esc(s.subcategorias) + "</span>" : "") + "</td>" +
    '<td class="diminuto mono">' + esc(new Date(s.creado_en).toLocaleDateString("es-MX")) + "</td>" +
    '<td><span class="chip ' + (s.estado === "nueva" ? "sol" : "jade") + '">' +
      (s.estado === "nueva" ? "Nueva" : "Atendida") + "</span></td>" +
    '<td><button class="btn ' + (s.estado === "nueva" ? "" : "linea") + ' chico" onclick="alternarSolicitud(' +
      s.id + ')">' + (s.estado === "nueva" ? "Marcar atendida" : "Reabrir") + "</button></td></tr>").join("");

  return encabezado("Solicitudes", "Cada formulario de plan deja aquí su registro, listo para revisar y marcar como atendido.") +
    (solicitudes.length
      ? '<div class="tabla-envoltura"><table><thead><tr><th>Negocio</th><th>Plan</th>' +
        "<th>Categoría</th><th>Fecha</th><th>Estado</th><th>Acción</th></tr></thead><tbody>" +
        filas + "</tbody></table></div>"
      : vacio("Todavía no llegan solicitudes. Llena un formulario desde la sección de Planes para probarlo."));
}

async function alternarSolicitud(id) {
  try { await api.patch("/api/admin/solicitudes/" + id); await pintar(); }
  catch (err) { avisarError(err); }
}

/* --------------------------------------------------------------- negocios */
async function adminNegocios() {
  const negocios = await api.get("/api/admin/negocios");
  const filas = negocios.map((n) => {
    return '<tr><td><div class="fila g8">' + logoHtml(n) + "<div><strong>" + esc(n.nombre) +
        '</strong><br><span class="diminuto apagado">' + esc(n.propietariaNombre || "—") +
        " · " + esc(n.ciudad || "sin ciudad") + '</span><br><span class="diminuto apagado">' +
        cat(n.categoria).icono + " " + esc(cat(n.categoria).nombre) + "</span></div></div></td>" +
      '<td><span class="chip ' + ESTADOS[n.estado].chip + '">' + esc(ESTADOS[n.estado].et) + "</span></td>" +
      '<td><select onchange="adminPlan(' + n.id + ',this.value)" style="min-width:126px">' +
        ORDEN_PLANES.map((k) => '<option value="' + k + '"' + (n.plan === k ? " selected" : "") + ">" +
          esc(PLANES[k].nombre) + "</option>").join("") + "</select>" +
        (n.membresiaVencida ? '<br><span class="chip peligro" style="margin-top:4px">Vencido</span>' : "") +
        (!n.pagoConfirmado ? '<br><button class="btn chico" style="margin-top:4px" onclick="confirmarPago(' +
          n.id + ')">Confirmar pago</button>' : "") + "</td>" +
      '<td class="mono">' + n.vistas + "</td>" +
      '<td><div class="fila g8">' +
        (n.estado === "pendiente"
          ? '<button class="btn chico" onclick="adminAprobar(' + n.id + ')">Publicar</button>' +
            '<button class="btn linea chico" onclick="adminRechazar(' + n.id + ')">Pedir cambios</button>' : "") +
        (n.estado === "publicado"
          ? '<button class="btn linea chico" onclick="adminVerificar(' + n.id + ')">' +
            (n.verificado ? "Quitar verificado" : "Verificar") + "</button>" +
            '<button class="btn peligro chico" onclick="adminSuspender(' + n.id + ')">Suspender</button>' : "") +
        (n.estado === "suspendido"
          ? '<button class="btn chico" onclick="adminAprobar(' + n.id + ')">Reactivar</button>' : "") +
        '<button class="btn fantasma chico" onclick="location.hash=\'#/editar/' + n.id +
          '\'">Editar</button></div></td></tr>';
  }).join("");

  return encabezado("Negocios", "Publica los perfiles que esperan, confirma pagos, cambia planes, verifica o detén perfiles.") +
    '<div class="tabla-envoltura"><table><thead><tr><th>Negocio</th><th>Estado</th><th>Plan</th>' +
    "<th>Visitas</th><th>Acciones</th></tr></thead><tbody>" + filas + "</tbody></table></div>";
}

async function adminAprobar(id) { try { await api.post("/api/admin/negocios/" + id + "/aprobar"); await pintar(); avisar("Perfil publicado."); } catch (err) { avisarError(err); } }
async function adminRechazar(id) {
  const nota = prompt("¿Qué necesita corregir este negocio?", "Falta una descripción más completa.");
  if (nota === null) return;
  try { await api.post("/api/admin/negocios/" + id + "/rechazar", { nota }); await pintar(); avisar("Le pedimos cambios."); }
  catch (err) { avisarError(err); }
}
async function adminSuspender(id) {
  const nota = prompt("Motivo de la suspensión:", "Información falsa en el perfil.");
  if (nota === null) return;
  try { await api.post("/api/admin/negocios/" + id + "/suspender", { nota }); await pintar(); avisar("Perfil suspendido."); }
  catch (err) { avisarError(err); }
}
async function adminVerificar(id) {
  try { const n = await api.patch("/api/admin/negocios/" + id + "/verificado"); await pintar();
    avisar(n.verificado ? (n.permisos.verificado ? "Perfil verificado." : "Quedó verificado, pero la insignia solo se muestra con Membresía.") : "Le quitamos la verificación."); }
  catch (err) { avisarError(err); }
}
async function adminPlan(id, plan) {
  try { await api.patch("/api/admin/negocios/" + id + "/plan", { plan }); await pintar(); avisar("Plan actualizado."); }
  catch (err) { avisarError(err); }
}
async function confirmarPago(id) {
  try { await api.post("/api/admin/negocios/" + id + "/confirmar-pago"); await pintar(); avisar("Confirmamos el pago. Ya tiene todos sus beneficios."); }
  catch (err) { avisarError(err); }
}

/* --------------------------------------------------------------- usuarias */
async function adminUsuarias() {
  const usuarias = await api.get("/api/admin/usuarias");
  const rolEt = { admin: "Organización MÍA", negocio: "Negocio", usuario: "Clienta" };
  const filas = usuarias.map((u) => {
    const esYo = u.id === YO.id;
    return "<tr><td><strong>" + esc(u.nombre) + '</strong><br><span class="diminuto apagado mono">' +
        esc(u.correo) + "</span></td>" +
      '<td><select onchange="adminRol(' + u.id + ',this.value)"' + (esYo ? " disabled" : "") +
        ' style="min-width:150px">' + Object.entries(rolEt).map(([k, t]) => '<option value="' + k + '"' +
          (u.rol === k ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></td>" +
      '<td><span class="chip ' + (u.estado === "activo" ? "jade" : "peligro") + '">' +
        (u.estado === "activo" ? "Activa" : "Suspendida") + "</span></td>" +
      '<td class="mono">' + u.total_negocios + "</td>" +
      "<td>" + (esYo ? '<span class="diminuto apagado">Eres tú</span>'
        : '<button class="btn ' + (u.estado === "activo" ? "peligro" : "") +
          ' chico" onclick="adminSuspenderUsuaria(' + u.id + ')">' +
          (u.estado === "activo" ? "Suspender" : "Reactivar") + "</button>") + "</td></tr>";
  }).join("");
  return encabezado("Usuarias", "Cambia el tipo de cuenta o suspende el acceso. Al suspender, su sesión deja de servir de inmediato.") +
    '<div class="tabla-envoltura"><table><thead><tr><th>Persona</th><th>Tipo de cuenta</th>' +
    "<th>Estado</th><th>Perfiles</th><th>Acción</th></tr></thead><tbody>" + filas + "</tbody></table></div>";
}
async function adminRol(id, rol) {
  try { await api.patch("/api/admin/usuarias/" + id + "/rol", { rol }); await pintar(); avisar("Actualizamos el tipo de cuenta."); }
  catch (err) { avisarError(err); }
}
async function adminSuspenderUsuaria(id) {
  try { const u = await api.patch("/api/admin/usuarias/" + id + "/suspension");
    await pintar(); avisar(u.estado === "activo" ? "Reactivamos la cuenta." : "Suspendimos la cuenta."); }
  catch (err) { avisarError(err); }
}

/* ---------------------------------------------------------------- reseñas */
async function adminResenas() {
  const resenas = await api.get("/api/admin/resenas");
  const filas = resenas.map((r) =>
    "<tr><td>" + estrellasHtml(r.calificacion) + '<p class="pequeno" style="margin-top:4px">' +
      esc(r.comentario.slice(0, 120)) + (r.comentario.length > 120 ? "…" : "") + "</p></td>" +
      '<td class="pequeno">' + esc(r.negocio_nombre || "—") + "</td>" +
      '<td class="pequeno">' + esc(r.autora || "—") + "</td>" +
      '<td><span class="chip ' + (r.estado === "publicada" ? "jade" : "peligro") + '">' +
        (r.estado === "publicada" ? "Publicada" : "Oculta") + "</span></td>" +
      '<td><button class="btn ' + (r.estado === "publicada" ? "peligro" : "") +
        ' chico" onclick="adminOcultar(' + r.id + ')">' +
        (r.estado === "publicada" ? "Ocultar" : "Publicar") + "</button></td></tr>").join("");
  return encabezado("Reseñas", "Oculta las reseñas ofensivas o con publicidad. Una reseña oculta deja de contar para la calificación.") +
    '<div class="tabla-envoltura"><table><thead><tr><th>Reseña</th><th>Negocio</th><th>Autora</th>' +
    "<th>Estado</th><th>Acción</th></tr></thead><tbody>" + filas + "</tbody></table></div>";
}
async function adminOcultar(id) {
  try { await api.patch("/api/admin/resenas/" + id + "/oculta"); await pintar(); avisar("Actualizamos la reseña."); }
  catch (err) { avisarError(err); }
}

/* ------------------------------------------------------------------- pagos */
const ESTADO_PAGO = {
  pagado: { et: "Pagado", chip: "jade" },
  fallido: { et: "Falló", chip: "peligro" },
  cancelado: { et: "Cancelado", chip: "" },
};
const TIPO_EVENTO_STRIPE = {
  "checkout.session.completed": "Alta",
  "invoice.paid": "Renovación",
  "invoice.payment_failed": "Cobro fallido",
  "customer.subscription.deleted": "Cancelación",
};

async function adminPagos() {
  const pagos = await api.get("/api/admin/pagos");
  const filas = pagos.map((p) => {
    const est = ESTADO_PAGO[p.estado] || { et: p.estado, chip: "" };
    return "<tr><td>" + (p.negocio_slug
        ? '<a href="#/negocio/' + esc(p.negocio_slug) + '">' + esc(p.negocio_nombre) + "</a>"
        : '<span class="apagado">' + esc(p.negocio_nombre || "—") + "</span>") + "</td>" +
      '<td class="pequeno">' + esc(TIPO_EVENTO_STRIPE[p.tipo] || p.tipo) + "</td>" +
      '<td class="pequeno">' + esc(p.plan ? (PLANES[p.plan]?.nombre || p.plan) : "—") + "</td>" +
      '<td class="mono">' + (p.monto != null ? pesos(p.monto) + " " + esc((p.moneda || "").toUpperCase()) : "—") + "</td>" +
      '<td><span class="chip ' + est.chip + '">' + esc(est.et) + "</span></td>" +
      '<td class="diminuto mono">' + esc(new Date(p.creado_en).toLocaleString("es-MX")) + "</td></tr>";
  }).join("");

  return encabezado("Pagos", "Cada evento que confirma Stripe queda aquí: altas, renovaciones, cobros fallidos y cancelaciones.") +
    (pagos.length
      ? '<div class="tabla-envoltura"><table><thead><tr><th>Negocio</th><th>Evento</th><th>Plan</th>' +
        "<th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>" + filas + "</tbody></table></div>"
      : vacio("Todavía no hay pagos procesados por Stripe."));
}

/* ------------------------------------------------------------------- blog */
async function adminBlog() {
  const articulos = await api.get("/api/blog");
  return encabezado("Blog", "Escribe y publica los artículos de MÍA.") +
    '<div class="tarjeta p20 pila g12"><p class="eyebrow">Nuevo artículo</p>' +
      '<label class="campo">Título<input id="b_titulo"></label>' +
      '<label class="campo">Resumen<input id="b_resumen" placeholder="Una línea que invite a leer."></label>' +
      '<label class="campo">Contenido <span class="apagado">(deja una línea en blanco entre párrafos)</span>' +
        '<textarea id="b_cuerpo" style="min-height:170px"></textarea></label>' +
      '<div><button class="btn" onclick="crearArticulo()">Publicar artículo</button></div></div>' +
    (articulos.length ? '<div class="pila g12">' + articulos.map((a) =>
      '<div class="tarjeta p16 fila entre g8"><div style="flex:1;min-width:180px">' +
        '<div class="fila g8"><span class="chip ' + (a.publicado ? "jade" : "sol") + '">' +
        (a.publicado ? "Publicado" : "Borrador") + '</span><span class="diminuto apagado">' +
        esc(fecha(a.creado_en)) + "</span></div>" +
        "<strong>" + esc(a.titulo) + '</strong><p class="diminuto apagado">' + esc(a.resumen) + "</p></div>" +
        '<div class="fila g8"><a class="btn fantasma chico" href="#/blog/' + esc(a.slug) + '">Ver</a>' +
        '<button class="btn linea chico" onclick="alternarArticulo(' + a.id + ')">' +
        (a.publicado ? "Ocultar" : "Publicar") + "</button>" +
        '<button class="btn fantasma chico" onclick="borrarArticulo(' + a.id + ')">Borrar</button></div></div>'
    ).join("") + "</div>" : vacio("Todavía no hay artículos."));
}
async function crearArticulo() {
  const titulo = val("b_titulo"), cuerpo = val("b_cuerpo");
  if (!titulo) return avisar("Ponle título al artículo.");
  try {
    await api.post("/api/admin/blog", { titulo, resumen: val("b_resumen"), cuerpo });
    await pintar();
    avisar("Publicamos el artículo.");
  } catch (err) { avisarError(err); }
}
async function alternarArticulo(id) {
  try { await api.patch("/api/admin/blog/" + id); await pintar(); }
  catch (err) { avisarError(err); }
}
async function borrarArticulo(id) {
  if (!confirm("¿Borrar este artículo?")) return;
  try { await api.del("/api/admin/blog/" + id); await pintar(); avisar("Borramos el artículo."); }
  catch (err) { avisarError(err); }
}

/* --------------------------------------------------------------- bitácora */
async function adminBitacora() {
  const bitacora = await api.get("/api/admin/bitacora");
  return encabezado("Bitácora", "Queda registro de cada acción administrativa.") +
    (bitacora.length
      ? '<div class="tabla-envoltura"><table><thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th>' +
        "<th>Detalle</th></tr></thead><tbody>" + bitacora.map((b) =>
        '<tr><td class="diminuto mono">' + esc(new Date(b.creado_en).toLocaleString("es-MX")) + "</td>" +
        '<td class="pequeno">' + esc(b.actor_nombre || "Sistema") + "</td>" +
        "<td><strong>" + esc(b.accion) + '</strong></td><td class="pequeno apagado">' +
        esc(b.detalle) + "</td></tr>").join("") + "</tbody></table></div>"
      : vacio("Todavía no hay movimientos. Publica o suspende un perfil y aparecerá aquí."));
}

/* ================================================================= ARRANQUE */
arrancar();
