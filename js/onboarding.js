/* AI Bridge Lite - Configuración, cuota, planes y chats (Repo 2)
   Todo vive en localStorage (con respaldo en memoria). Expone window.AIBridgeOnboarding. */
(function (global) {
  "use strict";

  const KEY = "aibl_config_v1";
  const KEY_CHATS = "aibl_chats_v1";
  const MIN_KEY = 10;
  const OTRO = "__otro__";

  // Límites (sin tope rígido de 5 imágenes; ajusta MAX_IMAGENES si algún proveedor se queja)
  const MAX_IMAGENES = 40;
  const MAX_PROMPT = 8000;
  const MAX_SNIPPET = 20000;
  const MAX_ARCHIVOS_TXT = 60000;
  const MAX_HISTORIAL = 12;
  const MAX_CHATS = 60;
  const MAX_MENSAJES = 200;
  const TITULO_NUEVO = "Chat nuevo";

  const IDIOMAS = ["es", "en", "pt"];
  const AREAS = ["scripts", "3d", "vfx", "aprendiz"];
  const PROVEEDORES = ["gemini", "claude", "openai"];
  const PERFILES = ["visual", "script", "hibrido", "optimizacion"];
  const MODOS = ["nativa", "byok"];
  const MODOS_CAPTURA = ["captura", "multi"];
  const TIPOS_ADJ = ["imagen", "archivo", "codigo"];

  // Planes: estructura lista. Los valores son ajustables aquí.
  // OJO: el desbloqueo real de un plan debe verificarse en tu servidor (aquí solo es local).
  const PLANES = {
    gratis: { nombre: "Gratis", mensajes_semana: 60, imagenes_por_mensaje: 3, multimedia: false },
    aporte: { nombre: "Aportación", mensajes_semana: 250, imagenes_por_mensaje: 10, multimedia: true },
    pro: { nombre: "Pro", mensajes_semana: 1000, imagenes_por_mensaje: 40, multimedia: true }
  };

  // Revisa estos nombres en la consola de cada proveedor; si alguno falla, usa "Otro".
  const MODELOS = {
    gemini: [
      { id: "gemini-3.5-flash", nombre: "Gemini 3.5 Flash" },
      { id: "gemini-3.1-flash-lite", nombre: "Gemini 3.1 Flash-Lite" },
      { id: "gemini-3.1-pro-preview", nombre: "Gemini 3.1 Pro (preview)" }
    ],
    claude: [
      { id: "claude-sonnet-5-5", nombre: "Claude Sonnet 5.5" },
      { id: "claude-haiku-5-5", nombre: "Claude Haiku 5.5" },
      { id: "claude-opus-5-5", nombre: "Claude Opus 5.5" }
    ],
    openai: [
      { id: "gpt-5.4-mini", nombre: "GPT-5.4 mini" },
      { id: "gpt-5.6-luna", nombre: "GPT-5.6 Luna" },
      { id: "gpt-5.6-sol", nombre: "GPT-5.6 Sol" }
    ]
  };

  /* ================= UTILIDADES ================= */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const texto = (v) => (typeof v === "string" ? v : "");
  const nuevoId = () =>
    (global.crypto && global.crypto.randomUUID)
      ? global.crypto.randomUUID()
      : "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const porProveedor = (valor) => {
    const o = {};
    PROVEEDORES.forEach((p) => { o[p] = valor(p); });
    return o;
  };

  // Lunes (00:00 local) de la semana de la fecha dada.
  function lunesActual() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  const aISO = (d) =>
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  /* ================= CONFIGURACIÓN ================= */
  const DEFAULT = {
    version: "1.1",
    completado: false,
    idioma: "es",
    areas: [],
    proveedor_activo: "gemini",
    perfil: "hibrido",
    modo: "nativa",              // "nativa" (IA propia con límite semanal) | "byok" (API Key propia)
    modo_captura: "captura",     // "captura" (toma única) | "multi" (ráfaga)
    plan: "gratis",
    aportes_usd: 0,
    uso: { semana: "", mensajes: 0 },
    cuenta: null,                // { nombre, email, foto } de Google (sin tokens)
    api_keys: porProveedor(() => ""),
    modelos: porProveedor((p) => MODELOS[p][0].id),
    modelos_custom: porProveedor(() => "")
  };

  // Valida y completa lo guardado (evita errores si el JSON está viejo o alterado).
  function normalizar(data) {
    const cfg = clone(DEFAULT);
    if (!data || typeof data !== "object") return cfg;

    cfg.completado = data.completado === true;
    if (IDIOMAS.includes(data.idioma)) cfg.idioma = data.idioma;
    if (Array.isArray(data.areas)) cfg.areas = data.areas.filter((a, i, arr) => AREAS.includes(a) && arr.indexOf(a) === i);
    if (PROVEEDORES.includes(data.proveedor_activo)) cfg.proveedor_activo = data.proveedor_activo;
    if (PERFILES.includes(data.perfil)) cfg.perfil = data.perfil;
    if (MODOS_CAPTURA.includes(data.modo_captura)) cfg.modo_captura = data.modo_captura;

    PROVEEDORES.forEach((p) => {
      cfg.api_keys[p] = texto(data.api_keys && data.api_keys[p]).trim();
      cfg.modelos_custom[p] = texto(data.modelos_custom && data.modelos_custom[p]).trim();
      const sel = data.modelos && data.modelos[p];
      const valido = sel === OTRO || MODELOS[p].some((m) => m.id === sel);
      cfg.modelos[p] = valido ? sel : DEFAULT.modelos[p];
    });

    // Si ya tenía una key guardada (versión anterior), conserva el modo BYOK.
    const hayKey = PROVEEDORES.some((p) => cfg.api_keys[p].length >= MIN_KEY);
    cfg.modo = MODOS.includes(data.modo) ? data.modo : (hayKey ? "byok" : "nativa");

    cfg.plan = PLANES[data.plan] ? data.plan : "gratis";
    cfg.aportes_usd = Number.isFinite(data.aportes_usd) ? Math.min(100, Math.max(0, data.aportes_usd)) : 0;

    if (data.uso && typeof data.uso === "object") {
      cfg.uso.semana = texto(data.uso.semana).slice(0, 10);
      cfg.uso.mensajes = Number.isInteger(data.uso.mensajes) && data.uso.mensajes >= 0 ? data.uso.mensajes : 0;
    }

    const c = data.cuenta;
    if (c && typeof c === "object") {
      const nombre = texto(c.nombre).slice(0, 80);
      const email = texto(c.email).slice(0, 120);
      const foto = texto(c.foto).startsWith("https://") ? texto(c.foto).slice(0, 500) : "";
      if (nombre || email) cfg.cuenta = { nombre, email, foto };
    }
    return cfg;
  }

  let memoria = null; // respaldo si localStorage no está disponible (modo privado)

  function cargar() {
    try {
      const raw = global.localStorage.getItem(KEY);
      return normalizar(raw ? JSON.parse(raw) : null);
    } catch (_) {
      return normalizar(memoria);
    }
  }

  let cfg = cargar();

  function guardar() {
    memoria = clone(cfg);
    try {
      global.localStorage.setItem(KEY, JSON.stringify(cfg));
      return true;
    } catch (_) {
      return false; // la app sigue funcionando en memoria hasta cerrar la pestaña
    }
  }

  // Reinicia el contador al empezar una semana nueva (lunes).
  function rotarSemana() {
    const hoy = aISO(lunesActual());
    if (cfg.uso.semana !== hoy) {
      cfg.uso.semana = hoy;
      cfg.uso.mensajes = 0;
      guardar();
    }
  }
  rotarSemana();

  // Quita espacios, saltos de línea y comillas que se cuelan al copiar/pegar.
  const limpiarKey = (v) => texto(v).replace(/\s+/g, "").replace(/^["']+|["']+$/g, "");
  const provValido = (p) => PROVEEDORES.includes(p);

  /* ================= CHATS ================= */
  let chatsData = null;
  let memoriaChats = null;

  function normalizarAdjunto(a) {
    if (!a || typeof a !== "object" || !TIPOS_ADJ.includes(a.tipo)) return null;
    const o = { tipo: a.tipo, nombre: texto(a.nombre).slice(0, 100) };
    if (a.tipo === "imagen" && texto(a.mini).startsWith("data:image/")) o.mini = a.mini;
    return o;
  }

  function normalizarMensaje(m) {
    if (!m || typeof m !== "object") return null;
    return {
      id: texto(m.id) || nuevoId(),
      rol: m.rol === "ia" ? "ia" : "usuario",
      texto: texto(m.texto),
      adjuntos: Array.isArray(m.adjuntos) ? m.adjuntos.map(normalizarAdjunto).filter(Boolean).slice(0, 60) : [],
      voto: m.voto === "like" || m.voto === "dislike" ? m.voto : null,
      error: m.error === true,
      ts: Number.isFinite(m.ts) ? m.ts : Date.now()
    };
  }

  function normalizarChats(raw) {
    const d = { activo: null, chats: [] };
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.chats)) return d;
    raw.chats.forEach((c) => {
      if (!c || typeof c !== "object") return;
      const id = texto(c.id);
      if (!id || d.chats.some((x) => x.id === id)) return;
      d.chats.push({
        id,
        titulo: texto(c.titulo).slice(0, 80) || TITULO_NUEVO,
        fijado: c.fijado === true,
        creado: Number.isFinite(c.creado) ? c.creado : Date.now(),
        actualizado: Number.isFinite(c.actualizado) ? c.actualizado : Date.now(),
        mensajes: Array.isArray(c.mensajes) ? c.mensajes.map(normalizarMensaje).filter(Boolean).slice(-MAX_MENSAJES) : []
      });
    });
    if (d.chats.some((c) => c.id === raw.activo)) d.activo = raw.activo;
    return d;
  }

  function cargarChats() {
    if (chatsData) return chatsData;
    let raw = null;
    try {
      raw = JSON.parse(global.localStorage.getItem(KEY_CHATS));
    } catch (_) {
      raw = memoriaChats ? clone(memoriaChats) : null;
    }
    chatsData = normalizarChats(raw);
    return chatsData;
  }

  // Chat más antiguo que se puede borrar (ni fijado ni activo). -1 si no hay.
  function indiceBorrable(d) {
    let idx = -1;
    d.chats.forEach((c, i) => {
      if (c.fijado || c.id === d.activo) return;
      if (idx === -1 || c.actualizado < d.chats[idx].actualizado) idx = i;
    });
    return idx;
  }

  function recortar(d) {
    while (d.chats.length > MAX_CHATS) {
      const i = indiceBorrable(d);
      if (i === -1) break;
      d.chats.splice(i, 1);
    }
  }

  const quitarMiniaturas = (chats) =>
    chats.forEach((c) => c.mensajes.forEach((m) => m.adjuntos.forEach((a) => { delete a.mini; })));

  // Si el almacenamiento se llena: 1) quita miniaturas de chats viejos, 2) todas, 3) borra chats antiguos.
  function guardarChats() {
    const d = cargarChats();
    memoriaChats = clone(d);
    const intentar = () => {
      try { global.localStorage.setItem(KEY_CHATS, JSON.stringify(d)); return true; } catch (_) { return false; }
    };
    if (intentar()) return true;

    quitarMiniaturas(d.chats.filter((c) => c.id !== d.activo));
    if (intentar()) return true;

    quitarMiniaturas(d.chats);
    if (intentar()) return true;

    for (;;) {
      const i = indiceBorrable(d);
      if (i === -1) break;
      d.chats.splice(i, 1);
      if (intentar()) return true;
    }
    return false;
  }

  const buscarChat = (id) => cargarChats().chats.find((c) => c.id === id) || null;

  function tituloDesde(t, adjuntos) {
    const limpio = texto(t).replace(/\s+/g, " ").trim();
    if (limpio) return limpio.length > 40 ? limpio.slice(0, 40).trim() + "…" : limpio;
    const a = adjuntos && adjuntos[0];
    return a ? (a.nombre || "Adjuntos") : TITULO_NUEVO;
  }

  /* ================= API PÚBLICA ================= */
  const API = {
    MIN_KEY, OTRO, IDIOMAS, AREAS, PROVEEDORES, PERFILES, MODOS, MODOS_CAPTURA,
    MAX_IMAGENES, MAX_PROMPT, MAX_SNIPPET, TITULO_NUEVO,

    getConfig: () => clone(cfg),
    isDone: () => cfg.completado === true,
    setCompletado(v) { cfg.completado = v === true; return guardar(); },

    // ----- Idioma, áreas y perfil -----
    setIdioma(id) {
      if (!IDIOMAS.includes(id)) return false;
      cfg.idioma = id;
      return guardar();
    },
    toggleArea(area) {
      if (!AREAS.includes(area)) return false;
      const i = cfg.areas.indexOf(area);
      if (i === -1) cfg.areas.push(area); else cfg.areas.splice(i, 1);
      return guardar();
    },
    setPerfil(p) {
      if (!PERFILES.includes(p)) return false;
      cfg.perfil = p;
      return guardar();
    },

    // ----- Motor (IA nativa / BYOK) y modo de captura del botón "AI" -----
    getModo: () => cfg.modo,
    setModo(m) {
      if (!MODOS.includes(m)) return false;
      cfg.modo = m;
      return guardar();
    },
    getModoCaptura: () => cfg.modo_captura,
    setModoCaptura(m) {
      if (!MODOS_CAPTURA.includes(m)) return false;
      cfg.modo_captura = m;
      return guardar();
    },

    // ----- Proveedor y modelo -----
    setProveedorActivo(p) {
      if (!provValido(p)) return false;
      cfg.proveedor_activo = p;
      return guardar();
    },
    listarModelos: (p) => (provValido(p) ? MODELOS[p].slice() : []),
    getModeloSel: (p) => (provValido(p) ? cfg.modelos[p] : ""),
    getModeloCustom: (p) => (provValido(p) ? cfg.modelos_custom[p] : ""),
    setModelo(p, valor) {
      if (!provValido(p)) return false;
      if (valor !== OTRO && !MODELOS[p].some((m) => m.id === valor)) return false;
      cfg.modelos[p] = valor;
      return guardar();
    },
    setModeloCustom(p, valor) {
      if (!provValido(p)) return false;
      cfg.modelos_custom[p] = texto(valor).trim().slice(0, 100);
      return guardar();
    },
    // Nombre real que se envía a la API ("" si eligió "Otro" y no escribió nada).
    getModeloId(p) {
      if (!provValido(p)) return "";
      return cfg.modelos[p] === OTRO ? cfg.modelos_custom[p] : cfg.modelos[p];
    },

    // ----- API Keys (BYOK) -----
    setKey(p, valor) {
      if (!provValido(p)) return false;
      cfg.api_keys[p] = limpiarKey(valor);
      return guardar();
    },
    getKey: (p) => (provValido(p) ? cfg.api_keys[p] : ""),
    tieneKey(p) {
      const prov = p || cfg.proveedor_activo;
      return provValido(prov) && cfg.api_keys[prov].length >= MIN_KEY;
    },

    // ----- Planes, aportes y cuota semanal de la IA nativa -----
    listarPlanes: () => clone(PLANES),
    getPlan() {
      return Object.assign({ id: cfg.plan, aportes_usd: cfg.aportes_usd }, PLANES[cfg.plan]);
    },
    // Estructura lista; el desbloqueo real debe confirmarlo tu servidor.
    setPlan(id, aportesUsd) {
      if (!PLANES[id]) return false;
      cfg.plan = id;
      if (Number.isFinite(aportesUsd)) cfg.aportes_usd = Math.min(100, Math.max(0, aportesUsd));
      return guardar();
    },
    usoSemanal() {
      rotarSemana();
      const limite = PLANES[cfg.plan].mensajes_semana;
      const usados = cfg.uso.mensajes;
      const sig = lunesActual();
      sig.setDate(sig.getDate() + 7);
      return {
        plan: cfg.plan,
        usados,
        limite,
        restantes: Math.max(0, limite - usados),
        porcentaje: Math.min(100, Math.round((usados / limite) * 100)),
        reinicia: aISO(sig)
      };
    },
    puedeUsarNativa: () => API.usoSemanal().restantes > 0,
    registrarUsoNativa(n) {
      rotarSemana();
      cfg.uso.mensajes += n > 0 ? Math.floor(n) : 1;
      return guardar();
    },
    // Si la petición falla, devuelve el mensaje descontado.
    devolverUsoNativa(n) {
      cfg.uso.mensajes = Math.max(0, cfg.uso.mensajes - (n > 0 ? Math.floor(n) : 1));
      return guardar();
    },
    // Máximo de imágenes por mensaje según el motor activo.
    limiteImagenes() {
      return cfg.modo === "byok" ? MAX_IMAGENES : Math.min(MAX_IMAGENES, PLANES[cfg.plan].imagenes_por_mensaje);
    },

    // { ok:true } o { ok:false, motivo:"limite" | "sin_key" | "sin_modelo" }
    listoParaEnviar() {
      if (cfg.modo === "nativa") return API.puedeUsarNativa() ? { ok: true } : { ok: false, motivo: "limite" };
      const p = cfg.proveedor_activo;
      if (!API.tieneKey(p)) return { ok: false, motivo: "sin_key" };
      if (!API.getModeloId(p)) return { ok: false, motivo: "sin_modelo" };
      return { ok: true };
    },

    // ----- Cuenta de Google (solo datos de perfil, nunca tokens) -----
    getCuenta: () => (cfg.cuenta ? clone(cfg.cuenta) : null),
    setCuenta(datos) {
      const c = normalizar({ cuenta: datos }).cuenta;
      if (!c) return false;
      cfg.cuenta = c;
      return guardar();
    },
    cerrarSesion() {
      cfg.cuenta = null;
      return guardar();
    },

    /* ----- Chats ----- */
    listarChats() {
      return cargarChats().chats
        .slice()
        .sort((a, b) => (Number(b.fijado) - Number(a.fijado)) || (b.actualizado - a.actualizado))
        .map((c) => ({ id: c.id, titulo: c.titulo, fijado: c.fijado, actualizado: c.actualizado, total: c.mensajes.length }));
    },
    getChatActivoId() {
      const d = cargarChats();
      return d.chats.some((c) => c.id === d.activo) ? d.activo : null;
    },
    setChatActivo(id) {
      const d = cargarChats();
      if (!buscarChat(id)) return false;
      d.activo = id;
      return guardarChats();
    },
    // Si el chat activo está vacío lo reutiliza (evita chats vacíos repetidos).
    crearChat() {
      const d = cargarChats();
      const act = buscarChat(d.activo);
      if (act && act.mensajes.length === 0) return act.id;
      const c = {
        id: nuevoId(), titulo: TITULO_NUEVO, fijado: false,
        creado: Date.now(), actualizado: Date.now(), mensajes: []
      };
      d.chats.push(c);
      d.activo = c.id;
      recortar(d);
      guardarChats();
      return c.id;
    },
    getChat(id) {
      const c = buscarChat(id);
      return c ? clone(c) : null;
    },
    agregarMensaje(chatId, datos) {
      const c = buscarChat(chatId);
      if (!c) return null;
      const m = normalizarMensaje(Object.assign({}, datos, { id: nuevoId(), ts: Date.now() }));
      if (!m) return null;
      c.mensajes.push(m);
      if (c.mensajes.length > MAX_MENSAJES) c.mensajes.splice(0, c.mensajes.length - MAX_MENSAJES);
      if (m.rol === "usuario" && c.titulo === TITULO_NUEVO) c.titulo = tituloDesde(m.texto, m.adjuntos);
      c.actualizado = Date.now();
      guardarChats();
      return clone(m);
    },
    // cambios permitidos: texto, voto, error, adjuntos
    actualizarMensaje(chatId, msgId, cambios) {
      const c = buscarChat(chatId);
      const m = c && c.mensajes.find((x) => x.id === msgId);
      if (!m || !cambios) return false;
      if (typeof cambios.texto === "string") m.texto = cambios.texto;
      if ("voto" in cambios) m.voto = cambios.voto === "like" || cambios.voto === "dislike" ? cambios.voto : null;
      if (typeof cambios.error === "boolean") m.error = cambios.error;
      if (Array.isArray(cambios.adjuntos)) m.adjuntos = cambios.adjuntos.map(normalizarAdjunto).filter(Boolean).slice(0, 60);
      c.actualizado = Date.now();
      return guardarChats();
    },
    borrarMensaje(chatId, msgId) {
      const c = buscarChat(chatId);
      if (!c) return false;
      const i = c.mensajes.findIndex((x) => x.id === msgId);
      if (i === -1) return false;
      c.mensajes.splice(i, 1);
      return guardarChats();
    },
    renombrarChat(id, titulo) {
      const c = buscarChat(id);
      const t = texto(titulo).trim().slice(0, 80);
      if (!c || !t) return false;
      c.titulo = t;
      return guardarChats();
    },
    esFijado: (id) => { const c = buscarChat(id); return !!(c && c.fijado); },
    setFijado(id, valor) {
      const c = buscarChat(id);
      if (!c) return false;
      c.fijado = valor === true;
      return guardarChats();
    },
    borrarChat(id) {
      const d = cargarChats();
      const i = d.chats.findIndex((c) => c.id === id);
      if (i === -1) return false;
      d.chats.splice(i, 1);
      if (d.activo === id) d.activo = null;
      return guardarChats();
    },
    borrarTodosChats() {
      const d = cargarChats();
      d.chats = [];
      d.activo = null;
      return guardarChats();
    },
    // Texto plano del chat para compartir.
    chatATexto(id) {
      const c = buscarChat(id);
      if (!c) return "";
      const lineas = [c.titulo, ""];
      c.mensajes.forEach((m) => {
        lineas.push((m.rol === "ia" ? "IA: " : "Yo: ") + m.texto, "");
      });
      return lineas.join("\n").trim();
    },

    // Borra solo la configuración (no los chats).
    reset() {
      try { global.localStorage.removeItem(KEY); } catch (_) {}
      memoria = null;
      cfg = normalizar(null);
      rotarSemana();
    },
    // Borra configuración, keys y todos los chats.
    resetTodo() {
      API.reset();
      try { global.localStorage.removeItem(KEY_CHATS); } catch (_) {}
      memoriaChats = null;
      chatsData = normalizarChats(null);
    },

    /* Payload según el motor activo. Devuelve null si no está listo para enviar
       (usa listoParaEnviar() para conocer el motivo).
       datos: { perfil_seleccionado, prompt_intencion, script_snippet, archivos:[{nombre,texto}],
                objeto_properties, modo_secuencia_frames:[base64], historial:[{rol,texto}] } */
    buildPayload(datos) {
      const d = datos || {};
      if (!API.listoParaEnviar().ok) return null;

      const nativa = cfg.modo === "nativa";
      const prov = cfg.proveedor_activo;

      const p = {
        version: "1.1",
        modo: cfg.modo,
        proveedor: nativa ? "nativa" : prov,
        perfil_seleccionado: PERFILES.includes(d.perfil_seleccionado) ? d.perfil_seleccionado : cfg.perfil,
        prompt_intencion: texto(d.prompt_intencion).slice(0, MAX_PROMPT)
      };
      if (!nativa) p.api_key_usuario = cfg.api_keys[prov];

      const snippet = texto(d.script_snippet);
      if (snippet) p.script_snippet = snippet.slice(0, MAX_SNIPPET);

      if (Array.isArray(d.archivos) && d.archivos.length) {
        let libre = MAX_ARCHIVOS_TXT;
        const lista = [];
        for (const a of d.archivos) {
          if (libre <= 0) break;
          if (!a || typeof a !== "object") continue;
          const t = texto(a.texto).slice(0, libre);
          if (!t) continue;
          lista.push({ nombre: texto(a.nombre).slice(0, 100), texto: t });
          libre -= t.length;
        }
        if (lista.length) p.archivos = lista;
      }

      if (d.objeto_properties && typeof d.objeto_properties === "object") {
        p.objeto_properties = d.objeto_properties;
      }
      if (Array.isArray(d.modo_secuencia_frames) && d.modo_secuencia_frames.length) {
        p.modo_secuencia_frames = d.modo_secuencia_frames.slice(0, API.limiteImagenes());
      }
      if (Array.isArray(d.historial) && d.historial.length) {
        p.historial = d.historial
          .filter((h) => h && (h.rol === "ia" || h.rol === "usuario") && texto(h.texto))
          .slice(-MAX_HISTORIAL)
          .map((h) => ({ rol: h.rol, texto: texto(h.texto).slice(0, 4000) }));
      }
      return p;
    }
  };

  global.AIBridgeOnboarding = API;
})(window);
