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
/** El primer negocio de la dueña, para que la barra de abajo pueda mandarla
 * directo a Publicación/Producto/Mensajes de SU negocio sin preguntarle cuál. */
let MI_NEGOCIO_ID = null;

const MAX_SUBCATEGORIAS = 7;
const MAX_CATEGORIAS = 2;

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
  const [categorias, planes, municipios, sesion] = await Promise.all([
    api.get("/api/categorias"),
    api.get("/api/planes"),
    api.get("/api/municipios"),
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
  MUNICIPIOS_POR_ESTADO = municipios;
  YO = sesion;
  await actualizarMiNegocioId();
  avisarRetornoDeStripe();
  pintar();
  registrarServiceWorker();
}

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => { /* sin instalación offline, no es grave */ });
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
  await actualizarMiNegocioId();
}

async function actualizarMiNegocioId() {
  MI_NEGOCIO_ID = null;
  if (!YO || YO.rol !== "negocio") return;
  try {
    const mios = await api.get("/api/mis-negocios");
    MI_NEGOCIO_ID = mios[0] ? mios[0].id : null;
  } catch { /* la barra de abajo cae de vuelta a "Mi negocio" */ }
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

/** A qué estado pertenece cada una de las ciudades de arriba, para poder
 * ofrecer TODOS los municipios (o, en la Ciudad de México, las 16 alcaldías)
 * de ese estado — no nada más los de la ciudad elegida. Los nombres de
 * estado son exactamente los que usa el catálogo de INEGI. */
const CIUDAD_A_ESTADO = {
  "Ciudad de México": "Ciudad de México", "Guadalajara": "Jalisco", "Monterrey": "Nuevo León",
  "Puebla": "Puebla", "Querétaro": "Querétaro", "Mérida": "Yucatán",
  "Cancún": "Quintana Roo", "Tijuana": "Baja California", "León": "Guanajuato",
  "Oaxaca de Juárez": "Oaxaca", "San Luis Potosí": "San Luis Potosí", "Aguascalientes": "Aguascalientes",
  "Toluca": "México", "Culiacán": "Sinaloa", "Hermosillo": "Sonora",
  "Chihuahua": "Chihuahua", "Veracruz": "Veracruz de Ignacio de la Llave", "Xalapa": "Veracruz de Ignacio de la Llave",
  "Morelia": "Michoacán de Ocampo", "Cuernavaca": "Morelos", "Tuxtla Gutiérrez": "Chiapas",
  "Villahermosa": "Tabasco", "Saltillo": "Coahuila de Zaragoza", "Durango": "Durango",
  "Zacatecas": "Zacatecas", "Tepic": "Nayarit", "Colima": "Colima",
  "Pachuca": "Hidalgo", "Tlaxcala": "Tlaxcala", "Campeche": "Campeche",
  "Chetumal": "Quintana Roo", "La Paz": "Baja California Sur", "Mexicali": "Baja California",
  "Ciudad Victoria": "Tamaulipas", "Playa del Carmen": "Quintana Roo", "Puerto Vallarta": "Jalisco",
  "San Cristóbal de las Casas": "Chiapas", "Guanajuato": "Guanajuato", "Acapulco": "Guerrero",
  "Mazatlán": "Sinaloa", "Tampico": "Tamaulipas", "Irapuato": "Guanajuato",
};
/** Catálogo completo de municipios por estado (INEGI). Se trae de /api/municipios
 * al arrancar, junto con categorías y planes, para no meter ~2,500 nombres
 * directo en este archivo. */
let MUNICIPIOS_POR_ESTADO = {};
const alcaldiasDe = (ciudad) => {
  if (!ciudad) return [];
  const estado = CIUDAD_A_ESTADO[ciudad];
  const lista = estado && MUNICIPIOS_POR_ESTADO[estado];
  return lista && lista.length ? lista : [ciudad];
};

/** Repuebla el <select> de alcaldía/municipio según la ciudad elegida (prefijo "g" o "f"). */
function pintarAlcaldias(prefijo) {
  const sel = $(prefijo + "_alcaldia");
  if (!sel) return;
  const actual = sel.value;
  const opciones = alcaldiasDe(val(prefijo + "_ciudad"));
  sel.disabled = !opciones.length;
  sel.innerHTML = opciones.length
    ? '<option value="">Elige…</option>' + opciones.map((a) => '<option value="' + esc(a) + '">' + esc(a) + "</option>").join("")
    : '<option value="">Primero elige una ciudad</option>';
  if (opciones.includes(actual)) sel.value = actual;
}

/* ================================================================= UTILIDAD */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** El servidor manda Infinity como null (JSON no la soporta): se restaura
 * aquí para poder seguir comparando "=== Infinity" con los límites del
 * panel de un negocio, igual que ya se hace con el catálogo de planes. */
function conLimitesRestaurados(n) {
  if (n && n.limites) for (const k of Object.keys(n.limites)) if (n.limites[k] === null) n.limites[k] = Infinity;
  return n;
}
async function obtenerPanel(id) {
  return conLimitesRestaurados(await api.get("/api/negocios/" + id + "/panel"));
}
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id) ? $(id).value.trim() : "");
const marcado = (id) => Boolean($(id) && $(id).checked);

function avisar(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("ver");
  clearTimeout(avisar._t); avisar._t = setTimeout(() => t.classList.remove("ver"), 3400);
}

function avisarError(err) {
  avisar(err instanceof ErrorApi ? err.message : "Ocurrió un error. Intenta de nuevo.");
}

const pesos = (v) => (v === null || v === undefined || v === "") ? ""
  : "$" + Number(v).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** "Ciudad de México, Xochimilco" si capturó la alcaldía/municipio; si no, solo la ciudad. */
const ciudadCompleta = (n) => n.ciudad ? n.ciudad + (n.alcaldiaMunicipio ? ", " + n.alcaldiaMunicipio : "") : "";

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

/** El primer plano de un negocio: su foto de portada elegida, o si no hay, la primera foto capturada. */
function primeraFotoUrl(n) {
  if (n.banner) return n.banner;
  if (n.portada) return n.portada;
  if (Array.isArray(n.fotos) && n.fotos.length) {
    const f = n.fotos[0];
    return typeof f === "string" ? f : f.url;
  }
  return null;
}

/** La miniatura de la tarjeta del directorio: prioriza la foto destacada, para
 * que no se repita ahí lo mismo que ya se ve en el logo o la portada del perfil. */
function fotoDirectorioUrl(n) {
  return n.fotoDestacada || primeraFotoUrl(n);
}

function portadaHtml(n, alto) {
  const f = alto ? primeraFotoUrl(n) : fotoDirectorioUrl(n);
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

/** El menú de arriba a la derecha: se ve en cualquier página, para
 * cualquier tipo de cuenta (negocio, clienta o anónima) — a diferencia de
 * "Cerrar sesión", que antes solo vivía adentro de "Mi negocio"/"Tu cuenta"
 * y por eso costaba encontrarlo. Con sesión, además suma Notificaciones
 * (incluidas las de negocios que sigues) y Mensajes, cada una con su
 * contador de lo que falta por leer — para negocio y para clienta por igual. */
async function actualizarMenuCabecera() {
  const cont = $("menu_cabecera"), btn = $("btn_menu_cabecera");
  if (!cont || !btn) return;
  cont.hidden = true;
  btn.setAttribute("aria-expanded", "false");

  let noLeidas = 0, mensajesSinLeer = 0, destinoMensajes = null;
  if (YO) {
    try { noLeidas = (await api.get("/api/notificaciones")).noLeidas; } catch { /* sin notificaciones */ }
    try {
      if (YO.rol === "usuario") {
        destinoMensajes = "#/mensajes";
        mensajesSinLeer = (await api.get("/api/mis-mensajes")).reduce((s, c) => s + c.no_leidos, 0);
      } else if (YO.rol === "negocio") {
        destinoMensajes = MI_NEGOCIO_ID ? "#/negocio-mensajes/" + MI_NEGOCIO_ID : "#/panel";
        if (MI_NEGOCIO_ID) {
          mensajesSinLeer = (await api.get("/api/negocios/" + MI_NEGOCIO_ID + "/mensajes")).reduce((s, c) => s + c.no_leidos, 0);
        }
      }
    } catch { /* sin mensajes */ }
  }
  const conteo = (n) => (n > 0 ? '<span class="conteo-menu">' + (n > 99 ? "99+" : n) + "</span>" : "");

  cont.innerHTML =
    '<a href="#/mapa" role="menuitem">Mapa</a>' +
    '<a href="#/blog" role="menuitem">Blog</a>' +
    '<a href="#/planes" role="menuitem">Planes</a>' +
    (YO
      ? "<hr>" +
        '<a href="#/notificaciones" role="menuitem">Notificaciones' + conteo(noLeidas) + "</a>" +
        (destinoMensajes ? '<a href="' + destinoMensajes + '" role="menuitem">Mensajes' + conteo(mensajesSinLeer) + "</a>" : "") +
        '<hr><button role="menuitem" class="salir" onclick="alternarMenuCabecera(false);salir()">Cerrar sesión</button>'
      : '<hr><a href="#/entrar" role="menuitem">Entrar</a>');
}

function alternarMenuCabecera(forzarAbierto) {
  const cont = $("menu_cabecera"), btn = $("btn_menu_cabecera");
  if (!cont || !btn) return;
  const abrir = forzarAbierto !== undefined ? forzarAbierto : cont.hidden;
  cont.hidden = !abrir;
  btn.setAttribute("aria-expanded", String(abrir));
}

document.addEventListener("click", (e) => {
  const cont = $("menu_cabecera"), btn = $("btn_menu_cabecera");
  if (!cont || cont.hidden) return;
  if (!cont.contains(e.target) && !btn.contains(e.target)) alternarMenuCabecera(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") alternarMenuCabecera(false);
});

/** Enlaces que ya no caben en la barra de pestañas de abajo: viven dentro de
 * "Mi negocio", "Administración" y "Tu cuenta", cada quien con los suyos. */
function enlacesSecundarios() {
  return '<div class="fila g8" style="flex-wrap:wrap">' +
    '<a class="btn linea chico" href="#/mapa">Mapa</a>' +
    '<a class="btn linea chico" href="#/blog">Blog</a>' +
    '<a class="btn linea chico" href="#/app">App</a>' +
    '<a class="btn linea chico" href="#/sobre">Sobre MÍA</a>' +
    '<a class="btn linea chico" href="#/planes">Planes</a>' +
    '<button class="btn fantasma chico" onclick="salir()">Cerrar sesión</button>' +
  "</div>";
}

const ICONO_BUSCAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle>' +
  '<line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
const ICONO_GRID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect>' +
  '<rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect>' +
  '<rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>';
const ICONO_CORAZON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.2-4.5-9.7-9C.7 8.6 2 5.3 5.3 5.3c1.9 0 ' +
  '3.4 1.1 4.4 2.6a5.3 5.3 0 0 1 4.4-2.6c3.3 0 4.6 3.3 3 6.7-2.5 4.5-9.7 9-9.7 9Z"></path></svg>';
const ICONO_PERSONA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle>' +
  '<path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"></path></svg>';
const ICONO_NEGOCIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"></rect>' +
  '<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
const ICONO_ESCUDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 8.6 8 11 4.6-2.4 8-6 8-11V5Z">' +
  "</path></svg>";
const ICONO_ENTRAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>' +
  '<polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>';
const ICONO_PUBLICACION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5v3a2 2 0 0 0 2 2h1l3 5v-5h2l7 4V5l-7 4H6a2 2 0 0 0-2 2Z">' +
  "</path></svg>";
const ICONO_PRODUCTO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 12.9 12.9 20.6a2 2 0 0 1-2.8 0l-7.7-7.7a2 2 0 0 1' +
  '-.6-1.4V4.5A1.5 1.5 0 0 1 3.3 3h6.6c.5 0 1 .2 1.4.6l7.7 7.7a2 2 0 0 1 0 2.8Z"></path>' +
  '<circle cx="7.2" cy="7.7" r="1.1" fill="currentColor" stroke="none"></circle></svg>';
const ICONO_MENSAJE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.5 8.7 8.7 0 0 1-4-1L3 20l1.1' +
  '-4.7a8.4 8.4 0 0 1-1-4A8.4 8.4 0 0 1 12 3a8.6 8.6 0 0 1 9 8.5Z"></path></svg>';

/** Barra fija de abajo, estilo app: Explorar, Categorías, Favoritos y Perfil
 * (este último cambia de ícono y a dónde lleva según el tipo de cuenta). */
function barraTabs() {
  const v = ruta().vista;
  const tab = (href, icono, etiqueta, activa, puntito) =>
    '<a href="' + href + '" class="' + (activa ? "activo" : "") + '">' + icono +
    (puntito ? '<span class="punto" id="punto_notif" style="display:none"></span>' : "") +
    "<span>" + etiqueta + "</span></a>";

  // Una dueña de negocio no viene a buscar ni a guardar favoritos: viene a
  // impulsar el suyo. Su barra es otra por completo.
  if (YO && YO.rol === "negocio") {
    const base = MI_NEGOCIO_ID ? "#/editar/" + MI_NEGOCIO_ID : "#/panel";
    const basePub = MI_NEGOCIO_ID ? "#/publicaciones/" + MI_NEGOCIO_ID : "#/panel";
    const baseProd = MI_NEGOCIO_ID ? "#/productos/" + MI_NEGOCIO_ID : "#/panel";
    $("tabs").innerHTML =
      tab("#/panel", ICONO_NEGOCIO, "Perfil", v === "panel" || v === "editar") +
      tab(basePub, ICONO_PUBLICACION, "Publicación", v === "publicaciones" || v === "publicacion") +
      tab(baseProd, ICONO_PRODUCTO, "Producto", v === "productos") +
      tab(MI_NEGOCIO_ID ? "#/negocio-mensajes/" + MI_NEGOCIO_ID : "#/panel", ICONO_MENSAJE, "Mensajes",
        v === "negocio-mensajes", true);
    actualizarBadgeNotificaciones();
    return;
  }

  let iconoPerfil = ICONO_ENTRAR, destinoPerfil = "entrar", vistasActivas = ["entrar"];
  if (YO) {
    if (YO.rol === "admin") { iconoPerfil = ICONO_ESCUDO; destinoPerfil = "admin"; vistasActivas = ["admin"]; }
    else { iconoPerfil = ICONO_PERSONA; destinoPerfil = "cuenta"; vistasActivas = ["cuenta"]; }
  }
  const conNotificaciones = YO && YO.rol === "usuario";
  $("tabs").innerHTML =
    tab("#/inicio", ICONO_BUSCAR, "Explorar", v === "inicio") +
    tab("#/directorio", ICONO_GRID, "Categorías", v === "directorio") +
    tab("#/favoritos", ICONO_CORAZON, "Favoritos", v === "favoritos") +
    tab("#/" + destinoPerfil, iconoPerfil, "Perfil", vistasActivas.includes(v), conNotificaciones);

  if (conNotificaciones) actualizarBadgeNotificaciones();
}

async function actualizarBadgeNotificaciones() {
  try {
    const { noLeidas } = await api.get("/api/notificaciones");
    const b = $("punto_notif");
    if (!b) return;
    b.style.display = noLeidas > 0 ? "block" : "none";
  } catch { /* sin notificaciones */ }
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
    else if (vista === "app") html = vistaApp();
    else if (vista === "privacidad") html = vistaPrivacidad();
    else if (vista === "planes") html = vistaPlanes();
    else if (vista === "registro") html = vistaRegistro(arg);
    else if (vista === "entrar") html = vistaEntrar(arg);
    else if (vista === "favoritos") html = YO ? await vistaFavoritos() : sinAcceso();
    else if (vista === "mensajes") html = YO ? (arg ? await vistaHiloMensaje(arg) : await vistaBandejaMensajes()) : sinAcceso();
    else if (vista === "notificaciones") html = YO && (YO.rol === "usuario" || YO.rol === "negocio") ? await vistaNotificaciones() : sinAcceso();
    else if (vista === "ventas") html = YO ? await vistaVentas(arg) : sinAcceso();
    else if (vista === "negocio-mensajes") html = YO && (YO.rol === "negocio" || YO.rol === "admin")
      ? await vistaMensajesNegocio(arg) : sinAcceso();
    else if (vista === "panel") html = YO && (YO.rol === "negocio" || YO.rol === "admin") ? await vistaPanel() : sinAcceso();
    else if (vista === "editar") html = YO ? await vistaEditar(arg) : sinAcceso();
    else if (vista === "publicaciones") html = YO ? await vistaPublicaciones(arg) : sinAcceso();
    else if (vista === "productos") html = YO ? await vistaProductos(arg) : sinAcceso();
    else if (vista === "publicacion") html = await vistaPublicacionDetalle(arg);
    else if (vista === "reporte") html = YO ? await vistaReporte(arg) : sinAcceso();
    else if (vista === "admin") html = esAdmin() ? await vistaAdmin(arg) : sinAcceso();
    else if (vista === "cuenta") html = YO && YO.rol === "usuario" ? vistaCuenta() : sinAcceso();
    else html = await vistaInicio();

    app.innerHTML = html;
  } catch (err) {
    app.innerHTML = '<div class="envoltura bloque"><h2>No se pudo cargar esta página</h2>' +
      '<p class="apagado" style="margin-top:10px">' + esc(err instanceof ErrorApi ? err.message : String(err)) + "</p>" +
      '<p style="margin-top:14px"><a class="btn" href="#/inicio">Volver al inicio</a></p></div>';
  }
  app.removeAttribute("aria-busy");
  barraTabs();
  actualizarMenuCabecera();
  window.scrollTo(0, 0);
  if (vista === "mapa") dibujarMapa(ultimoMapa);
  if (vista === "blog" && arg) iniciarCarrusel();
}

function sinAcceso() {
  return '<div class="envoltura bloque pila g16" style="max-width:520px">' +
    "<h2>Esta sección no es para tu tipo de cuenta</h2>" +
    '<p class="apagado">En MÍA cada quien ve lo suyo: la organización administra, los negocios ' +
    "editan su perfil y las visitantes dejan reseñas y guardan favoritos.</p>" +
    '<div class="fila g8"><a class="btn" href="#/entrar">Iniciar sesión</a></div></div>';
}

/** "Perfil" de una clienta: sus atajos y, aparte, todo lo que ya no cabe en la barra de abajo. */
function vistaCuenta() {
  return '<div class="envoltura bloque pila g24" style="max-width:480px">' +
    '<div class="pila g4"><p class="eyebrow">Tu cuenta</p>' +
      "<h1>" + esc(YO.nombre) + "</h1>" +
      '<p class="apagado pequeno">' + esc(YO.correo) + "</p></div>" +

    '<div class="tarjeta p12 pila g4">' +
      '<a class="btn fantasma ancho" style="justify-content:flex-start" href="#/mensajes">💬 Mensajes</a>' +
      '<a class="btn fantasma ancho" style="justify-content:flex-start" href="#/notificaciones">🔔 Notificaciones</a>' +
      '<a class="btn fantasma ancho" style="justify-content:flex-start" href="#/favoritos">♡ Favoritos</a>' +
    "</div>" +

    '<div class="pila g8"><p class="eyebrow">Más de MÍA</p>' +
      enlacesSecundarios() +
    "</div>" +
  "</div>";
}

const vacio = (msg) => '<div class="tarjeta p24 pila g8"><h3>Nada por aquí todavía</h3>' +
  '<p class="apagado pequeno">' + esc(msg) + "</p></div>";

const escalon = (n, t, d) => '<div class="escalon"><span class="num">' + n + "</span>" +
  "<div><strong>" + esc(t) + '</strong><p class="pequeno apagado">' + esc(d) + "</p></div></div>";

/** Botones circulares de redes sociales: solo aparece el de la red que la dueña llenó. */
const REDES_SOCIALES = {
  whatsapp: { color: "#25D366", etiqueta: "WhatsApp",
    svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.9c0 1.77.47 3.4 1.27 4.85L2 22l5.4-1.4a9.9 9.9 0 0 0 4.64 1.18h0c5.46 0 9.9-4.44 9.9-9.9C21.95 6.45 17.5 2 12.04 2Zm5.8 14.09c-.25.68-1.43 1.31-1.97 1.36-.5.06-1.13.09-1.83-.11-.42-.13-.96-.3-1.65-.6-2.9-1.25-4.8-4.17-4.94-4.36-.15-.19-1.18-1.57-1.18-3 0-1.42.75-2.12 1.01-2.41.27-.29.58-.36.78-.36.19 0 .39 0 .56.01.18.01.42-.07.65.5.24.58.82 2 .89 2.15.07.15.12.32.02.51-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.18 1.53 1.91 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.61-.07.17-.19.71-.83.9-1.11.19-.28.38-.24.63-.14.26.09 1.65.78 1.93.92.28.14.47.21.54.33.07.12.07.68-.18 1.36Z"/></svg>' },
  instagram: { color: "#C13584", etiqueta: "Instagram",
    svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1" fill="#fff" stroke="none"/></svg>' },
  facebook: { color: "#1877F2", etiqueta: "Facebook",
    svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="#fff"><path d="M15 8.5h2.5V5.3c-.43-.06-1.9-.2-3.6-.2-3.57 0-5.9 2.18-5.9 6.17V14H4.5v3.6H8V24h3.7v-6.4h3.08l.5-3.6H11.7v-2.4c0-1.04.28-1.76 1.78-1.76H15Z"/></svg>' },
  tiktok: { color: "#000", etiqueta: "TikTok",
    svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="#fff"><path d="M16.7 3h-3.2v12.4a2.6 2.6 0 1 1-1.9-2.5V9.5a5.9 5.9 0 1 0 5.1 5.85V9.9a7.9 7.9 0 0 0 4.3 1.28V8a4.7 4.7 0 0 1-4.3-5Z"/></svg>' },
};
const botonesRedesSociales = (n) => Object.keys(REDES_SOCIALES)
  .filter((tipo) => n.redes[tipo])
  .map((tipo) => {
    const r = REDES_SOCIALES[tipo];
    return '<a class="red-social" style="background:' + r.color + '" target="_blank" rel="noopener" ' +
      'title="' + r.etiqueta + '" aria-label="' + r.etiqueta + '" onclick="registrarClic(' + n.id +
      ",'" + tipo + "')\" href=\"" + esc(n.redes[tipo]) + '">' + r.svg + "</a>";
  }).join("");

/** Casillas de consentimiento: obligatoria la de privacidad, opcional la de noticias. */
const consentimientosHtml = (prefijo) =>
  '<label class="fila g8" style="align-items:flex-start">' +
    '<input type="checkbox" id="' + prefijo + '_terminos" style="margin-top:3px">' +
    '<span class="pequeno">Acepto el <a href="#/privacidad" target="_blank" ' +
    'style="color:var(--acento);font-weight:700">aviso de privacidad y seguridad</a> de MÍA.</span>' +
  "</label>" +
  '<label class="fila g8" style="align-items:flex-start">' +
    '<input type="checkbox" id="' + prefijo + '_noticias" checked style="margin-top:3px">' +
    '<span class="pequeno apagado">Quiero recibir noticias de MÍA en mi correo ' +
    "(negocios verificados, artículos nuevos).</span>" +
  "</label>";

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
        "<title>" + esc(n.nombre + " — " + ciudadCompleta(n)) + "</title>" +
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
const ICONO_UBICACION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.4 7-12A7 7 0 0 0 5 9c0 5.6 7 12 7 12Z">' +
  '</path><circle cx="12" cy="9" r="2.5"></circle></svg>';
const ICONO_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>';
const ICONO_VERIFICADO = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="11" fill="var(--cobalto)"></circle>' +
  '<path d="M7.3 12.3l3 3 6-6.6" stroke="#fff" stroke-width="2.3" fill="none" ' +
  'stroke-linecap="round" stroke-linejoin="round"></path></svg>';

/** Foto + nombre + categoría + estrellas + palomita, para la lista de verificados de Inicio. */
function filaVerificada(n) {
  const c = cat(n.categoria);
  return '<a class="fila-verificada" href="#/negocio/' + esc(n.slug) + '">' +
    '<div class="foto-chica">' + imagenHtml(fotoDirectorioUrl(n), n.nombre) + "</div>" +
    '<div class="pila g2" style="flex:1;min-width:0">' +
      '<strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(n.nombre) + "</strong>" +
      '<span class="pequeno apagado">' + c.icono + " " + esc(c.nombre) + "</span>" +
      estrellasHtml(n.calificacion) +
    "</div>" + ICONO_VERIFICADO + "</a>";
}

async function vistaInicio() {
  const { resultados } = await api.get("/api/negocios?porPagina=48");
  const destacados = resultados.slice(0, 6);
  const verificados = resultados.filter((n) => n.verificado).slice(0, 5);
  const arts = (await api.get("/api/blog")).slice(0, 2);

  const ultimas = resultados
    .filter((n) => n.ultimaPublicacion)
    .sort((a, b) => String(b.ultimaPublicacion.creado_en).localeCompare(String(a.ultimaPublicacion.creado_en)))
    .slice(0, 3);

  return (
  '<section class="hero-inicio"><div class="envoltura pila g14" style="align-items:center;text-align:center">' +
    '<div class="marca-grande">' +
      '<svg class="glifo" viewBox="0 0 100 100" aria-hidden="true">' +
        '<circle cx="50" cy="50" r="50" fill="#2D3A47"></circle>' +
        '<g fill="none" stroke="#B46A72" stroke-width="2.6" stroke-linecap="round" opacity=".85">' +
          '<line x1="25" y1="25" x2="45" y2="45"></line><line x1="45" y1="45" x2="75" y2="78"></line>' +
        "</g>" +
        '<circle cx="25" cy="25" r="5" fill="#FFF7E6"></circle>' +
        '<circle cx="45" cy="45" r="7" fill="#FFF7E6"></circle>' +
        '<circle cx="75" cy="78" r="11" fill="#FFF7E6"></circle>' +
      "</svg>" +
      '<span class="nombre-grande">MÍA</span>' +
    "</div>" +
    '<p class="lema">Negocios dirigidos por mujeres ♥</p>' +
    '<label class="buscador-pill">' + ICONO_BUSCAR +
      '<input id="q" placeholder="¿Qué estás buscando?" ' +
        'onkeydown="if(event.key===\'Enter\')buscarDesdeInicio()" aria-label="Buscar negocios">' +
    "</label>" +
    '<button class="cerca-de-ti" id="btn_cerca" onclick="buscarCercaDeTi()">' +
      ICONO_UBICACION + "<span>Cerca de ti</span>" + ICONO_CHEVRON + "</button>" +
  "</div></section>" +

  '<div class="envoltura bloque pila g48">' +
    (verificados.length ? '<div class="pila g16">' +
      '<div class="fila entre g12"><h2>Negocios verificados</h2>' +
      '<a class="btn fantasma chico" href="#/directorio">Ver todos</a></div>' +
      '<div class="pila g10">' + verificados.map(filaVerificada).join("") + "</div>" +
    "</div>" : "") +

    '<div class="pila g16">' +
      '<div class="fila entre g12"><h2>Explora por categoría</h2>' +
      '<a class="btn fantasma chico" href="#/directorio">Ver todas</a></div>' +
      '<div class="rejilla cats">' + CATEGORIAS.slice(0, 8).map((c) => {
        const cuantos = resultados.filter((n) => n.categoria === c.id || n.categoria2 === c.id).length;
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
      "perfil, tu logo, tus datos de contacto y hasta siete subcategorías.</p>" +
      '<div class="fila g8"><a class="btn" href="#/registro/gratuito">Registrar mi negocio gratis</a>' +
      '<a class="btn linea" href="#/planes">Comparar planes</a></div>' +
    "</div>" +
  "</div>");
}

/** No espera respuesta ni bloquea la navegación del enlace que la disparó. */
function registrarClic(id, tipo) {
  fetch("/api/negocios/" + id + "/interaccion", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo }),
  }).catch(() => {});
}

function buscarDesdeInicio() {
  filtro.q = val("q"); filtro.categoria = ""; filtro.sub = "";
  location.hash = "#/directorio"; pintar();
}

/** Usa la ubicación del navegador para adivinar la ciudad más cercana de la
 * lista y filtrar el directorio por ahí — sin mandar coordenadas a ningún lado. */
function buscarCercaDeTi() {
  if (!navigator.geolocation) return avisar("Tu navegador no permite compartir tu ubicación.");
  const btn = $("btn_cerca");
  if (btn) btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      let mejor = null, mejorDist = Infinity;
      for (const [ciudad, [lng, lat]] of Object.entries(CIUDADES)) {
        const dist = Math.hypot(lat - latitude, lng - longitude);
        if (dist < mejorDist) { mejorDist = dist; mejor = ciudad; }
      }
      if (btn) btn.disabled = false;
      if (!mejor) return avisar("No encontramos una ciudad cercana en el directorio.");
      filtro = { q: "", categoria: "", sub: "", ciudad: mejor };
      location.hash = "#/directorio"; pintar();
      avisar("Mostrando negocios cerca de " + mejor + ".");
    },
    () => { if (btn) btn.disabled = false; avisar("No pudimos obtener tu ubicación. Revisa los permisos del navegador."); }
  );
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
        (n.categoria2 ? '<span class="chip">' + esc(n.categoria2Icono) + " " + esc(n.categoria2Nombre) + "</span>" : "") +
      "</div>" +
      "<h3>" + esc(n.nombre) + "</h3>" +
      '<p class="diminuto apagado">' + esc((n.sub || []).slice(0, 3).join(" · ")) + "</p>" +
      '<p class="diminuto apagado">' + esc(ciudadCompleta(n)) + "</p>" +
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
      "principal y puede tener hasta una segunda, con hasta siete subcategorías en total.</p></div>" +

    filtrosHtml() +
    '<hr class="separador">' +
    '<p class="pequeno apagado">' + res.length +
      (res.length === 1 ? " negocio encontrado" : " negocios encontrados") + "</p>" +
    (res.length ? '<div class="rejilla">' + res.map(tarjeta).join("") + "</div>"
      : vacio("No encontramos negocios con esos filtros.")) +

    '<hr class="separador">' +
    '<div class="pila g16"><h2>Todas las categorías</h2>' +
      '<div class="rejilla cats">' + CATEGORIAS.map((c) => {
        const cuantos = todosParaConteo.filter((n) => n.categoria === c.id || n.categoria2 === c.id).length;
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
    carruselHtml(a.fotos) +
    '<hr class="separador">' +
    '<div class="articulo">' + a.cuerpo.split("\n\n").map((p) => "<p>" + esc(p) + "</p>").join("") + "</div>" +
    '<hr class="separador">' +
    '<div class="fila g8">' +
      reaccionBoton(a.id, "like", "👍", a.reacciones.conteos.like, a.reacciones.mia) +
      reaccionBoton(a.id, "dislike", "👎", a.reacciones.conteos.dislike, a.reacciones.mia) +
      reaccionBoton(a.id, "love", "❤️", a.reacciones.conteos.love, a.reacciones.mia) +
    "</div>" +
    '<hr class="separador">' +
    '<div class="pila g16"><p class="eyebrow">Comentarios</p>' +
      (YO ? '<div class="tarjeta p16 pila g8">' +
        '<textarea id="com_texto" style="min-height:70px" placeholder="Escribe un comentario…"></textarea>' +
        '<p id="com_error" class="pequeno" style="color:var(--peligro)"></p>' +
        '<div><button class="btn chico" onclick="comentarArticulo(' + a.id + ')">Comentar</button></div></div>'
        : '<div class="aviso">Para comentar <a href="#/entrar" style="color:var(--acento);font-weight:700">entra con tu correo</a>.</div>') +
      (a.comentarios.length ? a.comentarios.map(bloqueComentario).join("")
        : '<p class="apagado pequeno">Sé la primera en comentar.</p>') +
    "</div>" +
  "</div>";
}

function reaccionBoton(articuloId, tipo, emoji, cuenta, miReaccion) {
  return '<button class="btn ' + (miReaccion === tipo ? "" : "linea") + ' chico" onclick="reaccionarArticulo(' +
    articuloId + ",'" + tipo + "')\">" + emoji + " " + cuenta + "</button>";
}

function bloqueComentario(c) {
  const puedeBorrar = YO && (YO.rol === "admin" || YO.id === c.usuario_id);
  return '<div class="tarjeta p16 pila g4">' +
    '<div class="fila entre g8"><strong class="pequeno">' + esc(c.autora) + "</strong>" +
    '<span class="diminuto apagado">' + esc(fecha(c.creado_en)) + "</span></div>" +
    "<p>" + esc(c.texto) + "</p>" +
    (puedeBorrar ? '<div><button class="btn fantasma chico" onclick="borrarComentarioArticulo(' + c.id +
      ')">Borrar</button></div>' : "") +
  "</div>";
}

async function reaccionarArticulo(articuloId, tipo) {
  if (!YO) return (location.hash = "#/entrar");
  try { await api.post("/api/blog/" + articuloId + "/reaccion", { tipo }); await pintar(); }
  catch (err) { avisarError(err); }
}

async function comentarArticulo(articuloId) {
  const texto = val("com_texto");
  const decir = (m) => { if ($("com_error")) $("com_error").textContent = m; };
  if (texto.length < 2) return decir("Escribe tu comentario.");
  try {
    await api.post("/api/blog/" + articuloId + "/comentarios", { texto });
    await pintar();
    avisar("Comentario publicado.");
  } catch (err) { decir(err instanceof ErrorApi ? err.message : "No se pudo publicar tu comentario."); }
}

async function borrarComentarioArticulo(id) {
  if (!confirm("¿Borrar este comentario?")) return;
  try { await api.del("/api/blog/comentarios/" + id); await pintar(); avisar("Borramos el comentario."); }
  catch (err) { avisarError(err); }
}

/* -------------------------------------------------------------- carrusel */
function carruselHtml(fotos) {
  if (!fotos || !fotos.length) return "";
  if (fotos.length === 1) return '<div class="carrusel"><img src="' + esc(fotos[0].url) + '" alt=""></div>';
  return '<div class="carrusel" id="carrusel">' +
    '<div class="carrusel-pista" id="carrusel_pista">' +
      fotos.map((f) => '<div class="carrusel-diapositiva"><img src="' + esc(f.url) + '" alt=""></div>').join("") +
    "</div>" +
    '<button class="carrusel-flecha izq" onclick="moverCarrusel(-1)" aria-label="Foto anterior">‹</button>' +
    '<button class="carrusel-flecha der" onclick="moverCarrusel(1)" aria-label="Foto siguiente">›</button>' +
    '<div class="carrusel-puntos">' + fotos.map((_, i) =>
      '<button class="' + (i === 0 ? "activo" : "") + '" onclick="irACarrusel(' + i +
      ')" aria-label="Ir a la foto ' + (i + 1) + '"></button>').join("") +
    "</div></div>";
}

let carruselIndice = 0;
let carruselTotal = 0;

function iniciarCarrusel() {
  const pista = $("carrusel_pista");
  if (!pista) return;
  carruselIndice = 0;
  carruselTotal = pista.children.length;
  let arranco = null;
  pista.addEventListener("pointerdown", (e) => { arranco = e.clientX; });
  pista.addEventListener("pointerup", (e) => {
    if (arranco === null) return;
    const delta = e.clientX - arranco;
    arranco = null;
    if (delta > 40) moverCarrusel(-1);
    else if (delta < -40) moverCarrusel(1);
  });
}

function actualizarCarrusel() {
  const pista = $("carrusel_pista");
  if (!pista) return;
  pista.style.transform = "translateX(-" + carruselIndice * 100 + "%)";
  document.querySelectorAll("#carrusel .carrusel-puntos button").forEach((b, i) =>
    b.classList.toggle("activo", i === carruselIndice));
}

function moverCarrusel(direccion) {
  carruselIndice = Math.max(0, Math.min(carruselTotal - 1, carruselIndice + direccion));
  actualizarCarrusel();
}

function irACarrusel(i) {
  carruselIndice = i;
  actualizarCarrusel();
}

/* ================================================================= SOBRE MÍA */
function vistaApp() {
  return '<section class="hero"><div class="envoltura">' +
    '<p class="eyebrow">MÍA en tu celular</p><h1>Descarga la app de MÍA</h1>' +
    '<p class="entrada">La misma MÍA de siempre, como app: entra más rápido, sin escribir la ' +
    "dirección cada vez.</p>" +
    '<div class="fila g8"><a class="btn claro" href="/descargas/mia.apk" download>⬇ Descargar para Android</a></div>' +
  "</div></section>" +

  '<div class="envoltura bloque pila g32" style="max-width:680px">' +
    '<div class="tarjeta p20 pila g12"><p class="eyebrow">Cómo instalarla</p>' +
      '<div class="escalones">' +
        escalon(1, "Descarga el archivo", 'Toca el botón de arriba desde tu celular Android (no funciona en iPhone todavía).') +
        escalon(2, "Permite instalar", 'Android va a preguntar si confías en el origen. Es normal: MÍA no está todavía en Google Play, así que toca "Instalar de todos modos" o activa "Permitir de esta fuente".') +
        escalon(3, "Ábrela como cualquier app", "Va a aparecer el ícono de MÍA en tu pantalla. Se conecta directo al sitio real: tu cuenta, tus mensajes y tus negocios son los mismos.") +
      "</div>" +
    "</div>" +

    '<div class="aviso"><div><strong>¿Por qué no está en Google Play todavía?</strong> Estamos por ' +
    "mandarla a revisión. Mientras tanto, esta es la versión oficial — funciona exactamente igual, " +
    "solo que la descargas directo de aquí en lugar de la tienda.</div></div>" +

    '<div class="pila g8"><p class="eyebrow">¿Tienes iPhone?</p>' +
    '<p class="pequeno apagado">Por ahora puedes instalar MÍA como app desde Safari: abre ' +
    "mia-c2mm.onrender.com, toca el botón de compartir y elige \"Agregar a inicio\".</p></div>" +
  "</div>";
}

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
        escalon(2, "Llenas el formulario", "Tus datos, hasta dos categorías y hasta siete subcategorías.") +
        escalon(3, "MÍA revisa tu perfil", "Confirmamos los datos y, si aplica, tu pago.") +
        escalon(4, "Tu perfil se publica", "Apareces en el directorio y empiezas a recibir clientas.") +
      "</div>" +
      '<div><a class="btn" href="#/planes">Ver los planes</a></div>' +
    "</div>" +
  "</div>";
}
/* ===================================================== AVISO DE PRIVACIDAD */
function vistaPrivacidad() {
  const seccion = (t, ...parrafos) =>
    '<div class="pila g8"><h2>' + t + "</h2>" + parrafos.map((p) => "<p>" + p + "</p>").join("") + "</div>";

  return '<div class="envoltura bloque pila g24" style="max-width:760px">' +
    '<div class="pila g8"><p class="eyebrow">Legal</p><h1>Aviso de privacidad</h1>' +
    '<p class="apagado">Última actualización: julio de 2026.</p></div>' +
    '<div class="articulo pila g24">' +

    seccion("Responsable de tus datos",
      "<strong>MÍA</strong>, con domicilio en Xochimilco, Ciudad de México, es responsable del " +
      "tratamiento de tus datos personales, de conformidad con la Ley Federal de Protección de " +
      "Datos Personales en Posesión de los Particulares.") +

    seccion("Qué datos recabamos",
      "Según el tipo de cuenta que crees, podemos recabar: nombre, correo electrónico, " +
      "contraseña (que guardamos siempre cifrada, nunca en texto plano), teléfono, y, si " +
      "registras un negocio, su categoría, descripción, ubicación, redes sociales y las " +
      "fotografías que subas. También guardamos las reseñas y favoritos que dejes, y el " +
      "estado de tus pagos (el número completo de tu tarjeta nunca lo vemos ni lo guardamos: " +
      "eso lo procesa directamente Stripe).") +

    seccion("Para qué usamos tus datos",
      "<strong>Finalidades necesarias:</strong> crear y administrar tu cuenta; publicar y " +
      "administrar tu perfil de negocio; procesar el pago de tu plan; verificar negocios; " +
      "moderar reseñas; y contactarte para dar seguimiento a tu registro, tu plan o tu " +
      "verificación.",
      "<strong>Finalidades secundarias (opcionales):</strong> avisarte de novedades o " +
      "promociones de MÍA. Puedes oponerte a estas en cualquier momento sin que afecte tu " +
      "cuenta, escribiendo al correo de contacto de abajo.") +

    seccion("A quién más llegan tus datos",
      "Para operar MÍA compartimos datos con: <strong>Stripe</strong> (procesa los pagos de " +
      "los planes), <strong>Twilio SendGrid</strong> (envía los correos de la plataforma) y " +
      "<strong>Render</strong> (aloja el servidor y la base de datos). Todos procesan tus " +
      "datos solo para prestarnos ese servicio, no para sus propios fines. Si tú decides " +
      "escribirnos por el botón de WhatsApp, esa conversación queda sujeta además a las " +
      "políticas de WhatsApp/Meta.") +

    seccion("Cómo ejercer tus derechos (ARCO)",
      "Puedes Acceder, Rectificar o Cancelar tus datos, y Oponerte a su uso, en cualquier " +
      "momento. Para eso, escríbenos a <strong>mia.paraellas@gmail.com</strong> desde el " +
      "correo con el que te registraste, indicando qué quieres hacer. Responderemos en un " +
      "plazo razonable.") +

    seccion("Cookies",
      "MÍA usa una sola cookie técnica para mantener tu sesión iniciada. No usamos cookies de " +
      "rastreo ni de publicidad.") +

    seccion("Cambios a este aviso",
      "Si actualizamos este aviso de forma importante, lo anunciaremos en esta misma página " +
      "con la nueva fecha de actualización.") +

    "</div></div>";
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
  let esFav = false, esSeguidora = false;
  if (YO && YO.rol === "usuario") {
    try { esFav = (await api.get("/api/favoritos")).some((f) => f.id === n.id); } catch { /* sin favoritos */ }
    try { esSeguidora = (await api.get("/api/mis-seguidos")).some((f) => f.id === n.id); } catch { /* sin seguidos */ }
  }
  const miReseña = YO && YO.rol === "usuario" ? n.resenas.find((r) => r.usuario_id === YO.id) : null;

  const contacto = [];
  if (n.telefono) contacto.push('<a class="btn linea" onclick="registrarClic(' + n.id + ',\'telefono\')" href="tel:' +
    esc(n.telefono.replace(/\s/g, "")) + '">Llamar ' + esc(n.telefono) + "</a>");
  if (n.comoLlegar) contacto.push('<a class="btn linea" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' +
    encodeURIComponent(n.direccion + (n.ciudad ? ", " + ciudadCompleta(n) : "")) + '">¿Cómo llegar?</a>');
  const redesBotones = botonesRedesSociales(n);

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
          (n.ciudad ? '<span class="pequeno apagado">· ' + esc(ciudadCompleta(n)) + "</span>" : "") +
        "</div>" +
        '<div class="fila g8"><a class="chip rosa" style="text-decoration:none" href="#/directorio/' +
          c.id + '">' + c.icono + " " + esc(c.nombre) + "</a>" +
          (n.categoria2 ? '<a class="chip rosa" style="text-decoration:none" href="#/directorio/' +
            esc(n.categoria2) + '">' + esc(n.categoria2Icono) + " " + esc(n.categoria2Nombre) + "</a>" : "") +
          (n.sub || []).map((s) => '<span class="chip">' + esc(s) + "</span>").join("") + "</div>" +
        (redesBotones ? '<div class="fila g8">' + redesBotones + "</div>" : "") +
      "</div>" +
    "</div>" +

    '<p style="max-width:66ch;white-space:pre-wrap">' + esc(n.descripcion) + "</p>" +
    (n.direccion ? '<p class="pequeno apagado">📍 ' + esc(n.direccion) +
      (n.ciudad ? ", " + esc(ciudadCompleta(n)) : "") + "</p>" : "") +

    '<div class="fila g8">' + contacto.join("") +
      (YO && YO.rol === "usuario"
        ? '<button class="btn ' + (esFav ? "" : "linea") + '" onclick="alternarFavorito(' + n.id + ',' + esFav + ')">' +
          (esFav ? "♥ En tus favoritos" : "♡ Guardar en favoritos") + "</button>" +
        '<button class="btn ' + (esSeguidora ? "" : "linea") + '" onclick="alternarSeguir(' + n.id + ')">' +
          (esSeguidora ? "🔔 Siguiendo" : "🔕 Seguir este negocio") + "</button>" : "") +
    "</div>" +

    (YO && YO.rol === "usuario" ? '<div class="tarjeta p20 pila g12"><p class="eyebrow">Escríbele a este negocio</p>' +
      '<textarea id="msg_cuerpo" style="min-height:80px" placeholder="Escribe tu mensaje…"></textarea>' +
      '<p id="msg_error" class="pequeno" style="color:var(--peligro)"></p>' +
      '<div><button class="btn" onclick="enviarMensajeNegocio(' + n.id + ')">Enviar mensaje</button></div></div>'
      : !YO ? '<div class="aviso">Para escribirle a este negocio ' +
          '<a href="#/entrar" style="color:var(--acento);font-weight:700">entra con tu correo</a>.</div>' : "") +

    (n.sobreNegocio ? '<div class="pila g12"><p class="eyebrow">Sobre este negocio</p>' +
      '<p style="max-width:66ch;white-space:pre-wrap">' + esc(n.sobreNegocio) + "</p></div>" : "") +

    (n.fotos.length > 1 ? '<div class="pila g12"><p class="eyebrow">Fotografías</p>' +
      '<div class="galeria">' + n.fotos.map((f) =>
        '<div class="foto">' + imagenHtml(f, n.nombre) + "</div>").join("") + "</div></div>" : "") +

    (n.productos.length ? '<div class="pila g12"><p class="eyebrow">Productos y servicios</p>' +
      (destacados.length ? '<div class="rejilla">' + destacados.map((x) =>
        fichaProducto(x, true, n.id, Boolean(YO && YO.rol === "usuario"))).join("") + "</div>" : "") +
      (normales.length ? '<div class="rejilla">' + normales.map((x) =>
        fichaProducto(x, false, n.id, Boolean(YO && YO.rol === "usuario"))).join("") + "</div>" : "") +
      "</div>" : "") +

    (n.publicaciones.length ? '<div class="pila g12"><p class="eyebrow">Publicaciones</p>' +
      '<div class="pila g12">' + n.publicaciones.map((x) => fichaPublicacion(x)).join("") +
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

/** El mismo estilo de tarjeta que las del directorio: foto (o degradado con
 * su inicial si no hay), nombre, descripción y precio. */
function productoImagenHtml(p, destacado) {
  return '<div class="portada">' + (p.imagen ? imagenHtml(p.imagen, p.nombre) :
    '<div style="position:absolute;inset:0;background:linear-gradient(135deg,' + tonoDe(p.nombre).join(",") +
    ')"></div><span class="inicial">' + esc((p.nombre || "P").trim()[0] || "P") + "</span>") +
    (destacado ? '<span class="chip rosa" style="position:absolute;top:10px;left:10px">Destacado</span>' : "") +
  "</div>";
}

const fichaProducto = (x, destacado, negocioId, puedeConsultar) => '<div class="tarjeta tarjeta-negocio">' +
  productoImagenHtml(x, destacado) +
  '<div class="cuerpo">' +
    "<strong>" + esc(x.nombre) + "</strong>" +
    (x.descripcion ? '<p class="pequeno apagado">' + esc(x.descripcion) + "</p>" : "") +
    (x.precio ? '<p class="mono" style="font-weight:700">' + pesos(x.precio) + "</p>" : "") +
    (puedeConsultar ? '<div class="fila g8">' +
      '<button class="btn linea chico" onclick="consultarProducto(' + negocioId + "," + x.id +
        ',\'disponible\')">¿Aún disponible?</button>' +
      '<button class="btn chico" onclick="consultarProducto(' + negocioId + "," + x.id +
        ',\'interesa\')">Me interesa</button>' +
    "</div>" : "") +
  "</div></div>";

/** Publicación tal como la ve cualquier visitante: como un post, con foto
 * (si tiene), texto y un enlace a verla completa con sus comentarios. */
function fichaPublicacion(x) {
  const previa = x.texto.length > 220 ? x.texto.slice(0, 220) + "…" : x.texto;
  return '<a class="publicacion' + (x.destacada ? " destacada" : "") + '" style="text-decoration:none;color:inherit" ' +
    'href="#/publicacion/' + x.id + '">' +
    (x.imagen ? '<div class="portada" style="aspect-ratio:16/9;margin:-16px -16px 12px;width:calc(100% + 32px)">' +
      imagenHtml(x.imagen, x.titulo) + "</div>" : "") +
    '<div class="fila entre g8"><strong>' + esc(x.titulo) + "</strong>" +
    (x.destacada ? '<span class="chip rosa">Destacada</span>' : "") + "</div>" +
    '<p class="diminuto apagado">' + esc(fecha(x.creado_en)) + "</p>" +
    '<p class="pequeno" style="white-space:pre-wrap">' + esc(previa) + "</p>" +
    '<p class="diminuto apagado" style="margin-top:4px">👁 ' + x.vistas + " · 💬 " + x.total_comentarios +
      (x.total_comentarios === 1 ? " comentario" : " comentarios") + "</p>" +
  "</a>";
}

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

async function enviarMensajeNegocio(negocioId) {
  const cuerpo = val("msg_cuerpo");
  const decir = (m) => { if ($("msg_error")) $("msg_error").textContent = m; };
  if (cuerpo.length < 2) return decir("Escribe tu mensaje.");
  try {
    await api.post("/api/negocios/" + negocioId + "/mensajes", { cuerpo });
    if ($("msg_cuerpo")) $("msg_cuerpo").value = "";
    decir("");
    avisar("Tu mensaje ya se envió. Te va a responder por aquí mismo.");
  } catch (err) { decir(err instanceof ErrorApi ? err.message : "No se pudo enviar tu mensaje."); }
}

async function consultarProducto(negocioId, productoId, tipo) {
  try {
    const r = await api.post("/api/negocios/" + negocioId + "/productos/" + productoId + "/consultar", { tipo });
    location.hash = "#/mensajes/" + r.conversacionId;
    await pintar();
    avisar(tipo === "disponible" ? "Le preguntamos si sigue disponible." : "Le avisamos que te interesa.");
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

async function alternarSeguir(negocioId) {
  try {
    const r = await api.post("/api/negocios/" + negocioId + "/seguir");
    await pintar();
    avisar(r.siguiendo ? "Ahora sigues a este negocio. Te avisamos cuando publique." : "Dejaste de seguir este negocio.");
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
        escalon(2, "Llenas tus datos", "Hasta dos categorías y hasta siete subcategorías.") +
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
      '<span class="chip">Hasta ' + MAX_CATEGORIAS + " categorías</span>" +
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
        '<label class="campo">Ciudad<select id="g_ciudad" onchange="pintarAlcaldias(\'g\')"><option value="">Elige…</option>' +
          ENTIDADES_CIUDAD.map((x) => '<option value="' + esc(x) + '">' + esc(x) + "</option>").join("") +
        "</select></label>" +
        '<label class="campo">Alcaldía o municipio<select id="g_alcaldia" disabled>' +
          '<option value="">Primero elige una ciudad</option></select></label>' +
      "</div>" +
      '<label class="campo">Dirección <span class="apagado">(opcional)</span>' +
        '<input id="g_direccion" placeholder="Calle, número, colonia"></label>' +
      '<label class="campo">Categoría principal' +
        '<select id="g_categoria" onchange="categoriaCambioRegistro()"><option value="">Elige…</option>' +
          CATEGORIAS.map((c) => '<option value="' + c.id + '">' + esc(c.icono + " " + c.nombre) + "</option>").join("") +
        "</select></label>" +
      '<label class="campo">Segunda categoría <span class="apagado">(opcional, por si tu negocio ' +
        "cruza dos rubros)</span>" +
        '<select id="g_categoria2" onchange="categoriaCambioRegistro()"><option value="">Ninguna</option>' +
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
      '<p class="pequeno apagado">Incluidas en tu plan. Pega el link que abre directo tu chat o tu ' +
      "perfil — no el usuario, el link completo.</p>" +
      '<div class="rejilla-campos">' +
        '<label class="campo">WhatsApp<input id="g_whatsapp" placeholder="https://wa.me/52..."></label>' +
        '<label class="campo">Instagram<input id="g_instagram" placeholder="https://instagram.com/tunegocio"></label>' +
        '<label class="campo">Facebook<input id="g_facebook" placeholder="https://facebook.com/tunegocio"></label>' +
        '<label class="campo">TikTok<input id="g_tiktok" placeholder="https://tiktok.com/@tunegocio"></label>' +
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
      consentimientosHtml("g") +
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

function categoriaCambioRegistro() {
  if (val("g_categoria") && val("g_categoria") === val("g_categoria2")) {
    $("g_categoria2").value = "";
    avisar("Elige una segunda categoría distinta a la principal.");
  }
  pintarSub();
}

function pintarSub() {
  const c1 = CATEGORIAS.find((x) => x.id === val("g_categoria"));
  const c2 = CATEGORIAS.find((x) => x.id === val("g_categoria2"));
  subSeleccionadas = [];
  const opciones = c1 ? [...new Set([...c1.sub, ...(c2 ? c2.sub : [])])] : [];
  $("g_sub").innerHTML = opciones.length
    ? opciones.map((s) => '<button type="button" class="chip" data-sub="' + esc(s) +
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
  if (!val("g_ciudad")) return decir("Elige la ciudad de tu negocio.");
  if (!val("g_alcaldia")) return decir("Elige tu alcaldía o municipio.");
  if (!val("g_categoria")) return decir("Elige la categoría principal de tu negocio.");
  if (!subSeleccionadas.length) return decir("Elige al menos una subcategoría.");
  if (!marcado("g_terminos")) return decir("Debes aceptar el aviso de privacidad y seguridad para continuar.");

  const cuerpo = {
    nombre: val("g_nombre"), correo: val("g_correo"), clave: val("g_clave"), telefono: val("g_telefono"),
    plan: planId, mensaje: val("g_mensaje"),
    terminos: marcado("g_terminos"), noticias: marcado("g_noticias"),
    negocio: {
      nombre: val("g_negocio"), categoria: val("g_categoria"), categoria2: val("g_categoria2"),
      sub: subSeleccionadas.slice(),
      ciudad: val("g_ciudad"), alcaldiaMunicipio: val("g_alcaldia"), direccion: val("g_direccion"), descripcion: val("g_descripcion"),
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
const TIPOS_ENTRADA = {
  negocio: ["Negocio", "Entra con el correo y la contraseña de tu negocio."],
  usuario: ["Usuaria", "Entra con el correo y la contraseña de tu cuenta."],
  admin: ["Organización MÍA", "Entra con tu correo y contraseña de administradora."],
};

function vistaEntrar(tipo) {
  const datos = TIPOS_ENTRADA[tipo];

  const eleccion = '<div class="tarjeta p20 pila g12">' +
    '<a class="btn ancho" href="#/entrar/negocio">Soy un negocio</a>' +
    '<a class="btn linea ancho" href="#/entrar/usuario">Soy usuaria / clienta</a>' +
    '<p class="pequeno apagado" style="text-align:center;margin-top:4px">¿Eres del equipo de MÍA? ' +
    '<a href="#/entrar/admin">Entra aquí</a></p></div>';

  const formulario = !datos ? "" : '<div class="tarjeta p20 pila g12">' +
    '<p class="eyebrow">' + esc(datos[0]) + "</p>" +
    '<p class="pequeno apagado">' + esc(datos[1]) + "</p>" +
    '<label class="campo">Correo electrónico<input id="e_correo" type="email" autocomplete="username"></label>' +
    '<label class="campo">Contraseña<input id="e_clave" type="password" autocomplete="current-password" ' +
      'onkeydown="if(event.key===\'Enter\')hacerEntrar()"></label>' +
    '<button class="btn ancho" onclick="hacerEntrar()">Entrar</button>' +
    '<p id="e_error" class="pequeno" style="color:var(--peligro)"></p>' +
    '<a class="pequeno" href="#/entrar">‹ Elegir otro tipo de cuenta</a>' +
  "</div>";

  return '<div class="envoltura bloque pila g24" style="max-width:440px">' +
    '<div class="pila g8"><p class="eyebrow">Tu cuenta</p><h1>Iniciar sesión</h1></div>' +
    (datos ? formulario : eleccion) +
    (datos ? "" :
      '<div class="tarjeta p20 pila g12"><p class="eyebrow">¿Tienes un negocio?</p>' +
      '<p class="pequeno apagado">El registro se hace desde el plan que elijas: cada uno tiene ' +
      "su propio formulario.</p>" +
      '<a class="btn linea ancho" href="#/planes">Ver los planes y registrarme</a></div>' +
      '<div class="tarjeta p20 pila g12"><p class="eyebrow">¿Solo quieres comprar?</p>' +
      '<label class="campo">Tu nombre<input id="r_nombre"></label>' +
      '<label class="campo">Correo electrónico<input id="r_correo" type="email"></label>' +
      '<label class="campo">Contraseña<input id="r_clave" type="password" placeholder="Mínimo 8 caracteres"></label>' +
      consentimientosHtml("r") +
      '<button class="btn linea ancho" onclick="hacerRegistroCliente()">Crear cuenta de clienta</button>' +
      '<p id="r_error" class="pequeno" style="color:var(--peligro)"></p></div>') +
    "</div>";
}

async function hacerEntrar() {
  const err = await entrar(val("e_correo"), val("e_clave"));
  if (err && $("e_error")) $("e_error").textContent = err;
}

async function hacerRegistroCliente() {
  const decir = (m) => { if ($("r_error")) $("r_error").textContent = m; };
  if (!marcado("r_terminos")) return decir("Debes aceptar el aviso de privacidad y seguridad para continuar.");
  try {
    await api.post("/api/auth/registro-clienta", {
      nombre: val("r_nombre"), correo: val("r_correo"), clave: val("r_clave"),
      terminos: marcado("r_terminos"), noticias: marcado("r_noticias"),
    });
    await refrescarSesion();
    location.hash = "#/inicio";
    await pintar();
    avisar("Tu cuenta quedó lista, " + YO.nombre.split(" ")[0] + ".");
  } catch (err) { decir(err instanceof ErrorApi ? err.message : "No se pudo crear tu cuenta."); }
}

/* ============================================================ NOTIFICACIONES */
async function vistaNotificaciones() {
  const { notificaciones } = await api.get("/api/notificaciones");
  if (notificaciones.some((n) => !n.leida)) {
    try { await api.post("/api/notificaciones/marcar-leidas"); } catch { /* no bloquea la vista */ }
    actualizarBadgeNotificaciones();
  }

  return '<div class="envoltura bloque pila g24" style="max-width:640px">' +
    '<div class="pila g8"><p class="eyebrow">Tu cuenta</p><h1>Notificaciones</h1></div>' +
    (notificaciones.length ? '<div class="pila g8">' + notificaciones.map((n) =>
      '<a class="tarjeta p16" style="text-decoration:none;display:block" href="' +
        esc(n.enlace || (n.negocio_slug ? "#/negocio/" + n.negocio_slug : "#/notificaciones")) + '">' +
        '<p' + (n.leida ? ' class="apagado"' : "") + '>' + esc(n.mensaje) + "</p>" +
        '<p class="diminuto apagado">' + esc(fecha(n.creado_en)) + "</p></a>").join("") + "</div>"
      : vacio("Sigue negocios para enterarte cuando publiquen algo nuevo.")) + "</div>";
}

/* =================================================================== MENSAJES */
async function vistaBandejaMensajes() {
  const lista = await api.get("/api/mis-mensajes");
  return '<div class="envoltura bloque pila g24">' +
    '<div class="pila g8"><p class="eyebrow">Tu cuenta</p><h1>Tus mensajes</h1></div>' +
    (lista.length ? '<div class="pila g12">' + lista.map((c) => filaConversacion(c, "usuario")).join("") + "</div>"
      : vacio("Cuando le escribas a un negocio, tu conversación va a aparecer aquí.")) + "</div>";
}

async function vistaMensajesNegocio(negocioId) {
  const lista = await api.get("/api/negocios/" + negocioId + "/mensajes");
  return '<div class="envoltura bloque pila g24">' +
    '<div class="fila entre g12"><div class="pila g8"><p class="eyebrow">Mi negocio</p><h1>Mensajes</h1></div>' +
      '<a class="btn linea" href="#/panel">‹ Volver a mis perfiles</a></div>' +
    (lista.length ? '<div class="pila g12">' + lista.map((c) => filaConversacion(c, "negocio")).join("") + "</div>"
      : vacio("Todavía no tienes mensajes de clientas.")) + "</div>";
}

function filaConversacion(c, lado) {
  const titulo = lado === "usuario" ? c.negocio_nombre : c.usuaria_nombre;
  return '<a class="tarjeta p16 pila g4" href="#/mensajes/' + c.id +
    '" style="text-decoration:none;color:inherit;display:block">' +
    '<div class="fila entre g8"><strong>' + esc(titulo) + "</strong>" +
    (c.no_leidos > 0 ? '<span class="chip rosa">' + c.no_leidos + " nuevo" + (c.no_leidos > 1 ? "s" : "") + "</span>" : "") +
    "</div>" +
    '<p class="pequeno apagado" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
      esc(c.ultimo_mensaje || "") + "</p>" +
    '<span class="diminuto apagado">' + esc(fecha(c.ultimo_en)) + "</span>" +
  "</a>";
}

async function vistaHiloMensaje(id) {
  let d;
  try { d = await api.get("/api/mensajes/" + id); }
  catch {
    return '<div class="envoltura bloque"><h2>No pudimos abrir esa conversación</h2>' +
      '<p style="margin-top:14px"><a class="btn" href="#/inicio">Volver al inicio</a></p></div>';
  }
  const { conversacion: c, mensajes, lado, puedeResponder } = d;
  const titulo = lado === "usuario" ? c.negocio_nombre : c.usuaria_nombre;
  return '<div class="envoltura bloque pila g24" style="max-width:640px">' +
    '<div class="pila g8"><p class="eyebrow">Mensajes</p><h1>' + esc(titulo) + "</h1></div>" +
    '<div class="pila g8">' + mensajes.map((m) => burbujaMensaje(m, lado)).join("") + "</div>" +
    (puedeResponder ? '<div class="tarjeta p20 pila g12">' +
      '<textarea id="hilo_cuerpo" style="min-height:80px" placeholder="Escribe tu respuesta…"></textarea>' +
      '<p id="hilo_error" class="pequeno" style="color:var(--peligro)"></p>' +
      '<div><button class="btn" onclick="responderMensaje(' + c.id + ')">Enviar</button></div></div>'
      : '<p class="diminuto apagado">Responder mensajes empieza en el plan Suscripción. Lo que ya recibiste no se pierde.</p>') +
  "</div>";
}

const burbujaMensaje = (m, lado) => '<div class="tarjeta p16" style="max-width:80%' +
  (m.autor === lado ? ";align-self:flex-end;background:var(--acento);color:#fff" : "") + '">' +
  '<p style="white-space:pre-wrap">' + esc(m.cuerpo) + "</p>" +
  '<span class="diminuto" style="opacity:.7">' + esc(fecha(m.creado_en)) + "</span></div>";

async function responderMensaje(conversacionId) {
  const cuerpo = val("hilo_cuerpo");
  const decir = (m) => { if ($("hilo_error")) $("hilo_error").textContent = m; };
  if (cuerpo.length < 2) return decir("Escribe tu respuesta.");
  try {
    await api.post("/api/mensajes/" + conversacionId + "/responder", { cuerpo });
    await pintar();
    avisar("Mensaje enviado.");
  } catch (err) { decir(err instanceof ErrorApi ? err.message : "No se pudo enviar tu respuesta."); }
}

/* ============================================================ PANEL NEGOCIO */
async function vistaPanel() {
  const mios = await api.get("/api/mis-negocios");
  return '<div class="envoltura bloque pila g24">' +
    '<div class="fila entre g12"><div class="pila g8"><p class="eyebrow">Mi negocio</p>' +
      "<h1>Mis perfiles</h1></div>" +
      '<a class="btn linea" href="#/planes">Registrar otro negocio</a></div>' +
    (mios.length ? '<div class="pila g16">' + mios.map(fichaPanel).join("")
      : vacio("Todavía no tienes perfiles. Elige un plan para registrar tu negocio.")) + "</div>" +
    '<div class="envoltura"><hr class="separador" style="margin:20px 0">' +
      '<div class="pila g8"><p class="eyebrow">Notificaciones y más</p>' +
        '<div class="fila g8"><a class="btn linea chico" href="#/notificaciones">🔔 Notificaciones</a></div>' +
        enlacesSecundarios() +
      "</div></div>";
}

/** El número que le importa de verdad a una dueña: cuántas veces alguien
 * la contactó este mes (mensajes nuevos, preguntas por un producto, clics
 * de WhatsApp/teléfono/redes), no cuántas veces la vieron. Visible en
 * cualquier plan — es, entre otras cosas, el argumento para subir de plan. */
function tarjetaContactos(c) {
  const cambioHtml = c.cambioPorcentual !== null
    ? '<span class="chip ' + (c.cambioPorcentual >= 0 ? "jade" : "peligro") + '">' +
      (c.cambioPorcentual >= 0 ? "+" : "") + c.cambioPorcentual + "% vs. mes anterior</span>"
    : c.actual.total > 0 ? '<span class="chip cobalto">Nuevo este mes</span>' : "";

  return '<div class="tarjeta p20 pila g12" style="border-left:3px solid var(--acento)">' +
    '<div class="fila entre g12 arriba">' +
      '<div class="pila g4"><p class="eyebrow">Contactos generados este mes</p>' +
        '<span style="font-size:2.3rem;font-weight:800;letter-spacing:-.03em;line-height:1">' +
          c.actual.total + (c.actual.total > 0 ? " 🔥" : "") + "</span></div>" +
      cambioHtml +
    "</div>" +
    '<div class="metricas">' +
      metrica(c.actual.conversaciones, "Conversaciones") +
      metrica(c.actual.consultas, "Consultas de producto", "cobalto") +
      metrica(c.actual.whatsapp, "WhatsApp", "jade") +
      metrica(c.actual.telefono, "Llamadas") +
      metrica(c.actual.redes, "Clics en redes", "sol") +
    "</div>" +
    '<p class="diminuto apagado">Suma cada vez que una clienta te escribe por primera vez, pregunta por un ' +
    "producto, o toca WhatsApp, teléfono o tus redes desde tu perfil. Los clics de contacto son anónimos, " +
    "así que este número cuenta acciones, no personas distintas.</p>" +
  "</div>";
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
            (n.categoria2 ? " · " + cat(n.categoria2).icono + " " + esc(cat(n.categoria2).nombre) : "") +
            (n.sub.length ? " · " + esc(n.sub.join(", ")) : "") + "</p>" +
        "</div></div>" +
      '<div class="fila g8">' +
        '<button class="btn linea chico" onclick="location.hash=\'#/editar/' + n.id + '\'">Editar perfil</button>' +
        '<a class="btn fantasma chico" href="#/negocio-mensajes/' + n.id + '">Mensajes</a>' +
        (n.estado === "publicado" ? '<a class="btn fantasma chico" href="#/negocio/' +
          esc(n.slug) + '">Ver perfil</a>' : "") +
      "</div></div>" +

    tarjetaContactos(n.contactos) +

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

    (PLANES_AUTOMATIZADOS.includes(n.plan) || (n.plan === "crece" && n.enlacePagoCrece)
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
  try { n = await obtenerPanel(id); }
  catch { return sinAcceso(); }

  const L = n.limites, P = n.permisos, c = cat(n.categoria);
  const c2 = n.categoria2 ? cat(n.categoria2) : null;
  const subOpciones = [...new Set([...c.sub, ...(c2 ? c2.sub : [])])];
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

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Foto de portada</p>' +
      (n.banner ? '<div class="banner-vista"><img src="' + esc(n.banner) + '" alt="Portada de ' + esc(n.nombre) + '"></div>' : "") +
      '<div class="fila g12">' +
        '<label class="btn linea chico">Subir foto de portada' +
        '<input type="file" accept="image/*" style="display:none" onchange="subirBanner(' + n.id + ',this)"></label>' +
        (n.banner ? '<button class="btn fantasma chico" onclick="quitarBanner(' + n.id +
          ')">Quitar portada</button>' : "") +
      "</div>" +
      '<p class="diminuto apagado">Se muestra en la parte de arriba de tu perfil, como la portada de Facebook. Incluido en todos los planes.</p></div>' +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Foto para el directorio</p>' +
      (n.fotoDestacada ? '<div class="banner-vista destacada"><img src="' + esc(n.fotoDestacada) + '" alt="Foto destacada de ' + esc(n.nombre) + '"></div>' : "") +
      '<div class="fila g12">' +
        '<label class="btn linea chico">Subir foto para el directorio' +
        '<input type="file" accept="image/*" style="display:none" onchange="subirFotoDestacada(' + n.id + ',this)"></label>' +
        (n.fotoDestacada ? '<button class="btn fantasma chico" onclick="quitarFotoDestacada(' + n.id +
          ')">Quitar</button>' : "") +
      "</div>" +
      '<p class="diminuto apagado">Es la miniatura que se ve en el directorio, donde aparecen todos los negocios en ' +
      'cuadritos. Si no subes una, se usa tu portada. Muestra algo de tu negocio: tu espacio, tu producto, tu ' +
      'servicio — no tiene que ser tu logo ni tu portada. Incluido en todos los planes.</p></div>' +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Datos del negocio</p>' +
      '<div class="rejilla-campos">' +
        '<label class="campo">Nombre<input id="f_nombre" value="' + esc(n.nombre) + '"></label>' +
        '<label class="campo">Ciudad<select id="f_ciudad" onchange="pintarAlcaldias(\'f\')"><option value="">Elige…</option>' +
          ENTIDADES_CIUDAD.map((x) => '<option value="' + esc(x) + '"' +
            (n.ciudad === x ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select></label>" +
        '<label class="campo">Alcaldía o municipio<select id="f_alcaldia"' + (n.ciudad ? "" : " disabled") + '>' +
          (n.ciudad
            ? '<option value="">Elige…</option>' + alcaldiasDe(n.ciudad).map((a) => '<option value="' + esc(a) + '"' +
                (n.alcaldiaMunicipio === a ? " selected" : "") + ">" + esc(a) + "</option>").join("")
            : '<option value="">Primero elige una ciudad</option>') +
        "</select></label>" +
      "</div>" +
      '<label class="campo">Dirección<input id="f_direccion" value="' + esc(n.direccion || "") + '"></label>' +
      '<label class="campo">Teléfono<input id="f_telefono" value="' + esc(n.telefono || "") + '"></label>' +
      '<label class="campo">Categoría principal<select id="f_categoria" onchange="cambiarCategoria(' +
        n.id + ',this.value)">' + CATEGORIAS.map((x) => '<option value="' + x.id + '"' +
          (n.categoria === x.id ? " selected" : "") + ">" + esc(x.icono + " " + x.nombre) + "</option>").join("") +
        "</select></label>" +
      '<label class="campo">Segunda categoría <span class="apagado">(opcional)</span><select id="f_categoria2" ' +
        'onchange="cambiarCategoria2(' + n.id + ',this.value,' + JSON.stringify(n.categoria).replace(/"/g, '&quot;') +
        ')"><option value="">Ninguna</option>' + CATEGORIAS.map((x) => '<option value="' + x.id + '"' +
          (n.categoria2 === x.id ? " selected" : "") + ">" + esc(x.icono + " " + x.nombre) + "</option>").join("") +
        "</select></label>" +
      '<div class="pila g8"><span class="campo">Subcategorías <span class="apagado">(hasta ' +
        MAX_SUBCATEGORIAS + " · llevas " + n.sub.length + ')</span></span>' +
        '<div class="subcats">' + subOpciones.map((s) =>
          '<button type="button" class="chip ' + (n.sub.includes(s) ? "rosa" : "") +
          '" onclick="alternarSubNegocio(' + n.id + "," + JSON.stringify(s).replace(/"/g, "&quot;") +
          ')">' + esc(s) + "</button>").join("") + "</div></div>" +
      '<label class="campo">Descripción <span class="apagado">(' + L.caracteresDescripcion +
        " caracteres con tu plan)</span>" +
        '<textarea id="f_descripcion" maxlength="' + L.caracteresDescripcion + '">' +
        esc(n.descripcion || "") + "</textarea></label>" +
    "</div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Sobre mi negocio</p>' +
      '<p class="pequeno apagado">Un espacio más para contar tu historia. Es un beneficio de ' +
      "negocios verificados: se guarda siempre, pero solo se muestra en tu perfil público " +
      "mientras MÍA te tenga verificada.</p>" +
      '<textarea id="f_sobre" maxlength="3000" placeholder="Cuéntale a tus clientas quién eres, ' +
      'tu historia, lo que te distingue…">' + esc(n.sobreNegocio || "") + "</textarea>" +
      (n.sobreNegocioVisible ? '<span class="chip jade">Visible en tu perfil</span>'
        : '<span class="chip">No se muestra todavía</span>') +
    "</div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Reporte mensual</p>' +
      (n.verificado && n.permisos.verificado
        ? '<div class="pila g8"><p class="pequeno apagado">Vistas e interacciones de tu perfil, ' +
          "mes por mes.</p><div><a class=\"btn linea chico\" href=\"#/reporte/" + n.id +
          '">Ver mi reporte mensual</a></div></div>'
        : cerrado('El reporte mensual de vistas e interacciones es un beneficio de negocios verificados.')) +
    "</div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Redes sociales y WhatsApp</p>' +
      '<p class="pequeno apagado">Pega el link que abre directo tu chat o tu perfil — no el ' +
      "usuario, el link completo. Así el botón en tu perfil lleva a la persona exactamente ahí.</p>" +
      '<div class="rejilla-campos">' +
        '<label class="campo">WhatsApp<input id="f_whatsapp" placeholder="https://wa.me/52..." value="' + esc(n.redes.whatsapp || "") +
          '"' + (P.redes ? "" : " disabled") + "></label>" +
        '<label class="campo">Instagram<input id="f_instagram" placeholder="https://instagram.com/tunegocio" value="' + esc(n.redes.instagram || "") +
          '"' + (P.redes ? "" : " disabled") + "></label>" +
        '<label class="campo">Facebook<input id="f_facebook" placeholder="https://facebook.com/tunegocio" value="' + esc(n.redes.facebook || "") +
          '"' + (P.redes ? "" : " disabled") + "></label>" +
        '<label class="campo">TikTok<input id="f_tiktok" placeholder="https://tiktok.com/@tunegocio" value="' + esc(n.redes.tiktok || "") +
          '"' + (P.redes ? "" : " disabled") + "></label>" +
      "</div>" +
      (P.redes ? "" : cerrado("Las redes sociales y el WhatsApp empiezan en el plan Suscripción. Lo que ya capturaste no se borra.")) +
    "</div>" +

    '<div class="tarjeta p20 pila g16"><p class="eyebrow">Clics en tus botones de contacto</p>' +
      '<p class="pequeno apagado">Cuántas veces tocaron cada botón en tu perfil público.</p>' +
      '<div class="metricas">' +
        metrica(n.interacciones.telefono, "Llamar") +
        metrica(n.interacciones.whatsapp, "WhatsApp", "jade") +
        metrica(n.interacciones.instagram, "Instagram", "cobalto") +
        metrica(n.interacciones.facebook, "Facebook", "cobalto") +
        metrica(n.interacciones.tiktok, "TikTok", "sol") +
      "</div></div>" +

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

    '<div class="tarjeta p20 pila g12"><div class="fila entre g12">' +
      '<div class="pila g4"><p class="eyebrow">Publicaciones</p>' +
        '<p class="pequeno apagado">' + (tope === Infinity
          ? "Publicaciones ilimitadas con tu plan."
          : "Tu plan muestra " + tope + (tope === 1 ? " publicación." : " publicaciones.")) +
          " Tienes " + pubs.length + ".</p></div>" +
      '<a class="btn linea chico" href="#/publicaciones/' + n.id + '">Administrar →</a>' +
    "</div></div>" +

    '<div class="tarjeta p20 pila g12"><div class="fila entre g12">' +
      '<div class="pila g4"><p class="eyebrow">Productos y servicios</p>' +
        '<p class="pequeno apagado">Tienes ' + n.productos.length +
          (n.productos.length === 1 ? " producto." : " productos.") + "</p></div>" +
      '<a class="btn linea chico" href="#/productos/' + n.id + '">Administrar →</a>' +
    "</div></div>" +

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

/* ============================================================= PUBLICACIONES */
/* La pestaña "Publicación" de la dueña: un feed de sus propias publicaciones,
 * como en cualquier red social — con foto, vistas y comentarios — en vez de
 * la lista de texto plano que vivía antes dentro del editor de perfil. */

let imagenPublicacionNueva = null;

async function vistaPublicaciones(id) {
  let n;
  try { n = await obtenerPanel(id); }
  catch { return sinAcceso(); }

  const tope = n.limites.publicaciones;

  return '<div class="envoltura bloque pila g24" style="max-width:640px">' +
    '<div class="fila entre g12 arriba"><div class="pila g4"><p class="eyebrow">' + esc(n.nombre) + "</p>" +
      "<h1>Publicaciones</h1></div>" +
      '<a class="btn linea chico" href="#/editar/' + n.id + '">← Mi negocio</a></div>' +
    '<p class="pequeno apagado">' + (tope === Infinity
      ? "Publicaciones ilimitadas con tu plan."
      : "Tu plan muestra " + tope + (tope === 1 ? " publicación." : " publicaciones.") + " Tienes " + n.publicaciones.length + ".") +
    "</p>" +

    formularioNuevaPublicacion(n.id) +

    (n.publicaciones.length ? '<div class="pila g16">' +
      n.publicaciones.map((p) => tarjetaPublicacionPanel(p, n.id, n.permisos.publicacionesDestacadas)).join("") +
      "</div>" : vacio("Todavía no publicas nada. Cuéntale a tus clientas qué hay de nuevo.")) +
  "</div>";
}

function formularioNuevaPublicacion(negocioId) {
  return '<div class="tarjeta p20 pila g12">' +
    '<p class="eyebrow">Nueva publicación</p>' +
    '<label style="position:relative;display:block;aspect-ratio:16/9;border-radius:var(--r);overflow:hidden;' +
      'border:1.5px dashed var(--linea);cursor:pointer;background:var(--fondo2)">' +
      '<input type="file" accept="image/*" style="display:none" onchange="previsualizarImagenPublicacion(this)">' +
      '<img id="prev_pub_img" style="display:none;width:100%;height:100%;object-fit:cover">' +
      '<span id="prev_pub_txt" style="position:absolute;inset:0;display:flex;align-items:center;' +
        'justify-content:center;color:var(--texto2);font-size:.85rem">📷 Agregar una foto (opcional)</span>' +
    "</label>" +
    '<label class="campo">Título<input id="pu_titulo" placeholder="Agenda abierta para diciembre"></label>' +
    '<label class="campo">Texto<textarea id="pu_texto" style="min-height:90px" ' +
      'placeholder="¿Qué quieres contarle a tus clientas?"></textarea></label>' +
    '<div><button class="btn" onclick="agregarPublicacion(' + negocioId + ')">Publicar</button></div>' +
  "</div>";
}

/** Tarjeta de una publicación para la dueña: además del texto, sus vistas y
 * comentarios (que llevan a la publicación completa) y sus acciones. */
function tarjetaPublicacionPanel(p, negocioId, puedeDestacar) {
  return '<div class="publicacion' + (p.destacada ? " destacada" : "") + '"' +
    (p.visible ? "" : ' style="opacity:.5"') + ">" +
    (p.imagen ? '<div class="portada" style="aspect-ratio:16/9;margin:-16px -16px 12px;width:calc(100% + 32px)">' +
      imagenHtml(p.imagen, p.titulo) + "</div>" : "") +
    '<div class="fila entre g8"><strong>' + esc(p.titulo) + "</strong>" +
      (p.destacada ? '<span class="chip rosa">Destacada</span>' : "") + "</div>" +
    '<p class="diminuto apagado">' + esc(fecha(p.creado_en)) +
      (p.visible ? "" : " · no se muestra con tu plan") + "</p>" +
    '<p class="pequeno" style="white-space:pre-wrap">' + esc(p.texto) + "</p>" +
    '<div class="fila entre g8" style="margin-top:2px">' +
      '<a class="pequeno apagado" style="text-decoration:none" href="#/publicacion/' + p.id + '">' +
        "👁 " + p.vistas + " · 💬 " + p.total_comentarios +
        (p.total_comentarios === 1 ? " comentario" : " comentarios") + "</a>" +
      '<div class="fila g8">' +
        (puedeDestacar ? '<button class="btn fantasma chico" onclick="alternarDestacadaPub(' + negocioId + "," + p.id +
          ')">' + (p.destacada ? "Quitar destacada" : "Destacar") + "</button>" : "") +
        '<button class="btn fantasma chico" onclick="quitarPublicacion(' + negocioId + "," + p.id + ')">Borrar</button>' +
      "</div>" +
    "</div>" +
  "</div>";
}

function previsualizarImagenPublicacion(input) {
  procesarImagen(input, 1000, 0.75, (dataUrl) => {
    imagenPublicacionNueva = dataUrl;
    if ($("prev_pub_img")) { $("prev_pub_img").src = dataUrl; $("prev_pub_img").style.display = "block"; }
    if ($("prev_pub_txt")) $("prev_pub_txt").style.display = "none";
  });
}

/** Una sola publicación, como un post: su foto, su texto completo, sus
 * vistas (que se cuentan al abrir esta página) y su hilo de comentarios. */
async function vistaPublicacionDetalle(id) {
  let p;
  try { p = await api.get("/api/publicaciones/" + id); }
  catch { return '<div class="envoltura bloque"><h2>No encontramos esa publicación</h2>' +
    '<p style="margin-top:14px"><a class="btn" href="#/directorio">Ver el directorio</a></p></div>'; }

  return '<div class="envoltura bloque pila g24" style="max-width:640px">' +
    '<div class="pila g8">' +
      '<a class="pequeno apagado" style="text-decoration:none" href="#/negocio/' + esc(p.negocio.slug) +
        '">← ' + esc(p.negocio.nombre) + "</a>" +
      '<p class="eyebrow">' + esc(fecha(p.creadoEn)) + (p.destacada ? " · Destacada" : "") + "</p>" +
      "<h1>" + esc(p.titulo) + "</h1>" +
    "</div>" +
    (p.imagen ? '<div class="portada" style="aspect-ratio:16/9">' + imagenHtml(p.imagen, p.titulo) + "</div>" : "") +
    '<p style="white-space:pre-wrap">' + esc(p.texto) + "</p>" +
    '<p class="pequeno apagado">👁 ' + p.vistas + (p.vistas === 1 ? " vista" : " vistas") + "</p>" +
    '<hr class="separador">' +
    '<div class="pila g16"><p class="eyebrow">Comentarios</p>' +
      (YO ? '<div class="tarjeta p16 pila g8">' +
        '<textarea id="pc_texto" style="min-height:70px" placeholder="Escribe un comentario…"></textarea>' +
        '<p id="pc_error" class="pequeno" style="color:var(--peligro)"></p>' +
        '<div><button class="btn chico" onclick="comentarPublicacion(' + p.id + ')">Comentar</button></div></div>'
        : '<div class="aviso">Para comentar <a href="#/entrar" style="color:var(--acento);font-weight:700">entra con tu correo</a>.</div>') +
      (p.comentarios.length ? p.comentarios.map((c) => bloqueComentarioPublicacion(c, p.negocio.id)).join("")
        : '<p class="apagado pequeno">Sé la primera en comentar.</p>') +
    "</div>" +
  "</div>";
}

function bloqueComentarioPublicacion(c, negocioId) {
  const puedeBorrar = YO && (YO.rol === "admin" || YO.id === c.usuario_id ||
    (YO.rol === "negocio" && MI_NEGOCIO_ID === negocioId));
  return '<div class="tarjeta p16 pila g4">' +
    '<div class="fila entre g8"><strong class="pequeno">' + esc(c.autora) + "</strong>" +
    '<span class="diminuto apagado">' + esc(fecha(c.creado_en)) + "</span></div>" +
    "<p>" + esc(c.texto) + "</p>" +
    (puedeBorrar ? '<div><button class="btn fantasma chico" onclick="borrarComentarioPublicacion(' + c.id +
      ')">Borrar</button></div>' : "") +
  "</div>";
}

async function comentarPublicacion(id) {
  const texto = val("pc_texto");
  const decir = (m) => { if ($("pc_error")) $("pc_error").textContent = m; };
  if (texto.length < 2) return decir("Escribe tu comentario.");
  try {
    await api.post("/api/publicaciones/" + id + "/comentarios", { texto });
    await pintar();
    avisar("Comentario publicado.");
  } catch (err) { decir(err instanceof ErrorApi ? err.message : "No se pudo publicar tu comentario."); }
}

async function borrarComentarioPublicacion(id) {
  if (!confirm("¿Borrar este comentario?")) return;
  try { await api.del("/api/publicaciones/comentarios/" + id); await pintar(); avisar("Borramos el comentario."); }
  catch (err) { avisarError(err); }
}

/* =================================================================== PRODUCTOS */
/* La pestaña "Producto" de la dueña: una cuadrícula igual a la del
 * directorio de negocios, con una casilla fija para agregar uno nuevo. */

let imagenProductoNueva = null;

async function vistaProductos(id) {
  let n;
  try { n = await obtenerPanel(id); }
  catch { return sinAcceso(); }

  return '<div class="envoltura bloque pila g24">' +
    '<div class="fila entre g12 arriba"><div class="pila g4"><p class="eyebrow">' + esc(n.nombre) + "</p>" +
      "<h1>Productos y servicios</h1></div>" +
      '<a class="btn linea chico" href="#/editar/' + n.id + '">← Mi negocio</a></div>' +
    (n.permisos.productosDestacados ? "" :
      '<p class="pequeno apagado">🔒 Destacar productos empieza en el plan Suscripción.</p>') +
    '<div class="rejilla">' +
      tarjetaAgregarProducto(n.id) +
      n.productos.map((p) => tarjetaProductoPanel(p, n.id, n.permisos.productosDestacados)).join("") +
    "</div>" +
    (n.productos.length ? '<div><a class="btn fantasma chico" href="#/ventas/' + n.id +
      '">Ver mi registro de ventas</a></div>' : "") +
  "</div>";
}

function tarjetaAgregarProducto(negocioId) {
  return '<div class="tarjeta tarjeta-negocio" style="border:1.5px dashed var(--linea)">' +
    '<label class="portada" style="display:block;cursor:pointer;background:var(--fondo2)">' +
      '<input type="file" accept="image/*" style="display:none" onchange="previsualizarImagenProducto(this)">' +
      '<img id="prev_prod_img" style="display:none;width:100%;height:100%;object-fit:cover">' +
      '<span id="prev_prod_txt" style="position:absolute;inset:0;display:flex;align-items:center;' +
        'justify-content:center;color:var(--texto2);font-size:.8rem;text-align:center;padding:10px">' +
        "📷 Agregar foto</span>" +
    "</label>" +
    '<div class="cuerpo">' +
      '<p class="eyebrow">Agregar nuevo producto</p>' +
      '<label class="campo">Nombre<input id="p_nombre" placeholder="Ej. Pastel de tres leches"></label>' +
      '<label class="campo">Descripción<input id="p_desc" placeholder="Corta y clara"></label>' +
      '<label class="campo">Precio<input id="p_precio" type="number" min="0" placeholder="0"></label>' +
      '<button class="btn" onclick="agregarProducto(' + negocioId + ')">Agregar producto</button>' +
    "</div>" +
  "</div>";
}

/** Tarjeta de un producto para la dueña: la misma foto/nombre/precio que ve
 * cualquier clienta, más sus acciones de destacar y borrar. */
function tarjetaProductoPanel(p, negocioId, puedeDestacar) {
  return '<div class="tarjeta tarjeta-negocio">' +
    productoImagenHtml(p, p.destacado) +
    '<div class="cuerpo">' +
      "<h3>" + esc(p.nombre) + "</h3>" +
      (p.descripcion ? '<p class="pequeno apagado" style="flex:1">' + esc(p.descripcion) + "</p>" : "") +
      (p.precio ? '<p class="mono" style="font-weight:700">' + pesos(p.precio) + "</p>" : "") +
      '<div class="fila g8">' +
        (puedeDestacar ? '<button class="btn fantasma chico" onclick="alternarDestacadoProd(' + negocioId + "," + p.id +
          ')">' + (p.destacado ? "Quitar destacado" : "Destacar") + "</button>" : "") +
        '<button class="btn fantasma chico" onclick="quitarProducto(' + negocioId + "," + p.id + ')">Borrar</button>' +
      "</div>" +
    "</div>" +
  "</div>";
}

function previsualizarImagenProducto(input) {
  procesarImagen(input, 700, 0.78, (dataUrl) => {
    imagenProductoNueva = dataUrl;
    if ($("prev_prod_img")) { $("prev_prod_img").src = dataUrl; $("prev_prod_img").style.display = "block"; }
    if ($("prev_prod_txt")) $("prev_prod_txt").style.display = "none";
  });
}

/* ================================================================== REPORTE */
const mesNombre = (mes) => {
  const d = new Date(mes + "-02T00:00:00");
  return isNaN(d) ? mes : d.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
};

async function vistaReporte(id) {
  let n, meses;
  try {
    n = await api.get("/api/negocios/" + id + "/panel");
    meses = await api.get("/api/negocios/" + id + "/reporte");
  } catch { return sinAcceso(); }

  return '<div class="envoltura bloque pila g24">' +
    '<div class="pila g8"><a class="pequeno apagado" href="#/editar/' + n.id + '">← ' + esc(n.nombre) + "</a>" +
      '<p class="eyebrow">Reporte mensual</p><h1>Vistas e interacciones</h1>' +
      '<p class="apagado" style="max-width:58ch">Los últimos meses de tu perfil, actualizados en ' +
      "tiempo real. Solo tú puedes verlo.</p></div>" +

    (meses.length ? '<div class="tabla-envoltura"><table><thead><tr><th>Mes</th><th>Vistas</th>' +
      "<th>Llamar</th><th>WhatsApp</th><th>Instagram</th><th>Facebook</th><th>TikTok</th></tr></thead><tbody>" +
      meses.map((m) => "<tr><td>" + esc(mesNombre(m.mes)) + '</td><td class="mono">' + m.vistas +
        '</td><td class="mono">' + m.telefono + '</td><td class="mono">' + m.whatsapp +
        '</td><td class="mono">' + m.instagram + '</td><td class="mono">' + m.facebook +
        '</td><td class="mono">' + m.tiktok + "</td></tr>").join("") + "</tbody></table></div>"
      : vacio("Todavía no hay suficientes datos este mes. Vuelve más adelante.")) +
  "</div>";
}

/* ==================================================================== VENTAS */
const ETIQUETA_CONSULTA = {
  pendiente: ["Por confirmar", ""],
  vendido: ["Se vendió", "jade"],
  en_platicas: ["Sigue en pláticas", "sol"],
  no_concretado: ["No se concretó", ""],
};

async function vistaVentas(id) {
  let consultas;
  try { consultas = await api.get("/api/negocios/" + id + "/consultas"); }
  catch { return sinAcceso(); }

  return '<div class="envoltura bloque pila g24">' +
    '<div class="pila g8"><a class="pequeno apagado" href="#/editar/' + id + '">← Volver a mi negocio</a>' +
      '<p class="eyebrow">Privado, solo tú lo ves</p><h1>Registro de ventas</h1>' +
      '<p class="apagado" style="max-width:58ch">Cada vez que alguien pregunta por un producto desde tu ' +
      "perfil, queda aquí. Confirma cuando sepas cómo quedó — no hay prisa; si no contestas, te " +
      "recordamos una sola vez, a los 4 días.</p></div>" +

    (consultas.length ? '<div class="pila g12">' + consultas.map((c) => {
      const [etiqueta, tono] = ETIQUETA_CONSULTA[c.resultado];
      return '<div class="tarjeta p16 pila g8">' +
        '<div class="fila entre g8"><strong>' + esc(c.producto_nombre) + '</strong>' +
          '<span class="chip ' + tono + '">' + etiqueta + "</span></div>" +
        '<p class="pequeno apagado">' + esc(c.usuaria_nombre) + " · " +
          (c.mensaje_tipo === "disponible" ? "preguntó si estaba disponible" : "dijo que le interesa") +
          " · " + esc(fecha(c.creado_en)) + "</p>" +
        (c.resultado === "pendiente" ? '<div class="fila g8">' +
          '<button class="btn chico" onclick="resolverConsulta(' + id + "," + c.id + ",'vendido')\">Se vendió</button>" +
          '<button class="btn linea chico" onclick="resolverConsulta(' + id + "," + c.id + ",'en_platicas')\">Sigue en pláticas</button>" +
          '<button class="btn fantasma chico" onclick="resolverConsulta(' + id + "," + c.id + ",'no_concretado')\">No se concretó</button>" +
        "</div>" : "") +
      "</div>";
    }).join("") + "</div>"
      : vacio("Cuando alguien pregunte por un producto tuyo, aparecerá aquí.")) +
  "</div>";
}

async function resolverConsulta(negocioId, consultaId, resultado) {
  try {
    await api.patch("/api/negocios/" + negocioId + "/consultas/" + consultaId, { resultado });
    await pintar();
    avisar("Listo, quedó registrado.");
  } catch (err) { avisarError(err); }
}

async function guardarNegocio(id) {
  const nombre = val("f_nombre");
  if (!nombre) return avisar("El negocio necesita un nombre.");
  try {
    await api.patch("/api/negocios/" + id, {
      nombre, ciudad: val("f_ciudad"), alcaldiaMunicipio: val("f_alcaldia"), direccion: val("f_direccion"), telefono: val("f_telefono"),
      descripcion: val("f_descripcion"), sobreNegocio: val("f_sobre"),
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

async function cambiarCategoria2(id, categoria2, categoriaActual) {
  if (categoria2 && categoria2 === categoriaActual) {
    avisar("Esa ya es tu categoría principal; elige otra o déjala en \"Ninguna\".");
    return pintar();
  }
  try {
    await api.patch("/api/negocios/" + id, { categoria2, sub: [] });
    await pintar();
    avisar("Cambiaste tu segunda categoría. Vuelve a elegir tus subcategorías.");
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
function subirBanner(id, input) {
  procesarImagen(input, 1200, 0.75, async (dataUrl) => {
    try { await api.post("/api/negocios/" + id + "/banner", { imagen: dataUrl }); await pintar(); avisar("Actualizamos tu foto de portada."); }
    catch (err) { avisarError(err); }
  });
}
async function quitarBanner(id) {
  try { await api.del("/api/negocios/" + id + "/banner"); await pintar(); avisar("Quitamos la foto de portada."); }
  catch (err) { avisarError(err); }
}
function subirFotoDestacada(id, input) {
  procesarImagen(input, 900, 0.75, async (dataUrl) => {
    try { await api.post("/api/negocios/" + id + "/foto-destacada", { imagen: dataUrl }); await pintar(); avisar("Actualizamos tu foto para el directorio."); }
    catch (err) { avisarError(err); }
  });
}
async function quitarFotoDestacada(id) {
  try { await api.del("/api/negocios/" + id + "/foto-destacada"); await pintar(); avisar("Quitamos la foto del directorio."); }
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
    const n = conLimitesRestaurados(await api.post("/api/negocios/" + id + "/publicaciones", { titulo, texto, imagen: imagenPublicacionNueva }));
    imagenPublicacionNueva = null;
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
    await api.post("/api/negocios/" + id + "/productos", {
      nombre, precio: val("p_precio"), descripcion: val("p_desc"), imagen: imagenProductoNueva,
    });
    imagenProductoNueva = null;
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
    ["negocios", "Negocios"], ["contactos", "Contactos"], ["usuarias", "Usuarias"], ["resenas", "Reseñas"],
    ["pagos", "Pagos"], ["blog", "Blog"], ["bitacora", "Bitácora"]];

  let contenido;
  if (s === "resumen") contenido = await adminResumen();
  else if (s === "solicitudes") contenido = adminSolicitudes(solicitudes);
  else if (s === "negocios") contenido = await adminNegocios();
  else if (s === "contactos") contenido = await adminContactos();
  else if (s === "usuarias") contenido = await adminUsuarias();
  else if (s === "resenas") contenido = await adminResenas();
  else if (s === "pagos") contenido = await adminPagos();
  else if (s === "blog") contenido = await adminBlog();
  else contenido = await adminBitacora();

  return '<div class="envoltura shell"><aside class="lateral">' +
    tabs.map(([k, t]) => '<button class="' + (s === k ? "activo" : "") +
      '" onclick="location.hash=\'#/admin/' + k + '\'">' + esc(t) + "</button>").join("") +
    '<hr class="separador" style="margin:6px 0">' +
    '<button onclick="salir()">Cerrar sesión</button>' +
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
      metrica(r.contactosMensuales, "Contactos generados este mes", "cobalto") +
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
        " · " + esc(ciudadCompleta(n) || "sin ciudad") + '</span><br><span class="diminuto apagado">' +
        cat(n.categoria).icono + " " + esc(cat(n.categoria).nombre) +
        (n.categoria2 ? " · " + cat(n.categoria2).icono + " " + esc(cat(n.categoria2).nombre) : "") +
        "</span></div></div></td>" +
      '<td><span class="chip ' + ESTADOS[n.estado].chip + '">' + esc(ESTADOS[n.estado].et) + "</span></td>" +
      '<td><select onchange="adminPlan(' + n.id + ',this.value)" style="min-width:126px">' +
        ORDEN_PLANES.map((k) => '<option value="' + k + '"' + (n.plan === k ? " selected" : "") + ">" +
          esc(PLANES[k].nombre) + "</option>").join("") + "</select>" +
        (n.membresiaVencida ? '<br><span class="chip peligro" style="margin-top:4px">Vencido</span>' : "") +
        (!n.pagoConfirmado ? '<br><button class="btn chico" style="margin-top:4px" onclick="confirmarPago(' +
          n.id + ')">Confirmar pago</button>' : "") +
        (n.plan === "crece" ? '<br><button class="btn linea chico" style="margin-top:4px" onclick="adminEnlacePago(' +
          n.id + ",'" + encodeURIComponent(n.enlacePagoCrece || "") + "')\">" +
          (n.enlacePagoCrece ? "Editar enlace de pago" : "Agregar enlace de pago") + "</button>" : "") +
        (n.descuentoPorcentaje > 0 ? '<br><span class="chip jade" style="margin-top:4px">' +
          n.descuentoPorcentaje + "% de descuento</span>" : "") +
        '<br><button class="btn fantasma chico" style="margin-top:4px" onclick="adminDescuento(' + n.id + "," +
          n.descuentoPorcentaje + ')">' + (n.descuentoPorcentaje > 0 ? "Cambiar descuento" : "Dar descuento") +
          "</button></td>" +
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

async function adminDescuento(id, actual) {
  const texto = prompt(
    "Descuento permanente para este negocio, de 0 a 100 (por ejemplo, 100 para un negocio de cortesía que nunca " +
    "paga). Se resta del precio de lista al calcular cuánto gana MÍA; no le cambia nada a la dueña ni a Stripe.",
    String(actual || 0)
  );
  if (texto === null) return;
  const porcentaje = Number(texto);
  if (!Number.isInteger(porcentaje) || porcentaje < 0 || porcentaje > 100) {
    return avisar("Escribe un número entero entre 0 y 100.");
  }
  try {
    await api.patch("/api/admin/negocios/" + id + "/descuento", { porcentaje });
    await pintar();
    avisar(porcentaje > 0 ? "Descuento del " + porcentaje + "% aplicado." : "Quitamos el descuento.");
  } catch (err) { avisarError(err); }
}

async function adminEnlacePago(id, actualCodificado) {
  const actual = decodeURIComponent(actualCodificado);
  const enlace = prompt(
    "Pega el Payment Link de Stripe que creaste para este negocio (con su precio ya cotizado).\n" +
    "Déjalo vacío para quitarlo.",
    actual
  );
  if (enlace === null) return;
  try {
    await api.patch("/api/admin/negocios/" + id + "/enlace-pago", { enlace: enlace.trim() });
    await pintar();
    avisar(enlace.trim() ? "Enlace de pago guardado." : "Enlace de pago quitado.");
  } catch (err) { avisarError(err); }
}

/* -------------------------------------------------------------- contactos */
async function adminContactos() {
  const r = await api.get("/api/admin/contactos");
  const filas = r.porNegocio.map((n) =>
    "<tr><td>" + esc(n.nombre) + "</td>" +
    '<td><span class="chip cobalto">' + esc(PLANES[n.plan].nombre) + "</span></td>" +
    '<td class="mono" style="font-weight:700">' + n.total + "</td>" +
    '<td class="mono diminuto">' + n.conversaciones + "</td>" +
    '<td class="mono diminuto">' + n.consultas + "</td>" +
    '<td class="mono diminuto">' + n.whatsapp + "</td>" +
    '<td class="mono diminuto">' + n.telefono + "</td>" +
    '<td class="mono diminuto">' + n.redes + "</td></tr>"
  ).join("");

  return encabezado("Contactos", "Cada vez que una clienta le escribe a un negocio, pregunta por un producto, o " +
    "toca WhatsApp/teléfono/redes desde su perfil — este mes, en toda MÍA.") +
    '<div class="metricas">' +
      metrica(r.total, "Total este mes", "cobalto") +
      metrica(r.porTipo.conversaciones, "Conversaciones") +
      metrica(r.porTipo.consultas, "Consultas de producto") +
      metrica(r.porTipo.whatsapp, "WhatsApp", "jade") +
      metrica(r.porTipo.telefono, "Llamadas") +
      metrica(r.porTipo.redes, "Clics en redes", "sol") +
    "</div>" +
    '<div class="pila g12"><p class="eyebrow">Por plan</p><div class="metricas">' +
      ORDEN_PLANES.map((k) => metrica(r.porPlan[k] || 0, PLANES[k].nombre,
        { gratuito: "sol", suscripcion: "cobalto", membresia: "", crece: "jade" }[k])).join("") +
    "</div></div>" +
    '<div class="pila g12"><p class="eyebrow">Por negocio</p>' +
    (r.porNegocio.length
      ? '<div class="tabla-envoltura"><table><thead><tr><th>Negocio</th><th>Plan</th><th>Total</th>' +
        "<th>Conversaciones</th><th>Consultas</th><th>WhatsApp</th><th>Llamadas</th><th>Redes</th></tr></thead>" +
        "<tbody>" + filas + "</tbody></table></div>"
      : vacio("Todavía no hay contactos registrados este mes.")) +
    "</div>";
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
// Se guardan aparte (no solo en el DOM) porque agregar una foto vuelve a
// dibujar toda la pantalla — sin esto, se borraría lo ya escrito.
let borradorFotosBlog = [];
let borradorTitulo = "", borradorResumen = "", borradorCuerpo = "";

async function adminBlog() {
  const articulos = await api.get("/api/blog");
  return encabezado("Blog", "Escribe y publica los artículos de MÍA.") +
    '<div class="tarjeta p20 pila g12"><p class="eyebrow">Nuevo artículo</p>' +
      '<label class="campo">Título<input id="b_titulo" value="' + esc(borradorTitulo) +
        '" oninput="borradorTitulo=this.value"></label>' +
      '<label class="campo">Resumen<input id="b_resumen" value="' + esc(borradorResumen) +
        '" oninput="borradorResumen=this.value" placeholder="Una línea que invite a leer."></label>' +
      '<label class="campo">Contenido <span class="apagado">(deja una línea en blanco entre párrafos)</span>' +
        '<textarea id="b_cuerpo" style="min-height:170px" oninput="borradorCuerpo=this.value">' +
        esc(borradorCuerpo) + "</textarea></label>" +
      '<label class="campo">Fotos (opcional)</label>' +
      (borradorFotosBlog.length ? '<div class="galeria">' + borradorFotosBlog.map((f, i) =>
        '<div class="foto"><img src="' + f + '" alt=""><button class="quitar" onclick="quitarFotoBorrador(' + i +
        ')">Quitar</button></div>').join("") + "</div>" : "") +
      '<label class="btn linea chico" style="align-self:flex-start">Agregar foto' +
        '<input type="file" accept="image/*" style="display:none" onchange="agregarFotoBorrador(this)"></label>' +
      '<div><button class="btn" onclick="crearArticulo()">Publicar artículo</button></div></div>' +
    (articulos.length ? '<div class="pila g12">' + articulos.map(fichaArticuloAdmin).join("") + "</div>"
      : vacio("Todavía no hay artículos."));
}

function agregarFotoBorrador(input) {
  procesarImagen(input, 1200, 0.75, async (dataUrl) => {
    borradorFotosBlog.push(dataUrl);
    await pintar();
  });
}
function quitarFotoBorrador(i) {
  borradorFotosBlog.splice(i, 1);
  pintar();
}

function fichaArticuloAdmin(a) {
  return '<div class="tarjeta p16 pila g12">' +
    '<div class="fila entre g8 arriba"><div style="flex:1;min-width:180px">' +
      '<div class="fila g8"><span class="chip ' + (a.publicado ? "jade" : "sol") + '">' +
      (a.publicado ? "Publicado" : "Borrador") + '</span><span class="diminuto apagado">' +
      esc(fecha(a.creado_en)) + "</span></div>" +
      "<strong>" + esc(a.titulo) + '</strong><p class="diminuto apagado">' + esc(a.resumen) + "</p></div>" +
      '<div class="fila g8"><a class="btn fantasma chico" href="#/blog/' + esc(a.slug) + '">Ver</a>' +
      '<button class="btn linea chico" onclick="alternarArticulo(' + a.id + ')">' +
      (a.publicado ? "Ocultar" : "Publicar") + "</button>" +
      '<button class="btn fantasma chico" onclick="borrarArticulo(' + a.id + ')">Borrar</button></div></div>' +
    (a.fotos.length ? '<div class="galeria">' + a.fotos.map((f) =>
      '<div class="foto">' + imagenHtml(f.url, a.titulo) +
      '<button class="quitar" onclick="quitarFotoArticulo(' + a.id + "," + f.id + ')">Quitar</button></div>'
    ).join("") + "</div>" : "") +
    '<label class="btn linea chico" style="align-self:flex-start">Agregar foto' +
      '<input type="file" accept="image/*" style="display:none" onchange="subirFotoArticulo(' + a.id +
      ',this)"></label>' +
  "</div>";
}
async function crearArticulo() {
  const titulo = val("b_titulo"), cuerpo = val("b_cuerpo");
  if (!titulo) return avisar("Ponle título al artículo.");
  try {
    await api.post("/api/admin/blog", { titulo, resumen: val("b_resumen"), cuerpo, fotos: borradorFotosBlog });
    borradorFotosBlog = [];
    borradorTitulo = borradorResumen = borradorCuerpo = "";
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
function subirFotoArticulo(id, input) {
  procesarImagen(input, 1200, 0.75, async (dataUrl) => {
    try { await api.post("/api/admin/blog/" + id + "/fotos", { imagen: dataUrl }); await pintar(); avisar("Subimos la fotografía."); }
    catch (err) { avisarError(err); }
  });
}
async function quitarFotoArticulo(id, fotoId) {
  try { await api.del("/api/admin/blog/" + id + "/fotos/" + fotoId); await pintar(); }
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
