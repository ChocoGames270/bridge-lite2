/* AI Bridge Lite - Configuración, enfoques, prompt base, chats y exportador de conciencia
   Todo vive en localStorage (con respaldo en memoria). Expone window.AIBridgeOnboarding. */
(function (global) {
  "use strict";

  const KEY = "aibl_config_v1";        // misma clave: conserva las API Keys ya guardadas
  const KEY_CHATS = "aibl_chats_v1";
  const KEY_EXPORT = "aibl_export_v1"; // cupo de exportaciones (no se borra con reset)
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

  const EXPORT_BASE = 5;                       // exportaciones gratis por semana
  const EXPORT_EXTRAS_MAX = 3;                 // extras por video, máximo por ciclo
  const CICLO_MS = 7 * 24 * 60 * 60 * 1000;    // 7 días
  const DIA_MS = 24 * 60 * 60 * 1000;
  const VERSION_CONCIENCIA = "1.0";

  const F = "\x60\x60\x60"; // tres comillas invertidas (bloque de código)

  const IDIOMAS = ["es", "en", "pt"];
  const IDIOMA_IA = { es: "español", en: "inglés", pt: "portugués" };
  const PROVEEDORES = ["gemini", "claude", "openai"];
  const NOMBRES = { gemini: "Gemini", claude: "Claude", openai: "OpenAI" };
  const ENFOQUES = ["mecanicas", "balanceo", "lore", "retos"];
  const TIPOS_ADJ = ["imagen", "archivo", "codigo"];
  const VOTOS = ["like", "dislike"];
  const ROLES_HIST = ["ia", "usuario"];

  /* ================= CONCIENCIA BASE (System Prompt) ================= */
  const BASE =
    "Eres AI Bridge Lite, un copiloto para gamers y creadores de videojuegos. " +
    "Ayudas con partidas, estrategias, diseño de juegos, mecánicas, balanceo, lore e ítems. " +
    "Sé claro, creativo y conciso; da pasos y ejemplos concretos. " +
    "Si faltan datos, haz suposiciones razonables y dilas en una línea. " +
    "Si el usuario comparte código, capturas o archivos, úsalos. " +
    "Entrega el código dentro de bloques " + F + " indicando el lenguaje.";

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
  const valor = (v, defecto) => (v ? v : defecto);
  const esObjeto = (v) => (v !== null && typeof v === "object");
  const entero = (v, min, max) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : min);
  const nuevoId = () =>
    (global.crypto && global.crypto.randomUUID)
      ? global.crypto.randomUUID()
      : "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const porProveedor = (fn) => {
    const o = {};
    PROVEEDORES.forEach((p) => { o[p] = fn(p); });
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
    if (!esObjeto(data)) return cfg;

    cfg.completado = data.completado === true;
    if (IDIOMAS.includes(data.idioma)) cfg.idioma = data.idioma;
    if (ENFOQUES.includes(data.enfoque)) cfg.enfoque = data.enfoque;
    cfg.extra = texto(data.extra).slice(0, MAX_EXTRA);
    if (PROVEEDORES.includes(data.proveedor_activo)) cfg.proveedor_activo = data.proveedor_activo;

    PROVEEDORES.forEach((p) => {
      cfg.api_keys[p] = texto(data.api_keys && data.api_keys[p]).trim();
      cfg.modelos_custom[p] = texto(data.modelos_custom && data.modelos_custom[p]).trim();
      const sel = data.modelos ? data.modelos[p] : undefined;
      let valido = sel === OTRO;
      if (!valido) valido = MODELOS[p].some((m) => m.id === sel);
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
  const limpiarKey = (v) =>
    texto(v).replace(/\s+/g, "").replace(/^["']+/, "").replace(/["']+$/, "");
  const provValido = (p) => PROVEEDORES.includes(p);

  /* ================= CUPO DE EXPORTACIONES ================= */
  // Estado: inicio del ciclo semanal, base usada, extras ganados/usados y supporter.
  let expo = null;
  let memoriaExpo = null;

  function nuevoExpo(ahora) {
    return { ciclo_inicio: ahora, base_usadas: 0, extras_ganados: 0, extras_usados: 0, supporter: false };
  }

  function normalizarExpo(d) {
    const ahora = Date.now();
    const e = nuevoExpo(ahora);
    if (!esObjeto(d)) return e;
    e.ciclo_inicio = Number.isFinite(d.ciclo_inicio) ? d.ciclo_inicio : ahora;
    e.base_usadas = entero(d.base_usadas, 0, EXPORT_BASE);
    e.extras_ganados = entero(d.extras_ganados, 0, EXPORT_EXTRAS_MAX);
    e.extras_usados = entero(d.extras_usados, 0, e.extras_ganados);
    e.supporter = d.supporter === true;
    return e;
  }

  function guardarExpo() {
    memoriaExpo = clone(expo);
    try {
      global.localStorage.setItem(KEY_EXPORT, JSON.stringify(expo));
      return true;
    } catch (_) {
      return false;
    }
  }

  // Reinicio automático a los 7 días. Si el reloj se atrasó, solo reajusta el inicio.
  function refrescarCiclo(e) {
    const ahora = Date.now();
    if (e.ciclo_inicio > ahora) {
      e.ciclo_inicio = ahora;
      guardarExpo();
      return;
    }
    if (ahora - e.ciclo_inicio >= CICLO_MS) {
      e.ciclo_inicio = ahora;
      e.base_usadas = 0;
      e.extras_ganados = 0;
      e.extras_usados = 0;
      guardarExpo();
    }
  }

  function estadoExpo() {
    if (!expo) {
      let raw = null;
      try {
        raw = JSON.parse(global.localStorage.getItem(KEY_EXPORT));
      } catch (_) {
        raw = memoriaExpo ? clone(memoriaExpo) : null;
      }
      expo = normalizarExpo(raw);
      if (!esObjeto(raw)) guardarExpo(); // primer uso: fija el inicio del ciclo
    }
    refrescarCiclo(expo);
    return expo;
  }

  /* ================= CHATS ================= */
  let chatsData = null;
  let memoriaChats = null;

  function normalizarAdjunto(a) {
    if (!esObjeto(a)) return null;
    if (!TIPOS_ADJ.includes(a.tipo)) return null;
    const o = { tipo: a.tipo, nombre: texto(a.nombre).slice(0, 100) };
    if (a.tipo === "imagen" && texto(a.mini).startsWith("data:image/")) o.mini = a.mini;
    return o;
  }

  function normalizarMensaje(m) {
    if (!esObjeto(m)) return null;
    return {
      id: valor(texto(m.id), nuevoId()),
      rol: m.rol === "ia" ? "ia" : "usuario",
      texto: texto(m.texto),
      adjuntos: Array.isArray(m.adjuntos) ? m.adjuntos.map(normalizarAdjunto).filter(Boolean).slice(0, 60) : [],
      voto: VOTOS.includes(m.voto) ? m.voto : null,
      error: m.error === true,
      ts: Number.isFinite(m.ts) ? m.ts : Date.now()
    };
  }

  function normalizarChats(raw) {
    const d = { activo: null, chats: [] };
    if (!esObjeto(raw)) return d;
    if (!Array.isArray(raw.chats)) return d;
    raw.chats.forEach((c) => {
      if (!esObjeto(c)) return;
      const id = texto(c.id);
      if (!id) return;
      if (d.chats.some((x) => x.id === id)) return;
      d.chats.push({
        id,
        titulo: valor(texto(c.titulo).slice(0, 80), TITULO_NUEVO),
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
      if (c.fijado) return;
      if (c.id === d.activo) return;
      if (idx === -1) { idx = i; return; }
      if (c.actualizado < d.chats[idx].actualizado) idx = i;
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

  const buscarChat = (id) => {
    const c = cargarChats().chats.find((x) => x.id === id);
    return c ? c : null;
  };

  function tituloDesde(t, adjuntos) {
    const limpio = texto(t).replace(/\s+/g, " ").trim();
    if (limpio) return limpio.length > 40 ? limpio.slice(0, 40).trim() + "…" : limpio;
    const a = adjuntos ? adjuntos[0] : null;
    return a ? valor(a.nombre, "Adjuntos") : TITULO_NUEVO;
  }

  function ordenarChats(a, b) {
    const dif = Number(b.fijado) - Number(a.fijado);
    return dif !== 0 ? dif : b.actualizado - a.actualizado;
  }

  /* ================= API PÚBLICA ================= */
  const API = {
    MIN_KEY, OTRO, IDIOMAS, PROVEEDORES, NOMBRES, ENFOQUES, ENFOQUE_NOMBRE,
    MAX_IMAGENES, MAX_PROMPT, MAX_SNIPPET, MAX_EXTRA, TITULO_NUEVO,
    EXPORT_BASE, EXPORT_EXTRAS_MAX,

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
      s += " Responde en " + valor(IDIOMA_IA[cfg.idioma], "español") + ".";
      const extra = cfg.extra.trim();
      if (extra) s += " Contexto del usuario: " + extra;
      return s;
    },

    // Resumen de la configuración para copiar (NUNCA incluye la API Key).
    configATexto() {
      const p = cfg.proveedor_activo;
      return [
        "AI Bridge Lite · configuración",
        "Proveedor: " + NOMBRES[p],
        "Modelo: " + valor(API.getModeloId(p), "sin modelo"),
        "Enfoque: " + ENFOQUE_NOMBRE[cfg.enfoque],
        "Idioma: " + valor(IDIOMA_IA[cfg.idioma], "español"),
        "Instrucciones extra: " + valor(cfg.extra.trim(), "ninguna"),
        "",
        "System Prompt:",
        API.buildSystem()
      ].join("\n");
    },

    /* ----- Conciencia exportable (para un juego o un bot). Jamás incluye la API Key. ----- */
    construirConciencia() {
      const p = cfg.proveedor_activo;
      return {
        version: VERSION_CONCIENCIA,
        nombre: "AI Bridge Lite",
        rol: "Copiloto de IA para gamers y creadores de videojuegos",
        proveedor: p,
        modelo: API.getModeloId(p),
        enfoque: cfg.enfoque,
        enfoque_nombre: ENFOQUE_NOMBRE[cfg.enfoque],
        idioma: cfg.idioma,
        instrucciones_extra: cfg.extra.trim(),
        system_prompt: API.buildSystem(),
        generado: new Date().toISOString()
      };
    },
    conscienciaAJSON() {
      return JSON.stringify(API.construirConciencia(), null, 2);
    },
    // Bloque de texto listo para pegar en un bot o en un script de juego.
    conscienciaATexto() {
      const c = API.construirConciencia();
      return [
        c.nombre + " · conciencia exportada (v" + c.version + ")",
        "Rol: " + c.rol,
        "Proveedor: " + NOMBRES[c.proveedor],
        "Modelo: " + valor(c.modelo, "sin modelo"),
        "Enfoque: " + c.enfoque_nombre,
        "Idioma: " + valor(IDIOMA_IA[c.idioma], "español"),
        "Instrucciones extra: " + valor(c.instrucciones_extra, "ninguna"),
        "",
        "System Prompt:",
        c.system_prompt
      ].join("\n");
    },

    /* ----- Cupo de exportaciones ----- */
    // Estado para mostrar en la interfaz. total_disponibles es null si es ilimitado.
    getExportEstado() {
      const e = estadoExpo();
      const baseRest = EXPORT_BASE - e.base_usadas;
      const extrasDisp = e.extras_ganados - e.extras_usados;
      const reinicio = e.ciclo_inicio + CICLO_MS;
      return {
        ilimitado: e.supporter,
        supporter: e.supporter,
        base_total: EXPORT_BASE,
        base_restantes: baseRest,
        extras_max: EXPORT_EXTRAS_MAX,
        extras_ganados: e.extras_ganados,
        extras_disponibles: extrasDisp,
        total_disponibles: e.supporter ? null : baseRest + extrasDisp,
        puede_exportar: e.supporter ? true : baseRest + extrasDisp > 0,
        puede_ver_video: !e.supporter && e.extras_ganados < EXPORT_EXTRAS_MAX,
        reinicio_ts: reinicio,
        dias_para_reinicio: Math.max(0, Math.ceil((reinicio - Date.now()) / DIA_MS))
      };
    },
    // Descuenta 1 exportación (primero la base semanal, luego los extras).
    // Devuelve { ok, fuente: "base" o "extra" o "ilimitado", motivo, estado }.
    consumirExportacion() {
      const e = estadoExpo();
      let fuente = "";
      if (e.supporter) {
        fuente = "ilimitado";
      } else if (e.base_usadas < EXPORT_BASE) {
        e.base_usadas += 1;
        fuente = "base";
      } else if (e.extras_usados < e.extras_ganados) {
        e.extras_usados += 1;
        fuente = "extra";
      } else {
        return { ok: false, motivo: "sin_cupo", estado: API.getExportEstado() };
      }
      if (fuente !== "ilimitado") guardarExpo();
      return { ok: true, fuente, estado: API.getExportEstado() };
    },
    // +1 extra por video opcional visto (máximo +3 por ciclo semanal).
    // Gancho para conectar un proveedor de anuncios: llama aquí al terminar el video.
    sumarExtraPorVideo() {
      const e = estadoExpo();
      if (e.supporter) return { ok: false, motivo: "supporter", estado: API.getExportEstado() };
      if (e.extras_ganados >= EXPORT_EXTRAS_MAX) return { ok: false, motivo: "tope", estado: API.getExportEstado() };
      e.extras_ganados += 1;
      guardarExpo();
      return { ok: true, estado: API.getExportEstado() };
    },
    isSupporter: () => estadoExpo().supporter === true,
    // Para pruebas e integración posterior (compras, código de supporter, etc.).
    setSupporter(v) {
      const e = estadoExpo();
      e.supporter = v === true;
      return guardarExpo();
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
    setModelo(p, v) {
      if (!provValido(p)) return false;
      if (v !== OTRO && !MODELOS[p].some((m) => m.id === v)) return false;
      cfg.modelos[p] = v;
      return guardar();
    },
    setModeloCustom(p, v) {
      if (!provValido(p)) return false;
      cfg.modelos_custom[p] = texto(v).trim().slice(0, 100);
      return guardar();
    },
    // Nombre real que se envía a la API ("" si eligió "Otro" y no escribió nada).
    getModeloId(p) {
      if (!provValido(p)) return "";
      return cfg.modelos[p] === OTRO ? cfg.modelos_custom[p] : cfg.modelos[p];
    },

    // ----- API Keys (solo en este navegador) -----
    setKey(p, v) {
      if (!provValido(p)) return false;
      cfg.api_keys[p] = limpiarKey(v);
      return guardar();
    },
    getKey: (p) => (provValido(p) ? cfg.api_keys[p] : ""),
    tieneKey(p) {
      const prov = p ? p : cfg.proveedor_activo;
      return provValido(prov) && cfg.api_keys[prov].length >= MIN_KEY;
    },

    limiteImagenes: () => MAX_IMAGENES,

    // { ok:true } o { ok:false, motivo:"sin_key" o "sin_modelo" }
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
        .sort(ordenarChats)
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
      const m = c ? c.mensajes.find((x) => x.id === msgId) : null;
      if (!m) return false;
      if (!cambios) return false;
      if (typeof cambios.texto === "string") m.texto = cambios.texto;
      if ("voto" in cambios) m.voto = VOTOS.includes(cambios.voto) ? cambios.voto : null;
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
      if (!c) return false;
      if (!t) return false;
      c.titulo = t;
      return guardarChats();
    },
    esFijado: (id) => { const c = buscarChat(id); return c ? c.fijado === true : false; },
    setFijado(id, v) {
      const c = buscarChat(id);
      if (!c) return false;
      c.fijado = v === true;
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

    // Borra solo la configuración (no los chats ni el cupo de exportaciones).
    reset() {
      try { global.localStorage.removeItem(KEY); } catch (_) {}
      memoria = null;
      cfg = normalizar(null);
    },
    // Borra configuración, keys y todos los chats (el cupo de exportaciones se conserva).
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
      const d = datos ? datos : {};
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
          if (!esObjeto(a)) continue;
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
          .filter((h) => esObjeto(h) && ROLES_HIST.includes(h.rol) && texto(h.texto))
          .slice(-MAX_HISTORIAL)
          .map((h) => ({ rol: h.rol, texto: texto(h.texto).slice(0, 4000) }));
      }
      return p;
    }
  };

  global.AIBridgeOnboarding = API;
})(window);
