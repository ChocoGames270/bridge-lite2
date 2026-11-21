/* AI Bridge Lite - Configuración, enfoques, prompt base y chats
   Todo vive en localStorage (con respaldo en memoria). Expone window.AIBridgeOnboarding. */
(function (global) {
  "use strict";

  const KEY = "aibl_config_v1";        // misma clave: conserva las API Keys ya guardadas
  const KEY_CHATS = "aibl_chats_v1";
  const MIN_KEY = 10;
  const OTRO = "__otro__";

  const MAX_IMAGENES = 40;
  const MAX_PROMPT = 8000;
  const MAX_SNIPPET = 20000;
  const MAX_ARCHIVOS_TXT = 60000;
  const MAX_EXTRA = 600;
  const MAX_HISTORIAL = 12;
  const MAX_CHATS = 60;
  const MAX_MENSAJES = 200;
  const TITULO_NUEVO = "Chat nuevo";

  const IDIOMAS = ["es", "en", "pt"];
  const IDIOMA_IA = { es: "español", en: "inglés", pt: "portugués" };
  const PROVEEDORES = ["gemini", "claude", "openai"];
  const NOMBRES = { gemini: "Gemini", claude: "Claude", openai: "OpenAI" };
  const ENFOQUES = ["mecanicas", "balanceo", "lore", "retos"];
  const TIPOS_ADJ = ["imagen", "archivo", "codigo"];

  /* ================= CONCIENCIA BASE (System Prompt) ================= */
  const BASE =
    "Eres AI Bridge Lite, un copiloto para gamers y creadores de videojuegos. " +
    "Ayudas con partidas, estrategias, diseño de juegos, mecánicas, balanceo, lore e ítems. " +
    "Sé claro, creativo y conciso; da pasos y ejemplos concretos. " +
    "Si faltan datos, haz suposiciones razonables y dilas en una línea. " +
    "Si el usuario comparte código, capturas o archivos, úsalos. " +
    "Entrega el código dentro de bloques ``` indicando el lenguaje.";

  const ENFOQUE_TXT = {
    mecanicas:
      "Enfoque: Mecánicas y Sistemas. Estructura las ideas como: objetivo, reglas, entradas y salidas, " +
      "bucle de juego, casos límite y riesgos de abuso. Usa listas cortas.",
    balanceo:
      "Enfoque: Balanceo y Progresión. Propón tablas de stats, costos, curvas de progresión y fórmulas " +
      "con números concretos; explica cómo probar y ajustar el balance.",
    lore:
      "Enfoque: Lore, Ítems y Mundo. Crea nombres, ítems con descripción y efecto, facciones, lugares " +
      "y trasfondo coherentes con el tono del juego.",
    retos:
      "Enfoque: Retos e Ideas Gamer. Genera retos, modos de partida y desafíos con reglas simples, " +
      "dificultad y recompensa."
  };

  const ENFOQUE_NOMBRE = {
    mecanicas: "Mecánicas y Sistemas",
    balanceo: "Balanceo y Progresión",
    lore: "Lore, Ítems y Mundo",
    retos: "Retos / Ideas Gamer"
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

  /* ================= CONFIGURACIÓN ================= */
  const DEFAULT = {
    version: "2.0",
    completado: false,
    idioma: "es",
    enfoque: "mecanicas",
    extra: "",
    proveedor_activo: "gemini",
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
    if (ENFOQUES.includes(data.enfoque)) cfg.enfoque = data.enfoque;
    cfg.extra = texto(data.extra).slice(0, MAX_EXTRA);
    if (PROVEEDORES.includes(data.proveedor_activo)) cfg.proveedor_activo = data.proveedor_activo;

    PROVEEDORES.forEach((p) => {
      cfg.api_keys[p] = texto(data.api_keys && data.api_keys[p]).trim();
      cfg.modelos_custom[p] = texto(data.modelos_custom && data.modelos_custom[p]).trim();
      const sel = data.modelos && data.modelos[p];
      const valido = sel === OTRO || MODELOS[p].some((m) => m.id === sel);
      cfg.modelos[p] = valido ? sel : DEFAULT.modelos[p];
    });
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
    MIN_KEY, OTRO, IDIOMAS, PROVEEDORES, NOMBRES, ENFOQUES, ENFOQUE_NOMBRE,
    MAX_IMAGENES, MAX_PROMPT, MAX_SNIPPET, MAX_EXTRA, TITULO_NUEVO,

    getConfig: () => clone(cfg),
    isDone: () => cfg.completado === true,
    setCompletado(v) { cfg.completado = v === true; return guardar(); },

    // ----- Idioma, enfoque e instrucciones extra -----
    setIdioma(id) {
      if (!IDIOMAS.includes(id)) return false;
      cfg.idioma = id;
      return guardar();
    },
    getEnfoque: () => cfg.enfoque,
    setEnfoque(e) {
      if (!ENFOQUES.includes(e)) return false;
      cfg.enfoque = e;
      return guardar();
    },
    getExtra: () => cfg.extra,
    setExtra(t) {
      cfg.extra = texto(t).slice(0, MAX_EXTRA);
      return guardar();
    },

    // System Prompt final: conciencia base + enfoque + idioma + extra del usuario.
    buildSystem() {
      let s = BASE + " " + ENFOQUE_TXT[cfg.enfoque];
      s += ` Responde en ${IDIOMA_IA[cfg.idioma] || "español"}.`;
      const extra = cfg.extra.trim();
      if (extra) s += ` Contexto del usuario: ${extra}`;
      return s;
    },

    // Resumen de la configuración para copiar (NUNCA incluye la API Key).
    configATexto() {
      const p = cfg.proveedor_activo;
      return [
        "AI Bridge Lite · configuración",
        "Proveedor: " + NOMBRES[p],
        "Modelo: " + (API.getModeloId(p) || "sin modelo"),
        "Enfoque: " + ENFOQUE_NOMBRE[cfg.enfoque],
        "Idioma: " + (IDIOMA_IA[cfg.idioma] || "español"),
        "Instrucciones extra: " + (cfg.extra.trim() || "ninguna"),
        "",
        "System Prompt:",
        API.buildSystem()
      ].join("\n");
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

    // ----- API Keys (solo en este navegador) -----
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

    limiteImagenes: () => MAX_IMAGENES,

    // { ok:true } o { ok:false, motivo:"sin_key" | "sin_modelo" }
    listoParaEnviar() {
      const p = cfg.proveedor_activo;
      if (!API.tieneKey(p)) return { ok: false, motivo: "sin_key" };
      if (!API.getModeloId(p)) return { ok: false, motivo: "sin_modelo" };
      return { ok: true };
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
    // Texto plano del chat para copiar o compartir.
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
    },
    // Borra configuración, keys y todos los chats.
    resetTodo() {
      API.reset();
      try { global.localStorage.removeItem(KEY_CHATS); } catch (_) {}
      memoriaChats = null;
      chatsData = normalizarChats(null);
    },

    /* Payload para la IA. Devuelve null si no está listo (usa listoParaEnviar() para el motivo).
       datos: { prompt_intencion, script_snippet, archivos:[{nombre,texto}],
                imagenes:[base64], historial:[{rol,texto}] } */
    buildPayload(datos) {
      const d = datos || {};
      if (!API.listoParaEnviar().ok) return null;

      const prov = cfg.proveedor_activo;
      const p = {
        version: "2.0",
        proveedor: prov,
        enfoque: cfg.enfoque,
        prompt_intencion: texto(d.prompt_intencion).slice(0, MAX_PROMPT),
        api_key_usuario: cfg.api_keys[prov]
      };

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

      if (Array.isArray(d.imagenes) && d.imagenes.length) {
        p.imagenes = d.imagenes.slice(0, MAX_IMAGENES);
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
