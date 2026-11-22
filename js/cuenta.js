/* AI Bridge Lite - Cuenta de Google (Google Identity Services, solo cliente)
   Expone window.AIBridgeCuenta. No guarda tokens: solo nombre, correo y foto.
   Aviso: el JWT se decodifica sin verificar la firma; sirve para mostrar el perfil,
   nunca para autorizar nada en un servidor. */
(function (global) {
  "use strict";

  const CLIENT_ID = "1090244179416-4p8e04q5ne7d75qemiv3js7gq5ipfm04.apps.googleusercontent.com";
  const KEY = "aibl_cuenta_v1";
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const EMISORES = ["accounts.google.com", "https://accounts.google.com"];
  const EVENTO = "aibl:cuenta";

  const $ = (id) => document.getElementById(id);
  const texto = (v) => (typeof v === "string" ? v : "");

  let perfil = null;
  let memoria = null;       // respaldo si localStorage no está disponible
  let cargaGis = null;      // promesa de carga del script de Google
  let gisIniciado = false;

  /* ================= ALMACENAMIENTO ================= */
  function normalizar(d) {
    if (!d) return null;
    if (typeof d !== "object") return null;
    const nombre = texto(d.nombre).trim().slice(0, 80);
    const email = texto(d.email).trim().slice(0, 120);
    if (!nombre && !email) return null;
    const foto = texto(d.foto).startsWith("https://") ? texto(d.foto).slice(0, 500) : "";
    return { nombre, email, foto, sub: texto(d.sub).slice(0, 40) };
  }

  function cargar() {
    try {
      const raw = global.localStorage.getItem(KEY);
      return normalizar(raw ? JSON.parse(raw) : null);
    } catch (_) {
      return normalizar(memoria);
    }
  }

  function guardar() {
    memoria = perfil ? Object.assign({}, perfil) : null;
    try {
      if (perfil) global.localStorage.setItem(KEY, JSON.stringify(perfil));
      else global.localStorage.removeItem(KEY);
    } catch (_) {}
  }

  /* ================= JWT ================= */
  function decodificarJwt(token) {
    try {
      const parte = String(token).split(".")[1];
      const b64 = parte.replace(/-/g, "+").replace(/_/g, "/");
      const bin = global.atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      return JSON.parse(new global.TextDecoder().decode(bytes));
    } catch (_) {
      return null;
    }
  }

  function reclamosValidos(d) {
    if (!d) return false;
    if (d.aud !== CLIENT_ID) return false;
    if (!EMISORES.includes(d.iss)) return false;
    return Number(d.exp) * 1000 > Date.now();
  }

  /* ================= INTERFAZ ================= */
  function aviso(t) {
    const el = $("cuenta-aviso");
    if (!el) return;
    el.textContent = texto(t);
    el.hidden = !t;
  }

  function pintarAvatar() {
    const av = $("cuenta-avatar");
    if (!av) return;
    av.textContent = "";
    const base = perfil ? (perfil.nombre ? perfil.nombre : perfil.email) : "";
    const inicial = base ? base.charAt(0).toUpperCase() : "?";
    if (perfil && perfil.foto) {
      const im = document.createElement("img");
      im.alt = "";
      im.referrerPolicy = "no-referrer";
      im.onerror = () => { av.textContent = inicial; };
      im.src = perfil.foto;
      av.appendChild(im);
    } else {
      av.textContent = inicial;
    }
  }

  function render() {
    const inv = $("cuenta-invitado");
    const per = $("cuenta-perfil");
    if (!inv) return;
    if (!per) return;
    inv.hidden = perfil !== null;
    per.hidden = perfil === null;
    if (!perfil) return;
    $("cuenta-nombre").textContent = perfil.nombre ? perfil.nombre : "Cuenta de Google";
    $("cuenta-email").textContent = perfil.email;
    pintarAvatar();
  }

  function avisarCambio() {
    const detalle = perfil ? Object.assign({}, perfil) : null;
    global.dispatchEvent(new global.CustomEvent(EVENTO, { detail: detalle }));
  }

  /* ================= GOOGLE IDENTITY SERVICES ================= */
  function cargarGis() {
    if (global.google && global.google.accounts && global.google.accounts.id) return Promise.resolve();
    if (cargaGis) return cargaGis;
    cargaGis = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { cargaGis = null; s.remove(); reject(new Error("gis")); };
      document.head.appendChild(s);
    });
    return cargaGis;
  }

  function dibujarBoton() {
    const cont = $("g-boton");
    if (!cont) return;
    if (perfil) return;
    cont.textContent = "";
    const medido = Math.round(cont.clientWidth);
    const ancho = Math.min(400, Math.max(200, medido > 0 ? medido : 264));
    global.google.accounts.id.renderButton(cont, {
      type: "standard",
      theme: "filled_black",
      size: "large",
      shape: "rectangular",
      text: "signin_with",
      logo_alignment: "left",
      locale: "es",
      width: ancho
    });
  }

  function alRespuesta(resp) {
    const d = decodificarJwt(resp ? resp.credential : "");
    if (!reclamosValidos(d)) { aviso("No se pudo iniciar sesión. Inténtalo de nuevo."); return; }
    aviso("");
    API.setPerfil({ nombre: d.name, email: d.email, foto: d.picture, sub: d.sub });
  }

  async function iniciarGis() {
    try {
      await cargarGis();
      if (!gisIniciado) {
        global.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: alRespuesta,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true
        });
        gisIniciado = true;
      }
      aviso("");
      dibujarBoton();
    } catch (_) {
      aviso("Sin conexión: no se pudo cargar el acceso con Google.");
    }
  }

  /* ================= API PÚBLICA ================= */
  // Puente opcional (Android WebView/Kotlin): el nativo puede llamar
  // AIBridgeCuenta.setPerfil({ nombre, email, foto, sub }) y AIBridgeCuenta.cerrarSesion().
  const API = {
    EVENTO,
    getPerfil: () => (perfil ? Object.assign({}, perfil) : null),
    estaLogueado: () => perfil !== null,

    setPerfil(datos) {
      const p = normalizar(datos);
      if (!p) return false;
      perfil = p;
      guardar();
      render();
      avisarCambio();
      return true;
    },

    async cerrarSesion() {
      perfil = null;
      guardar();
      render();
      avisarCambio();
      await iniciarGis();
      try { global.google.accounts.id.disableAutoSelect(); } catch (_) {}
    }
  };

  global.AIBridgeCuenta = API;

  /* ================= INICIO ================= */
  perfil = cargar();
  render();

  const btnSalir = $("btn-cerrar-sesion");
  if (btnSalir) btnSalir.addEventListener("click", () => { API.cerrarSesion(); });

  global.addEventListener("online", () => { if (!perfil) iniciarGis(); });

  if (!perfil) iniciarGis();
})(window);
