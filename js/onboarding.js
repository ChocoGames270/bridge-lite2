/* AI Bridge Lite - Configuración (Repo 2)
   Guarda en localStorage: idioma, áreas, proveedor, modelo por proveedor,
   API Keys (BYOK) y perfil. Expone window.AIBridgeOnboarding. */
(function (global) {
  "use strict";

  const KEY = "aibl_config_v1";
  const MIN_KEY = 10;
  const OTRO = "__otro__";

  const IDIOMAS = ["es", "en", "pt"];
  const AREAS = ["scripts", "3d", "vfx", "aprendiz"];
  const PROVEEDORES = ["gemini", "claude", "openai"];
  const PERFILES = ["visual", "script", "hibrido", "optimizacion"];

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

  const porProveedor = (valor) => {
    const o = {};
    PROVEEDORES.forEach((p) => { o[p] = valor(p); });
    return o;
  };

  const DEFAULT = {
    version: "1.0",
    completado: false,
    idioma: "es",
    areas: [],
    proveedor_activo: "gemini",
    perfil: "hibrido",
    api_keys: porProveedor(() => ""),
    modelos: porProveedor((p) => MODELOS[p][0].id),
    modelos_custom: porProveedor(() => "")
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const texto = (v) => (typeof v === "string" ? v : "");

  // Valida y completa lo guardado (evita errores si el JSON está viejo o alterado).
  function normalizar(data) {
    const cfg = clone(DEFAULT);
    if (!data || typeof data !== "object") return cfg;

    cfg.completado = data.completado === true;
    if (IDIOMAS.includes(data.idioma)) cfg.idioma = data.idioma;
    if (Array.isArray(data.areas)) cfg.areas = data.areas.filter((a, i, arr) => AREAS.includes(a) && arr.indexOf(a) === i);
    if (PROVEEDORES.includes(data.proveedor_activo)) cfg.proveedor_activo = data.proveedor_activo;
    if (PERFILES.includes(data.perfil)) cfg.perfil = data.perfil;

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

  const API = {
    MIN_KEY, OTRO, IDIOMAS, AREAS, PROVEEDORES, PERFILES,

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

    // ----- Proveedor y modelo -----
    setProveedorActivo(p) {
      if (!provValido(p)) return false;
      cfg.proveedor_activo = p;
      return guardar();
    },
    listarModelos: (p) => (provValido(p) ? MODELOS[p].slice() : []),
    getModeloSel: (p) => (provValido(p) ? cfg.modelos[p] : ""),          // id del catálogo u OTRO
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

    reset() {
      try { global.localStorage.removeItem(KEY); } catch (_) {}
      memoria = null;
      cfg = clone(DEFAULT);
    },

    /* Payload ligero según payload-schema.json (la consola añade el modelo aparte).
       Devuelve null si falta la API Key del proveedor activo. */
    buildPayload(datos) {
      const d = datos || {};
      const prov = cfg.proveedor_activo;
      if (!API.tieneKey(prov)) return null;

      const p = {
        version: "1.0",
        proveedor: prov,
        perfil_seleccionado: PERFILES.includes(d.perfil_seleccionado) ? d.perfil_seleccionado : cfg.perfil,
        prompt_intencion: texto(d.prompt_intencion).slice(0, 1000),
        api_key_usuario: cfg.api_keys[prov]
      };
      const snippet = texto(d.script_snippet);
      if (snippet) p.script_snippet = snippet.slice(0, 6000);
      if (d.objeto_properties && typeof d.objeto_properties === "object") {
        p.objeto_properties = d.objeto_properties;
      }
      if (Array.isArray(d.modo_secuencia_frames) && d.modo_secuencia_frames.length) {
        p.modo_secuencia_frames = d.modo_secuencia_frames.slice(0, 5);
      }
      return p;
    }
  };

  global.AIBridgeOnboarding = API;
})(window);
