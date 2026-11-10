/* AI Bridge Lite - Consola (Repo 2)
   Pantallas (configuración / consola), selector de modelo, panel de API Key,
   llamadas directas a Gemini, Claude y OpenAI, e imágenes en secuencia. */
(function (global) {
  "use strict";

  const ob = global.AIBridgeOnboarding;
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const NOMBRES = { gemini: "Gemini", claude: "Claude", openai: "OpenAI" };
  const IDIOMA_IA = { es: "español", en: "inglés", pt: "portugués" };
  const MIME = "image/jpeg";
  const MAX_FRAMES = 5;
  const MAX_LADO = 720;
  const CALIDAD_JPEG = 0.6;
  const MAX_TOKENS = 1500;
  const TIMEOUT_MS = 60000;

  const SYSTEM = {
    visual: "Analiza las capturas de un entorno de desarrollo de juegos 3D. Describe y sugiere mejoras visuales concretas.",
    script: "Eres experto en scripting de juegos. Revisa el código dado y responde con código corregido y breve explicación.",
    optimizacion: "Eres experto en optimización de juegos. Detecta cuellos de botella y propón mejoras medibles.",
    hibrido: "Eres un asistente de desarrollo de juegos. Usa las capturas, el código y las propiedades del objeto para ayudar. Sé conciso."
  };

  if (!ob) {
    const p = $("pantalla-config");
    if (p) p.hidden = false;
    const e = $("cfg-key-estado");
    if (e) { e.textContent = "No se pudo cargar js/onboarding.js. Revisa que el archivo exista."; e.className = "estado alerta"; }
    return;
  }

  let imagenes = [];      // data URLs JPEG ya reducidas (en orden de secuencia)
  let ultimaRespuesta = "";
  let enviando = false;

  /* ================= PANTALLAS ================= */
  function mostrar(cual) {
    $("pantalla-config").hidden = cual !== "config";
    $("pantalla-consola").hidden = cual !== "consola";
    if (cual === "config") renderConfig(); else renderConsola();
    global.scrollTo(0, 0);
  }

  function setEstado(el, texto, clase) {
    el.textContent = texto;
    el.className = "estado" + (clase ? " " + clase : "");
  }

  /* ================= CONFIGURACIÓN ================= */
  function renderConfig() {
    const cfg = ob.getConfig();
    const prov = cfg.proveedor_activo;

    $("cfg-idioma").value = cfg.idioma;
    $$(".chip[data-area]").forEach((c) =>
      c.classList.toggle("active", cfg.areas.includes(c.dataset.area)));
    $$(".chip[data-proveedor]").forEach((c) =>
      c.classList.toggle("active", c.dataset.proveedor === prov));

    // Modelos del proveedor activo + opción "Otro"
    const sel = $("cfg-modelo");
    sel.textContent = "";
    ob.listarModelos(prov).forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.nombre;
      sel.appendChild(o);
    });
    const otro = document.createElement("option");
    otro.value = ob.OTRO;
    otro.textContent = "Otro (escribir nombre)";
    sel.appendChild(otro);
    sel.value = ob.getModeloSel(prov);

    const custom = $("cfg-modelo-custom");
    custom.hidden = sel.value !== ob.OTRO;
    custom.value = ob.getModeloCustom(prov);

    $("cfg-key-proveedor").textContent = NOMBRES[prov];
    $("cfg-key").value = "";
    $("cfg-key").type = "password";
    $("btn-ver-key").textContent = "VER";
    estadoKey();
  }

  function estadoKey() {
    const prov = ob.getConfig().proveedor_activo;
    const el = $("cfg-key-estado");
    if (ob.tieneKey(prov)) {
      setEstado(el, `✔ Key de ${NOMBRES[prov]} guardada en este dispositivo.`, "ok");
    } else {
      setEstado(el, `⚠ Aún no hay API Key de ${NOMBRES[prov]}. Pégala arriba y toca GUARDAR.`, "alerta");
    }
  }

  function guardarKey() {
    const prov = ob.getConfig().proveedor_activo;
    const campo = $("cfg-key");
    const valor = campo.value.trim();
    const el = $("cfg-key-estado");
    if (!valor) { setEstado(el, "Pega tu API Key primero.", "alerta"); return; }

    ob.setKey(prov, valor);
    campo.value = ""; // no dejar la key visible en pantalla
    campo.type = "password";
    $("btn-ver-key").textContent = "VER";
    if (!ob.tieneKey(prov)) {
      ob.setKey(prov, "");
      setEstado(el, "La key parece incompleta. Revisa que esté completa.", "alerta");
      return;
    }
    estadoKey();
  }

  function enlazarConfig() {
    $("cfg-idioma").addEventListener("change", (e) => ob.setIdioma(e.target.value));

    $$(".chip[data-area]").forEach((c) =>
      c.addEventListener("click", () => { ob.toggleArea(c.dataset.area); renderConfig(); }));

    $$(".chip[data-proveedor]").forEach((c) =>
      c.addEventListener("click", () => { ob.setProveedorActivo(c.dataset.proveedor); renderConfig(); }));

    $("cfg-modelo").addEventListener("change", (e) => {
      const prov = ob.getConfig().proveedor_activo;
      ob.setModelo(prov, e.target.value);
      $("cfg-modelo-custom").hidden = e.target.value !== ob.OTRO;
      if (e.target.value === ob.OTRO) $("cfg-modelo-custom").focus();
    });
    $("cfg-modelo-custom").addEventListener("input", (e) => {
      ob.setModeloCustom(ob.getConfig().proveedor_activo, e.target.value);
    });

    $("btn-ver-key").addEventListener("click", () => {
      const campo = $("cfg-key");
      const oculto = campo.type === "password";
      campo.type = oculto ? "text" : "password";
      $("btn-ver-key").textContent = oculto ? "OCULTAR" : "VER";
    });
    $("btn-guardar-key").addEventListener("click", guardarKey);
    $("btn-borrar-key").addEventListener("click", () => {
      ob.setKey(ob.getConfig().proveedor_activo, "");
      $("cfg-key").value = "";
      estadoKey();
    });

    $("btn-empezar").addEventListener("click", () => {
      ob.setCompletado(true);
      mostrar("consola");
    });
  }

  /* ================= CONSOLA ================= */
  function renderConsola() {
    const cfg = ob.getConfig();
    const prov = cfg.proveedor_activo;
    const modelo = ob.getModeloId(prov);
    const tieneKey = ob.tieneKey(prov);

    $$(".chip[data-perfil]").forEach((c) =>
      c.classList.toggle("active", c.dataset.perfil === cfg.perfil));

    const el = $("estado-conexion");
    setEstado(
      el,
      `${NOMBRES[prov]} · ${modelo || "sin modelo"} · ${tieneKey ? "API Key lista" : "sin API Key"}`,
      tieneKey && modelo ? "ok" : "alerta"
    );

    const aviso = $("aviso-key");
    aviso.hidden = tieneKey && !!modelo;
    $("aviso-key-texto").textContent = !tieneKey
      ? `Falta tu API Key de ${NOMBRES[prov]}. Configúrala para poder usar la IA; se guarda solo en tu dispositivo.`
      : "Falta elegir o escribir el nombre del modelo.";
  }

  function salida(texto) { $("ai-output").textContent = texto; }

  /* ---------- Imágenes (secuencia) ---------- */
  function leerImagen(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const w0 = img.naturalWidth, h0 = img.naturalHeight;
          const escala = Math.min(1, MAX_LADO / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * escala));
          const h = Math.max(1, Math.round(h0 * escala));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = c.toDataURL(MIME, CALIDAD_JPEG);
          c.width = 0; c.height = 0; // libera memoria del canvas
          resolve(dataUrl);
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagen")); };
      img.src = url;
    });
  }

  function renderMiniaturas() {
    const cont = $("miniaturas");
    cont.textContent = "";
    imagenes.forEach((src, i) => {
      const im = document.createElement("img");
      im.src = src;
      im.alt = `Imagen ${i + 1}`;
      cont.appendChild(im);
    });
    $("btn-limpiar-img").hidden = imagenes.length === 0;
  }

  async function agregarImagenes(files) {
    const lista = Array.from(files || []);
    if (!lista.length) return;
    const libres = MAX_FRAMES - imagenes.length;
    if (libres <= 0) { salida(`Máximo ${MAX_FRAMES} imágenes. Toca QUITAR para empezar de nuevo.`); return; }

    let omitidas = lista.length - libres;
    for (const f of lista.slice(0, libres)) {
      try {
        imagenes.push(await leerImagen(f));
      } catch (_) {
        omitidas++;
      }
    }
    renderMiniaturas();
    if (omitidas > 0) salida(`Se omitieron ${omitidas} imagen(es) (máximo ${MAX_FRAMES} o formato no válido).`);
  }

  /* ---------- Llamadas directas a la IA ---------- */
  function construirTexto(p) {
    let t = p.prompt_intencion;
    if (p.script_snippet) t += "\n\n[SCRIPT]\n" + p.script_snippet;
    return t;
  }

  function armarPeticion(prov, key, modelo, system, texto, frames) {
    if (prov === "gemini") {
      const parts = [{ text: texto }];
      frames.forEach((d) => parts.push({ inlineData: { mimeType: MIME, data: d } }));
      const id = encodeURIComponent(modelo.replace(/^models\//, ""));
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`,
        headers: { "x-goog-api-key": key }, // la key va en header, nunca en la URL
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: MAX_TOKENS }
        }
      };
    }

    if (prov === "claude") {
      const content = frames.map((d) => ({
        type: "image",
        source: { type: "base64", media_type: MIME, data: d }
      }));
      content.push({ type: "text", text: texto });
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: {
          model: modelo,
          max_tokens: MAX_TOKENS,
          system: system,
          messages: [{ role: "user", content }]
        }
      };
    }

    const content = [{ type: "text", text: texto }];
    frames.forEach((d) =>
      content.push({ type: "image_url", image_url: { url: `data:${MIME};base64,${d}` } }));
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model: modelo,
        max_completion_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content }
        ]
      }
    };
  }

  function parsearRespuesta(prov, data) {
    if (prov === "gemini") {
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts) || [];
      return parts.map((p) => p.text || "").join("");
    }
    if (prov === "claude") {
      return (data.content || []).map((c) => c.text || "").join("");
    }
    const m = data.choices && data.choices[0] && data.choices[0].message;
    return (m && m.content) || "";
  }

  function errorAmigable(status, raw) {
    let detalle = "";
    try {
      const e = JSON.parse(raw).error;
      detalle = typeof e === "string" ? e : (e && e.message) || "";
    } catch (_) {}
    detalle = String(detalle).slice(0, 300);

    const base =
      status === 400 ? "Petición rechazada (revisa el modelo o el tamaño de las imágenes)." :
      status === 401 || status === 403 ? "API Key inválida o sin permisos." :
      status === 404 ? "Modelo no encontrado. En Ajustes elige otro o usa «Otro» con el nombre exacto." :
      status === 429 ? "Límite de uso alcanzado. Espera un momento." :
      status >= 500 ? "El servidor de IA tiene problemas. Intenta más tarde." :
      `Error del servidor (${status}).`;
    return detalle ? `${base}\n${detalle}` : base;
  }

  async function enviar() {
    if (enviando) return;

    const prompt = $("user-prompt").value.trim();
    if (!prompt) { salida("Escribe una consulta antes de enviar."); return; }

    const cfg = ob.getConfig();
    const prov = cfg.proveedor_activo;

    if (!ob.tieneKey(prov)) {
      salida(`Para usar la IA, configura tu API Key de ${NOMBRES[prov]} en AJUSTES. Se guarda solo en tu dispositivo.`);
      renderConsola();
      return;
    }
    const modelo = ob.getModeloId(prov);
    if (!modelo) { salida("Elige un modelo o escribe su nombre en AJUSTES."); renderConsola(); return; }

    const frames = imagenes.map((u) => u.slice(u.indexOf(",") + 1));
    const payload = ob.buildPayload({
      perfil_seleccionado: cfg.perfil,
      prompt_intencion: prompt,
      script_snippet: $("user-snippet").value.trim(),
      modo_secuencia_frames: frames
    });
    if (!payload) { salida("No se pudo preparar la consulta."); return; }

    let system = SYSTEM[payload.perfil_seleccionado] || SYSTEM.hibrido;
    system += ` Responde en ${IDIOMA_IA[cfg.idioma] || "español"}.`;
    if (cfg.areas.length) system += ` Áreas de enfoque del usuario: ${cfg.areas.join(", ")}.`;

    const req = armarPeticion(
      payload.proveedor, payload.api_key_usuario, modelo, system,
      construirTexto(payload), payload.modo_secuencia_frames || []
    );

    enviando = true;
    const btn = $("btn-enviar-ai");
    btn.disabled = true;
    salida("Procesando petición con la IA...");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      let resp;
      try {
        resp = await fetch(req.url, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, req.headers),
          body: JSON.stringify(req.body),
          signal: ctrl.signal
        });
      } catch (e) {
        throw new Error(e.name === "AbortError"
          ? "Tiempo de espera agotado. Intenta de nuevo."
          : "Sin conexión con el servidor de IA (o el navegador bloqueó la petición).");
      }

      const raw = await resp.text();
      if (!resp.ok) throw new Error(errorAmigable(resp.status, raw));

      let data;
      try { data = JSON.parse(raw); } catch (_) { throw new Error("Respuesta inválida del servidor."); }
      const texto = parsearRespuesta(payload.proveedor, data);
      if (!texto.trim()) throw new Error("La IA no devolvió texto.");

      ultimaRespuesta = texto;
      salida(texto);
    } catch (error) {
      ultimaRespuesta = "";
      salida("⚠ " + error.message);
    } finally {
      clearTimeout(timer);
      enviando = false;
      btn.disabled = false;
    }
  }

  async function copiarRespuesta() {
    if (!ultimaRespuesta) return;
    const btn = $("btn-copiar");
    try {
      await global.navigator.clipboard.writeText(ultimaRespuesta);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = ultimaRespuesta;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (__) {}
      document.body.removeChild(ta);
    }
    btn.textContent = "COPIADO ✔";
    setTimeout(() => { btn.textContent = "COPIAR RESPUESTA"; }, 1500);
  }

  function enlazarConsola() {
    $("user-prompt").maxLength = 1000;   // mismo límite que el esquema del payload
    $("user-snippet").maxLength = 6000;

    $("btn-ajustes").addEventListener("click", () => mostrar("config"));
    $("btn-aviso-ajustes").addEventListener("click", () => mostrar("config"));

    $$(".chip[data-perfil]").forEach((c) =>
      c.addEventListener("click", () => { ob.setPerfil(c.dataset.perfil); renderConsola(); }));

    $("user-imagenes").addEventListener("change", async (e) => {
      await agregarImagenes(e.target.files);
      e.target.value = ""; // permite elegir la misma imagen otra vez
    });
    $("btn-limpiar-img").addEventListener("click", () => { imagenes = []; renderMiniaturas(); });

    $("btn-enviar-ai").addEventListener("click", enviar);
    $("btn-copiar").addEventListener("click", copiarRespuesta);
  }

  /* ================= INICIO ================= */
  enlazarConfig();
  enlazarConsola();
  mostrar(ob.isDone() ? "consola" : "config");

})(window);
