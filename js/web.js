/* AI Bridge Lite - Web: Aportaciones ($0 a $100), Enlace APK y Consola BYOK */
(function (global) {
  "use strict";

  const ob = global.AIBridgeOnboarding;
  const $ = (id) => document.getElementById(id);

  // Revisa estos nombres en la consola de cada proveedor; cámbialos aquí si cambian.
  const MODELOS = {
    gemini: "gemini-2.5-flash",
    claude: "claude-sonnet-5-5",
    openai: "gpt-4o-mini"
  };
  const MIME = "image/jpeg";
  const MAX_TOKENS = 1500;
  const TIMEOUT_MS = 60000;

  const SYSTEM = {
    visual: "Analiza las capturas de un entorno de desarrollo de juegos 3D. Describe y sugiere mejoras visuales concretas.",
    script: "Eres experto en scripting de juegos. Revisa el código dado y responde con código corregido y breve explicación.",
    optimizacion: "Eres experto en optimización de juegos. Detecta cuellos de botella y propón mejoras medibles.",
    hibrido: "Eres un asistente de desarrollo de juegos. Usa las capturas, el código y las propiedades del objeto para ayudar. Sé conciso."
  };

  /* ============ 1. SLIDER DE APORTES ($0 a $100) ============ */
  const MIN = 0;
  const MAX = 100;

  const MENSAJES = {
    gratis: "Modo Gratuito activo (BYOK). Para usar la consola o descargar la APK en este modo, requerirás tu propia API Key.",
    pago: "¡Gracias por apoyar el proyecto! Las aportaciones de dinero real y pasarela de pago directa se habilitarán en la versión 1.0."
  };

  // Corrige el ancla: la sección de la consola no tenía id.
  const panelChat = document.querySelector(".panel-chat");
  if (panelChat && !panelChat.id) panelChat.id = "panel-chat";

  const input = $("pay-amount");
  const slider = $("pay-slider");
  const msg = $("pay-msg");
  const btn = $("btn-apk");
  const btnLabel = $("btn-apk-label");
  const chips = document.querySelectorAll(".chip[data-amount]");

  if (input && slider && btn) {
    const clamp = (v) => {
      const n = parseFloat(v);
      if (isNaN(n)) return MIN;
      return Math.min(MAX, Math.max(MIN, Math.round(n * 100) / 100));
    };

    const actualizarFlujo = (valor, origen) => {
      const monto = clamp(valor);

      if (origen !== "input") input.value = monto;
      if (origen !== "slider") slider.value = monto;

      chips.forEach((c) =>
        c.classList.toggle("active", parseFloat(c.dataset.amount) === monto)
      );

      btn.dataset.amount = monto;

      if (monto === 0) {
        if (msg) msg.textContent = MENSAJES.gratis;
        btn.className = "btn-primary";
        if (btnLabel) btnLabel.textContent = "DESCARGAR APK (GRATIS - BYOK)";
        btn.href = "#panel-chat";
      } else {
        if (msg) msg.textContent = MENSAJES.pago;
        btn.className = "btn-disabled";
        if (btnLabel) btnLabel.textContent = `APORTAR $${monto} (PRÓXIMAMENTE)`;
        btn.href = "#descarga";
      }
    };

    btn.addEventListener("click", (event) => {
      const monto = parseFloat(btn.dataset.amount || "0");
      if (monto !== 0) {
        event.preventDefault();
        if (msg) msg.textContent = "Las aportaciones de pago estarán disponibles próximamente.";
      }
    });

    input.addEventListener("input", () => actualizarFlujo(input.value, "input"));
    input.addEventListener("blur", () => actualizarFlujo(input.value));
    slider.addEventListener("input", () => actualizarFlujo(slider.value, "slider"));
    chips.forEach((c) =>
      c.addEventListener("click", () => actualizarFlujo(c.dataset.amount))
    );

    actualizarFlujo(0);
  }

  /* ============ 2. CLIENTE HTTP DIRECTO (BYOK) ============ */
  function limpiarB64(f) {
    const s = typeof f === "string" ? f : f && f.data_b64;
    if (!s) return "";
    const i = s.indexOf("base64,");
    return i >= 0 ? s.slice(i + 7) : s;
  }

  function construirTexto(p) {
    let t = p.prompt_intencion;
    if (p.script_snippet) t += "\n\n[SCRIPT]\n" + p.script_snippet;
    if (p.objeto_properties && Object.keys(p.objeto_properties).length) {
      t += "\n\n[OBJETO]\n" + JSON.stringify(p.objeto_properties);
    }
    return t;
  }

  function armarPeticion(proveedor, key, system, texto, frames) {
    if (proveedor === "gemini") {
      const parts = [{ text: texto }];
      frames.forEach((d) => parts.push({ inlineData: { mimeType: MIME, data: d } }));
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${MODELOS.gemini}:generateContent`,
        headers: { "x-goog-api-key": key }, // la key va en header, no en la URL
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: MAX_TOKENS }
        }
      };
    }

    if (proveedor === "claude") {
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
          model: MODELOS.claude,
          max_tokens: MAX_TOKENS,
          system: system,
          messages: [{ role: "user", content }]
        }
      };
    }

    const content = [{ type: "text", text: texto }];
    frames.forEach((d) =>
      content.push({ type: "image_url", image_url: { url: `data:${MIME};base64,${d}` } })
    );
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model: MODELOS.openai,
        max_completion_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content }
        ]
      }
    };
  }

  function parsearRespuesta(proveedor, data) {
    if (proveedor === "gemini") {
      const parts = data.candidates?.[0]?.content?.parts || [];
      return parts.map((p) => p.text || "").join("");
    }
    if (proveedor === "claude") {
      return (data.content || []).map((c) => c.text || "").join("");
    }
    return data.choices?.[0]?.message?.content || "";
  }

  function errorAmigable(status, raw) {
    let detalle = "";
    try {
      const j = JSON.parse(raw);
      const e = j.error;
      detalle = typeof e === "string" ? e : (e && e.message) || "";
    } catch (_) {}
    detalle = String(detalle).slice(0, 300);

    const base =
      status === 400 ? "Petición rechazada (revisa el modelo o el tamaño de las imágenes)." :
      status === 401 || status === 403 ? "API Key inválida o sin permisos." :
      status === 404 ? "Modelo no encontrado. Revisa el nombre del modelo." :
      status === 429 ? "Límite de uso alcanzado. Espera un momento." :
      status >= 500 ? "El servidor de IA tiene problemas. Intenta más tarde." :
      `Error del servidor (${status}).`;
    return detalle ? `${base}\n${detalle}` : base;
  }

  async function enviarPeticion(datos) {
    if (!ob) throw new Error("Módulo de onboarding no encontrado.");

    const payload = ob.buildPayload(Object.assign({ perfil_seleccionado: "hibrido" }, datos));
    if (!payload) {
      const err = new Error("NO_KEY");
      err.code = "NO_KEY";
      throw err;
    }

    const frames = (payload.modo_secuencia_frames || []).map(limpiarB64).filter(Boolean);
    const system = SYSTEM[payload.perfil_seleccionado] || SYSTEM.hibrido;
    const req = armarPeticion(
      payload.proveedor, payload.api_key_usuario, system, construirTexto(payload), frames
    );

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(req.url, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, req.headers),
        body: JSON.stringify(req.body),
        signal: ctrl.signal
      });
    } catch (e) {
      throw new Error(
        e.name === "AbortError" ? "Tiempo de espera agotado. Intenta de nuevo."
                                : "Sin conexión con el servidor de IA."
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    if (!response.ok) throw new Error(errorAmigable(response.status, raw));

    let data;
    try { data = JSON.parse(raw); } catch (_) { throw new Error("Respuesta inválida del servidor."); }
    const texto = parsearRespuesta(payload.proveedor, data);
    if (!texto.trim()) throw new Error("La IA no devolvió texto.");
    return texto;
  }

  global.AIBridgeClient = { enviarPeticion };

  /* ============ 3. PANEL DE API KEY (se inyecta, sin tocar el HTML) ============ */
  function montarPanelKey() {
    const cont = document.querySelector(".chat-inputs");
    if (!cont || !ob || $("key-panel")) return;

    const css = "background:var(--bg-primary);color:var(--accent-color);" +
      "border:1px solid var(--border-color);border-radius:var(--radius-sm);" +
      "font-family:inherit;padding:10px;width:100%;margin-bottom:8px;outline:none;";

    const panel = document.createElement("div");
    panel.id = "key-panel";
    panel.style.marginBottom = "14px";

    const titulo = document.createElement("label");
    titulo.textContent = "API Key (BYOK, se guarda solo en este dispositivo)";
    titulo.style.cssText = "display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;";

    const sel = document.createElement("select");
    sel.style.cssText = css;
    ["gemini", "claude", "openai"].forEach((p) => {
      const o = document.createElement("option");
      o.value = p;
      o.textContent = p.toUpperCase();
      sel.appendChild(o);
    });
    sel.value = ob.getConfig().proveedor_activo;

    const key = document.createElement("input");
    key.type = "password";
    key.autocomplete = "off";
    key.spellcheck = false;
    key.placeholder = "Pega tu API Key";
    key.style.cssText = css;

    const fila = document.createElement("div");
    fila.style.cssText = "display:flex;gap:8px;";
    const crearBtn = (texto) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = texto;
      b.style.cssText = "flex:1;min-height:44px;";
      return b;
    };
    const bGuardar = crearBtn("GUARDAR");
    const bBorrar = crearBtn("BORRAR");
    fila.append(bGuardar, bBorrar);

    const estado = document.createElement("p");
    estado.style.cssText = "font-size:0.8rem;margin-top:8px;";

    const refrescar = () => {
      const p = sel.value;
      const tiene = String(ob.getConfig().api_keys[p] || "").trim().length >= 10;
      estado.textContent = tiene
        ? `✔ Key de ${p.toUpperCase()} guardada en este dispositivo.`
        : `⚠ Falta tu API Key de ${p.toUpperCase()}. Pégala arriba para usar la consola.`;
      estado.style.color = tiene ? "var(--accent-color)" : "var(--accent-secondary)";
    };

    sel.addEventListener("change", () => { ob.setProveedorActivo(sel.value); refrescar(); });
    bGuardar.addEventListener("click", () => {
      const v = key.value.trim();
      if (v.length < 10) {
        estado.textContent = "La key parece incompleta.";
        estado.style.color = "var(--accent-secondary)";
        return;
      }
      ob.setKey(sel.value, v);
      ob.setProveedorActivo(sel.value);
      key.value = ""; // no dejar la key visible
      refrescar();
    });
    bBorrar.addEventListener("click", () => { ob.setKey(sel.value, ""); refrescar(); });

    panel.append(titulo, sel, key, fila, estado);
    cont.insertBefore(panel, cont.firstChild);
    refrescar();
  }

  /* ============ 4. CONSOLA: BOTÓN "ENVIAR A LA IA" ============ */
  const btnEnviar = $("btn-enviar-ai");
  const txtPrompt = $("user-prompt");
  const boxOutput = $("ai-output");

  montarPanelKey();

  if (btnEnviar && txtPrompt && boxOutput) {
    btnEnviar.addEventListener("click", async () => {
      const intencion = txtPrompt.value.trim();
      if (!intencion) {
        boxOutput.textContent = "Escribe una consulta antes de enviar.";
        return;
      }

      boxOutput.textContent = "Procesando petición con la IA...";
      btnEnviar.disabled = true;

      try {
        boxOutput.textContent = await enviarPeticion({ prompt_intencion: intencion });
      } catch (error) {
        if (error.code === "NO_KEY") {
          const p = ob ? ob.getConfig().proveedor_activo.toUpperCase() : "tu proveedor";
          boxOutput.textContent =
            `Para usar la consola, configura tu API Key de ${p} en el panel de arriba. ` +
            "Se guarda solo en tu dispositivo.";
        } else {
          boxOutput.textContent = `⚠ ${error.message}`;
        }
      } finally {
        btnEnviar.disabled = false;
      }
    });
  }

})(window);
