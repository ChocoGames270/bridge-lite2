/* AI Bridge Lite - Consola de chat (Repo 2)  ·  PARTE 1 de 2
   Ajustes, cuenta de Google, menús, panel lateral y estado. */
(function (global) {
  "use strict";

  const ob = global.AIBridgeOnboarding;
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  if (!ob) {
    document.body.textContent = "No se pudo cargar js/onboarding.js. Revisa que el archivo exista.";
    return;
  }

  /* ============ AJUSTES DEL DESARROLLADOR (rellena cuando los tengas) ============ */
  // URL de tu servidor proxy de la IA nativa. Recibe el payload JSON por POST y responde { "texto": "..." }.
  const NATIVE_ENDPOINT = "";
  // ID de cliente OAuth (Web) de Google Cloud para "Iniciar sesión con Google".
  const GOOGLE_CLIENT_ID = "";

  const NS = "http://www.w3.org/2000/svg";
  const NOMBRES = { gemini: "Gemini", claude: "Claude", openai: "OpenAI" };
  const IDIOMA_IA = { es: "español", en: "inglés", pt: "portugués" };
  const IDIOMA_VOZ = { es: "es-ES", en: "en-US", pt: "pt-BR" };
  const MIME = "image/jpeg";
  const MAX_LADO = 720;
  const CALIDAD = 0.6;
  const LADO_MINI = 96;
  const CALIDAD_MINI = 0.5;
  const MINIS_GUARDADAS = 8;
  const MAX_TOKENS = 4096;
  const TIMEOUT_MS = 90000;
  const MAX_BYTES_TEXTO = 200000;
  const MAX_CACHE = 6;

  const SYSTEM = {
    visual: "Analiza las capturas de un entorno de desarrollo de juegos 3D. Describe y sugiere mejoras visuales concretas.",
    script: "Eres experto en scripting de juegos. Revisa el código dado y responde con código corregido y breve explicación.",
    optimizacion: "Eres experto en optimización de juegos. Detecta cuellos de botella y propón mejoras medibles.",
    hibrido: "Eres un asistente de desarrollo de juegos. Usa las capturas, el código y las propiedades del objeto para ayudar. Sé conciso."
  };

  /* ============ ESTADO COMPARTIDO ============ */
  let pendientes = [];          // adjuntos por enviar
  let enviando = false;
  let tokenEnvio = 0;           // invalida respuestas viejas al cancelar o cambiar de chat
  let abortActual = null;
  let reconocimiento = null;    // dictado por voz
  let idLocal = 0;
  const cacheEnvios = new Map(); // msgId -> { texto, frames[], archivos[] } (solo en memoria)

  /* ============ UTILIDADES ============ */
  const nuevoId = () => "p" + (++idLocal) + Date.now().toString(36);

  function toast(t, ms) {
    const el = $("toast");
    el.textContent = t;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, ms || 2200);
  }

  function icono(nombre, clase) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "ic" + (clase ? " " + clase : ""));
    const u = document.createElementNS(NS, "use");
    u.setAttribute("href", "#i-" + nombre);
    svg.appendChild(u);
    return svg;
  }

  function setEstado(el, t, clase) {
    el.textContent = t;
    el.className = "estado" + (clase ? " " + clase : "");
  }

  const fechaCorta = (iso) => String(iso).split("-").reverse().slice(0, 2).join("/");

  /* ============ MENÚS EMERGENTES ============ */
  const MENUS = [["btn-mas", "menu-chat"], ["btn-adjuntar", "menu-adjuntar"], ["btn-modo-flotante", "menu-flotante"]];

  function cerrarMenus(excepto) {
    MENUS.forEach(([b, m]) => {
      if (m !== excepto) { $(m).hidden = true; $(b).setAttribute("aria-expanded", "false"); }
    });
  }

  function alternarMenu(btn, menu) {
    const abrir = $(menu).hidden;
    cerrarMenus(abrir ? menu : null);
    $(menu).hidden = !abrir;
    $(btn).setAttribute("aria-expanded", String(abrir));
  }

  /* ============ PANEL LATERAL ============ */
  function abrirPanel() {
    cerrarMenus();
    renderLista();
    renderCuenta();
    $("panel").classList.add("abierto");
    $("velo").classList.add("abierto");
    $("panel").setAttribute("aria-hidden", "false");
  }

  function cerrarPanel() {
    $("panel").classList.remove("abierto");
    $("velo").classList.remove("abierto");
    $("panel").setAttribute("aria-hidden", "true");
  }

  /* ============ CUENTA DE GOOGLE ============ */
  function renderCuenta() {
    const c = ob.getCuenta();
    $("cuenta-nombre").textContent = c ? (c.nombre || c.email || "Cuenta") : "Invitado";
    $("cuenta-estado").textContent = c ? (c.email || "Sesión iniciada") : "Sin sesión de Google";
    $("txt-google").textContent = c ? "Cerrar sesión" : "Iniciar sesión con Google";

    const av = $("cuenta-avatar");
    av.textContent = "";
    if (c && c.foto) {
      const im = document.createElement("img");
      im.src = c.foto;
      im.alt = "";
      im.referrerPolicy = "no-referrer";
      im.onerror = () => { av.textContent = ""; av.appendChild(icono("user")); };
      av.appendChild(im);
    } else {
      av.appendChild(icono("user"));
    }
  }

  function decodificarJwt(token) {
    try {
      const b = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      return null;
    }
  }

  function alRespuestaGoogle(resp) {
    const d = decodificarJwt(resp && resp.credential);
    if (!d) { toast("No se pudo iniciar sesión."); return; }
    ob.setCuenta({ nombre: d.name || "", email: d.email || "", foto: d.picture || "" });
    renderCuenta();
    toast("Sesión iniciada");
  }

  function cargarGoogle() {
    return new Promise((resolve, reject) => {
      if (global.google && global.google.accounts) { resolve(); return; }
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("gsi"));
      document.head.appendChild(s);
    });
  }

  async function sesionGoogle() {
    if (ob.getCuenta()) {
      ob.cerrarSesion();
      try { global.google.accounts.id.disableAutoSelect(); } catch (_) {}
      renderCuenta();
      toast("Sesión cerrada");
      return;
    }
    if (!GOOGLE_CLIENT_ID) { toast("Falta configurar GOOGLE_CLIENT_ID en js/consola.js", 3500); return; }
    try {
      await cargarGoogle();
      global.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: alRespuestaGoogle });
      global.google.accounts.id.prompt();
    } catch (_) {
      toast("No se pudo cargar el inicio de sesión de Google.");
    }
  }

  /* ============ ESTADO DE LA IA (chip bajo el header) ============ */
  function renderEstado() {
    const cfg = ob.getConfig();
    const el = $("chip-estado");
    let t, clase;

    if (cfg.modo === "nativa") {
      const u = ob.usoSemanal();
      if (!NATIVE_ENDPOINT) {
        t = "IA nativa no disponible · toca para usar tu API Key";
        clase = "alerta";
      } else {
        t = `IA nativa · ${u.restantes}/${u.limite} esta semana`;
        clase = u.restantes > 0 ? "ok" : "alerta";
      }
    } else {
      const prov = cfg.proveedor_activo;
      const modelo = ob.getModeloId(prov);
      const lista = ob.tieneKey(prov) && !!modelo;
      t = `${NOMBRES[prov]} · ${modelo || "sin modelo"} · ${ob.tieneKey(prov) ? "key lista" : "sin API Key"}`;
      clase = lista ? "ok" : "alerta";
    }
    el.textContent = t;
    el.className = "chip-estado " + clase;
  }

  /* ============ AJUSTES (modal) ============ */
  function abrirAjustes(intro) {
    cerrarPanel();
    cerrarMenus();
    $("ajustes-intro").hidden = !intro;
    renderAjustes();
    $("modal-ajustes").hidden = false;
  }

  function cerrarAjustes() {
    $("modal-ajustes").hidden = true;
    ob.setCompletado(true);
    renderEstado();
  }

  function renderUso() {
    const u = ob.usoSemanal();
    const rel = $("uso-relleno");
    rel.style.width = u.porcentaje + "%";
    rel.parentNode.classList.toggle("alta", u.porcentaje >= 80);
    $("uso-texto").textContent =
      `${u.usados} de ${u.limite} mensajes usados esta semana. Se reinicia el ${fechaCorta(u.reinicia)}.`;
  }

  function renderAjustes() {
    const cfg = ob.getConfig();
    const prov = cfg.proveedor_activo;

    $$("#seg-modo .seg-b").forEach((b) => b.classList.toggle("active", b.dataset.modo === cfg.modo));
    $("bloque-nativa").hidden = cfg.modo !== "nativa";
    $("bloque-byok").hidden = cfg.modo !== "byok";
    renderUso();

    $("cfg-idioma").value = cfg.idioma;
    $$(".chip[data-area]").forEach((c) => c.classList.toggle("active", cfg.areas.includes(c.dataset.area)));
    $$(".chip[data-perfil]").forEach((c) => c.classList.toggle("active", c.dataset.perfil === cfg.perfil));
    $$(".chip[data-proveedor]").forEach((c) => c.classList.toggle("active", c.dataset.proveedor === prov));

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

    $("plan-actual").textContent = "Plan actual: " + ob.getPlan().nombre;
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
    const el = $("cfg-key-estado");
    if (!campo.value.trim()) { setEstado(el, "Pega tu API Key primero.", "alerta"); return; }

    ob.setKey(prov, campo.value);
    campo.value = "";
    campo.type = "password";
    $("btn-ver-key").textContent = "VER";
    if (!ob.tieneKey(prov)) {
      ob.setKey(prov, "");
      setEstado(el, "La key parece incompleta. Revisa que esté completa.", "alerta");
      return;
    }
    estadoKey();
    renderEstado();
  }

  function enlazarAjustes() {
    $("btn-menu").addEventListener("click", abrirPanel);
    $("btn-panel-cerrar").addEventListener("click", cerrarPanel);
    $("velo").addEventListener("click", cerrarPanel);
    $("btn-google").addEventListener("click", sesionGoogle);

    $("btn-ajustes").addEventListener("click", () => abrirAjustes(false));
    $("chip-estado").addEventListener("click", () => abrirAjustes(false));
    $("btn-ajustes-x").addEventListener("click", cerrarAjustes);
    $("btn-ajustes-listo").addEventListener("click", cerrarAjustes);
    $("modal-ajustes").addEventListener("click", (e) => { if (e.target === $("modal-ajustes")) cerrarAjustes(); });

    $$("#seg-modo .seg-b").forEach((b) =>
      b.addEventListener("click", () => { ob.setModo(b.dataset.modo); renderAjustes(); renderEstado(); }));

    $("cfg-idioma").addEventListener("change", (e) => ob.setIdioma(e.target.value));
    $$(".chip[data-area]").forEach((c) =>
      c.addEventListener("click", () => { ob.toggleArea(c.dataset.area); renderAjustes(); }));
    $$(".chip[data-perfil]").forEach((c) =>
      c.addEventListener("click", () => { ob.setPerfil(c.dataset.perfil); renderAjustes(); }));
    $$(".chip[data-proveedor]").forEach((c) =>
      c.addEventListener("click", () => { ob.setProveedorActivo(c.dataset.proveedor); renderAjustes(); renderEstado(); }));

    $("cfg-modelo").addEventListener("change", (e) => {
      const prov = ob.getConfig().proveedor_activo;
      ob.setModelo(prov, e.target.value);
      $("cfg-modelo-custom").hidden = e.target.value !== ob.OTRO;
      if (e.target.value === ob.OTRO) $("cfg-modelo-custom").focus();
      renderEstado();
    });
    $("cfg-modelo-custom").addEventListener("input", (e) => {
      ob.setModeloCustom(ob.getConfig().proveedor_activo, e.target.value);
      renderEstado();
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
      renderEstado();
    });
  }

    /* ===== PARTE 2 de 2 ===== */

  /* ============ IMÁGENES ============ */
  function cargarImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("imagen"));
      img.src = src;
    });
  }

  function dibujar(img, maxLado, calidad) {
    const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * escala));
    const h = Math.max(1, Math.round(img.naturalHeight * escala));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const url = c.toDataURL(MIME, calidad);
    c.width = 0; c.height = 0; // libera memoria
    return url;
  }

  async function procesarImagen(src) {
    const img = await cargarImg(src);
    return { dataUrl: dibujar(img, MAX_LADO, CALIDAD), mini: dibujar(img, LADO_MINI, CALIDAD_MINI) };
  }

  async function imagenDeArchivo(file) {
    const url = URL.createObjectURL(file);
    try { return await procesarImagen(url); } finally { URL.revokeObjectURL(url); }
  }

  /* ============ ADJUNTOS ============ */
  const imagenesPendientes = () => pendientes.filter((a) => a.tipo === "imagen");

  async function agregarImagenes(files) {
    const lista = Array.from(files || []);
    if (!lista.length) return;
    let libres = ob.limiteImagenes() - imagenesPendientes().length;
    let omitidas = 0;
    for (const f of lista) {
      if (libres <= 0) { omitidas++; continue; }
      try {
        const r = await imagenDeArchivo(f);
        pendientes.push({ id: nuevoId(), tipo: "imagen", nombre: f.name || "imagen", dataUrl: r.dataUrl, mini: r.mini });
        libres--;
      } catch (_) {
        omitidas++;
      }
    }
    renderAdjuntos();
    if (omitidas) toast(`Se omitieron ${omitidas} imagen(es) (límite de ${ob.limiteImagenes()} o formato no válido).`, 3200);
  }

  async function agregarArchivos(files) {
    let omitidos = 0, pdf = 0, truncados = 0;
    for (const f of Array.from(files || [])) {
      if (f.type && f.type.startsWith("image/")) { await agregarImagenes([f]); continue; }
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") { pdf++; continue; }
      try {
        const t = await f.slice(0, MAX_BYTES_TEXTO).text();
        if (t.indexOf("\u0000") !== -1) { omitidos++; continue; }
        if (f.size > MAX_BYTES_TEXTO) truncados++;
        pendientes.push({ id: nuevoId(), tipo: "archivo", nombre: f.name || "archivo", texto: t });
      } catch (_) {
        omitidos++;
      }
    }
    renderAdjuntos();
    if (pdf) toast("Los PDF aún no se pueden leer. Pega el texto como código.", 3500);
    else if (omitidos) toast(`Se omitieron ${omitidos} archivo(s) no legibles.`, 3000);
    else if (truncados) toast("Archivo grande: se envía solo el inicio.", 3000);
  }

  function renderAdjuntos() {
    const cont = $("adjuntos");
    cont.textContent = "";
    cont.hidden = pendientes.length === 0;

    pendientes.forEach((a) => {
      const d = document.createElement("div");
      d.className = "adjunto";

      if (a.tipo === "imagen") {
        const im = document.createElement("img");
        im.src = a.mini;
        im.alt = a.nombre;
        im.style.cursor = "pointer";
        im.addEventListener("click", () => abrirVisor(a.dataUrl));
        d.appendChild(im);
      } else {
        const w = document.createElement("div");
        w.className = "adj-ico";
        w.appendChild(icono(a.tipo === "codigo" ? "code" : "file"));
        const s = document.createElement("small");
        s.textContent = a.nombre;
        w.appendChild(s);
        d.appendChild(w);
      }

      const x = document.createElement("button");
      x.type = "button";
      x.className = "adj-x";
      x.setAttribute("aria-label", "Quitar " + a.nombre);
      x.appendChild(icono("x"));
      x.addEventListener("click", () => {
        pendientes = pendientes.filter((p) => p.id !== a.id);
        renderAdjuntos();
      });
      d.appendChild(x);
      cont.appendChild(d);
    });
    actualizarEnviar();
  }

  /* ---------- Modal de código ---------- */
  function abrirCodigo() {
    cerrarMenus();
    $("codigo-nombre").value = "";
    $("codigo-texto").value = "";
    $("modal-codigo").hidden = false;
    setTimeout(() => $("codigo-texto").focus(), 50);
  }
  const cerrarCodigo = () => { $("modal-codigo").hidden = true; };

  function adjuntarCodigo() {
    const t = $("codigo-texto").value.trim();
    if (!t) { toast("Pega el código primero."); return; }
    const nombre = $("codigo-nombre").value.trim().slice(0, 40) || "código";
    pendientes.push({ id: nuevoId(), tipo: "codigo", nombre, texto: t.slice(0, ob.MAX_SNIPPET) });
    cerrarCodigo();
    renderAdjuntos();
  }

  /* ---------- Visor de imagen ---------- */
  function abrirVisor(src) {
    $("visor-img").src = src;
    $("visor").hidden = false;
  }
  function cerrarVisor() {
    $("visor").hidden = true;
    $("visor-img").removeAttribute("src");
  }

  /* ============ ENTRADA DE TEXTO ============ */
  function autoajustar() {
    const t = $("entrada");
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 140) + "px";
  }

  function actualizarEnviar() {
    const btn = $("btn-enviar");
    const hay = $("entrada").value.trim().length > 0 || pendientes.length > 0;
    btn.disabled = !(hay || enviando);
    btn.setAttribute("aria-label", enviando ? "Detener" : "Enviar");
    btn.querySelector("use").setAttribute("href", enviando ? "#i-x" : "#i-send");
  }

  /* ---------- Voz (dictado) ---------- */
  function alternarVoz() {
    const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) { toast("Tu navegador no admite dictado por voz."); return; }

    if (reconocimiento) { reconocimiento.stop(); return; }

    const rec = new SR();
    rec.lang = IDIOMA_VOZ[ob.getConfig().idioma] || "es-ES";
    rec.interimResults = true;
    rec.continuous = false;

    const campo = $("entrada");
    const base = campo.value;
    const sep = base && !/\s$/.test(base) ? " " : "";

    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      campo.value = (base + sep + t).slice(0, ob.MAX_PROMPT);
      autoajustar();
      actualizarEnviar();
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Permite el micrófono para dictar.", 3000);
    };
    rec.onend = () => {
      reconocimiento = null;
      $("btn-mic").classList.remove("escuchando");
    };

    try {
      rec.start();
      reconocimiento = rec;
      $("btn-mic").classList.add("escuchando");
    } catch (_) {
      reconocimiento = null;
    }
  }

  /* ============ COPIAR Y COMPARTIR ============ */
  async function copiarTexto(t) {
    try {
      await global.navigator.clipboard.writeText(t);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.cssText = "position:fixed;opacity:0;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (__) {}
      document.body.removeChild(ta);
    }
  }

  async function compartirTexto(t, titulo) {
    if (!t) return;
    if (global.navigator.share) {
      try {
        await global.navigator.share({ title: titulo || "AI Bridge Lite", text: t });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    await copiarTexto(t);
    toast("Copiado al portapapeles");
  }

  /* ============ RENDER DE MENSAJES ============ */
  let chatEnviandoId = null;

  function bajar() {
    const c = $("chat");
    c.scrollTop = c.scrollHeight;
  }

  // Divide el texto en trozos de texto y bloques ``` de código.
  function partirTexto(t) {
    const segs = [];
    const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
    let ult = 0, m;
    while ((m = re.exec(t)) !== null) {
      if (m.index > ult) segs.push({ tipo: "texto", t: t.slice(ult, m.index) });
      segs.push({ tipo: "codigo", lang: m[1].trim(), t: m[2].replace(/\n$/, "") });
      ult = re.lastIndex;
    }
    const resto = t.slice(ult);
    const abierto = resto.indexOf("```");
    if (abierto !== -1) { // bloque sin cerrar (respuesta cortada)
      if (abierto > 0) segs.push({ tipo: "texto", t: resto.slice(0, abierto) });
      const cuerpo = resto.slice(abierto + 3);
      const nl = cuerpo.indexOf("\n");
      segs.push({
        tipo: "codigo",
        lang: nl === -1 ? cuerpo.trim() : cuerpo.slice(0, nl).trim(),
        t: nl === -1 ? "" : cuerpo.slice(nl + 1)
      });
    } else if (resto) {
      segs.push({ tipo: "texto", t: resto });
    }
    return segs;
  }

  function crearCodigo(seg) {
    const lineas = seg.t ? seg.t.split("\n").length : 0;
    const box = document.createElement("div");
    box.className = "codigo" + (lineas <= 15 ? " abierto" : "");

    const cab = document.createElement("div");
    cab.className = "codigo-cab";

    const lang = document.createElement("button");
    lang.type = "button";
    lang.className = "codigo-lang";
    lang.textContent = `${seg.lang || "código"} · ${lineas} ${lineas === 1 ? "línea" : "líneas"}`;

    const copiar = document.createElement("button");
    copiar.type = "button";
    copiar.className = "codigo-copiar";
    copiar.setAttribute("aria-label", "Copiar código");
    copiar.appendChild(icono("copy"));

    const flecha = document.createElement("button");
    flecha.type = "button";
    flecha.className = "codigo-copiar";
    flecha.setAttribute("aria-label", "Mostrar u ocultar código");
    flecha.appendChild(icono("chevron", "flecha"));

    cab.append(lang, copiar, flecha);
    cab.addEventListener("click", async (e) => {
      if (e.target.closest(".codigo-copiar") === copiar) {
        await copiarTexto(seg.t);
        toast("Código copiado");
      } else {
        box.classList.toggle("abierto");
      }
    });

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = seg.t;
    pre.appendChild(code);

    box.append(cab, pre);
    return box;
  }

  function crearBurbuja(texto) {
    const b = document.createElement("div");
    b.className = "burbuja";
    partirTexto(texto).forEach((s) => {
      if (s.tipo === "codigo") {
        b.appendChild(crearCodigo(s));
      } else {
        const t = s.t.replace(/^\n+|\n+$/g, "");
        if (!t) return;
        const d = document.createElement("div");
        d.textContent = t;
        b.appendChild(d);
      }
    });
    return b;
  }

  function botonAccion(nombre, etiqueta, clase) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", etiqueta);
    b.appendChild(icono(nombre, clase));
    return b;
  }

  function crearAcciones(m, chatId, esUltimo) {
    const barra = document.createElement("div");
    barra.className = "acciones";

    const like = botonAccion("like", "Me gusta");
    const dislike = botonAccion("like", "No me gusta", "r180");
    like.classList.toggle("on", m.voto === "like");
    dislike.classList.toggle("on", m.voto === "dislike");

    const votar = (tipo) => {
      m.voto = m.voto === tipo ? null : tipo;
      ob.actualizarMensaje(chatId, m.id, { voto: m.voto });
      like.classList.toggle("on", m.voto === "like");
      dislike.classList.toggle("on", m.voto === "dislike");
    };
    like.addEventListener("click", () => votar("like"));
    dislike.addEventListener("click", () => votar("dislike"));
    barra.append(like, dislike);

    if (esUltimo) {
      const regen = botonAccion("refresh", "Regenerar respuesta");
      regen.addEventListener("click", regenerar);
      barra.appendChild(regen);
    }

    const share = botonAccion("share", "Compartir respuesta");
    share.addEventListener("click", () => compartirTexto(m.texto));
    barra.appendChild(share);
    return barra;
  }

  function crearMensajeEl(m, chatId, esUltimo) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + m.rol + (m.error ? " error" : "");

    if (m.adjuntos.length) {
      const ad = document.createElement("div");
      ad.className = "msg-adj";
      m.adjuntos.forEach((a) => {
        if (a.tipo === "imagen" && a.mini) {
          const im = document.createElement("img");
          im.src = a.mini;
          im.alt = a.nombre;
          im.addEventListener("click", () => abrirVisor(a.mini));
          ad.appendChild(im);
        } else {
          const e = document.createElement("span");
          e.className = "etiqueta-arch";
          e.append(icono(a.tipo === "imagen" ? "image" : "file"), document.createTextNode(a.nombre));
          ad.appendChild(e);
        }
      });
      wrap.appendChild(ad);
    }

    if (m.texto) wrap.appendChild(crearBurbuja(m.texto));
    if (m.rol === "ia" && !m.error) wrap.appendChild(crearAcciones(m, chatId, esUltimo));
    else if (m.rol === "ia" && esUltimo) {
      const barra = document.createElement("div");
      barra.className = "acciones";
      const r = botonAccion("refresh", "Reintentar");
      r.addEventListener("click", regenerar);
      barra.appendChild(r);
      wrap.appendChild(barra);
    }
    return wrap;
  }

  function crearEscribiendo() {
    const wrap = document.createElement("div");
    wrap.className = "msg ia";
    const b = document.createElement("div");
    b.className = "burbuja";
    const e = document.createElement("div");
    e.className = "escribiendo";
    for (let i = 0; i < 3; i++) e.appendChild(document.createElement("i"));
    b.appendChild(e);
    wrap.appendChild(b);
    return wrap;
  }

  function renderMensajes(irAlFinal) {
    const cont = $("mensajes");
    cont.textContent = "";

    const id = ob.getChatActivoId();
    const chat = id ? ob.getChat(id) : null;
    const msgs = chat ? chat.mensajes : [];
    const escribiendo = enviando && chatEnviandoId === id;

    $("vacio").hidden = msgs.length > 0 || escribiendo;

    msgs.forEach((m, i) => cont.appendChild(crearMensajeEl(m, id, i === msgs.length - 1)));

    // Mensaje sin respuesta (cancelado o interrumpido): ofrece reintentar.
    const ult = msgs[msgs.length - 1];
    if (ult && ult.rol === "usuario" && !escribiendo) {
      const w = document.createElement("div");
      w.className = "msg usuario";
      const barra = document.createElement("div");
      barra.className = "acciones";
      const r = botonAccion("refresh", "Reintentar");
      r.addEventListener("click", regenerar);
      barra.appendChild(r);
      w.appendChild(barra);
      cont.appendChild(w);
    }

    if (escribiendo) cont.appendChild(crearEscribiendo());
    if (irAlFinal !== false) bajar();
  }

  /* ============ LISTA DE CHATS ============ */
  function renderLista() {
    const cont = $("lista-chats");
    cont.textContent = "";
    const act = ob.getChatActivoId();
    const lista = ob.listarChats().filter((c) => c.total > 0 || c.id === act);

    const grupo = (titulo, items) => {
      if (!items.length) return;
      const g = document.createElement("div");
      g.className = "grupo";
      g.textContent = titulo;
      cont.appendChild(g);
      items.forEach((c) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chat-item" + (c.id === act ? " activo" : "") + (c.fijado ? " fijado" : "");
        const s = document.createElement("span");
        s.className = "chat-titulo";
        s.textContent = c.titulo;
        b.appendChild(s);
        b.addEventListener("click", () => abrirChat(c.id));
        cont.appendChild(b);
      });
    };
    grupo("Fijados", lista.filter((c) => c.fijado));
    grupo("Recientes", lista.filter((c) => !c.fijado));
  }

  function nuevoChat() {
    cancelarEnvio();
    ob.crearChat();
    cerrarPanel();
    cerrarMenus();
    renderMensajes();
    $("entrada").focus();
  }

  function abrirChat(id) {
    cancelarEnvio();
    ob.setChatActivo(id);
    cerrarPanel();
    renderMensajes();
  }

  function fijarChat() {
    const id = ob.getChatActivoId();
    cerrarMenus();
    if (!id) { toast("Aún no hay un chat."); return; }
    const nuevo = !ob.esFijado(id);
    ob.setFijado(id, nuevo);
    toast(nuevo ? "Chat fijado" : "Chat desfijado");
  }

  function borrarChat() {
    const id = ob.getChatActivoId();
    cerrarMenus();
    if (!id) { toast("Aún no hay un chat."); return; }
    if (!global.confirm("¿Borrar este chat? No se puede deshacer.")) return;
    cancelarEnvio();
    ob.borrarChat(id);
    renderMensajes();
    toast("Chat borrado");
  }

  function compartirChat() {
    const id = ob.getChatActivoId();
    cerrarMenus();
    const t = id ? ob.chatATexto(id) : "";
    if (!t) { toast("No hay nada que compartir."); return; }
    compartirTexto(t, "Chat de AI Bridge Lite");
  }

  /* ============ LLAMADAS A LA IA ============ */
  let cancelado = false;

  function construirTexto(p) {
    let t = p.prompt_intencion;
    if (p.script_snippet) t += "\n\n[CÓDIGO]\n" + p.script_snippet;
    (p.archivos || []).forEach((a) => { t += `\n\n[ARCHIVO: ${a.nombre}]\n${a.texto}`; });
    return t;
  }

  // Turnos alternados usuario/ia; el último siempre es el mensaje actual del usuario.
  function turnosDe(p) {
    const lista = (p.historial || []).map((h) => ({ rol: h.rol, texto: h.texto }));
    lista.push({ rol: "usuario", texto: construirTexto(p) });
    const out = [];
    lista.forEach((x) => {
      const u = out[out.length - 1];
      if (u && u.rol === x.rol) u.texto += "\n\n" + x.texto; else out.push({ rol: x.rol, texto: x.texto });
    });
    while (out.length && out[0].rol !== "usuario") out.shift();
    return out;
  }

  function armarPeticion(prov, key, modelo, system, p) {
    const turnos = turnosDe(p);
    const frames = p.modo_secuencia_frames || [];
    const ult = turnos.length - 1;

    if (prov === "gemini") {
      const contents = turnos.map((t, i) => {
        const parts = [{ text: t.texto }];
        if (i === ult) frames.forEach((d) => parts.push({ inlineData: { mimeType: MIME, data: d } }));
        return { role: t.rol === "ia" ? "model" : "user", parts };
      });
      const id = encodeURIComponent(modelo.replace(/^models\//, ""));
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`,
        headers: { "x-goog-api-key": key }, // la key va en header, nunca en la URL
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { maxOutputTokens: MAX_TOKENS }
        }
      };
    }

    if (prov === "claude") {
      const messages = turnos.map((t, i) => {
        if (i !== ult) return { role: t.rol === "ia" ? "assistant" : "user", content: t.texto };
        const content = frames.map((d) => ({ type: "image", source: { type: "base64", media_type: MIME, data: d } }));
        content.push({ type: "text", text: t.texto });
        return { role: "user", content };
      });
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: { model: modelo, max_tokens: MAX_TOKENS, system, messages }
      };
    }

    const messages = [{ role: "system", content: system }];
    turnos.forEach((t, i) => {
      if (i !== ult) { messages.push({ role: t.rol === "ia" ? "assistant" : "user", content: t.texto }); return; }
      const content = [{ type: "text", text: t.texto }];
      frames.forEach((d) => content.push({ type: "image_url", image_url: { url: `data:${MIME};base64,${d}` } }));
      messages.push({ role: "user", content });
    });
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}` },
      body: { model: modelo, max_completion_tokens: MAX_TOKENS, messages }
    };
  }

  function parsearRespuesta(prov, data) {
    if (prov === "nativa") return data.texto || data.text || "";
    if (prov === "gemini") {
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts) || [];
      return parts.map((p) => p.text || "").join("");
    }
    if (prov === "claude") return (data.content || []).map((c) => c.text || "").join("");
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
      status === 400 ? "Petición rechazada (revisa el modelo o la cantidad y tamaño de las imágenes)." :
      status === 401 || status === 403 ? "API Key inválida o sin permisos." :
      status === 404 ? "Modelo no encontrado. En Ajustes elige otro o usa «Otro» con el nombre exacto." :
      status === 413 ? "Demasiado contenido. Envía menos imágenes o archivos." :
      status === 429 ? "Límite de uso alcanzado. Espera un momento." :
      status >= 500 ? "El servidor de IA tiene problemas. Intenta más tarde." :
      `Error del servidor (${status}).`;
    return detalle ? `${base}\n${detalle}` : base;
  }

  async function llamarIA(cfg, payload, signal) {
    let req, prov;
    if (cfg.modo === "nativa") {
      prov = "nativa";
      req = {
        url: NATIVE_ENDPOINT,
        headers: {},
        body: Object.assign({}, payload, { idioma: cfg.idioma, areas: cfg.areas })
      };
    } else {
      prov = payload.proveedor;
      let system = SYSTEM[payload.perfil_seleccionado] || SYSTEM.hibrido;
      system += ` Responde en ${IDIOMA_IA[cfg.idioma] || "español"}.`;
      system += " Entrega el código dentro de bloques ``` indicando el lenguaje.";
      if (cfg.areas.length) system += ` Áreas de enfoque del usuario: ${cfg.areas.join(", ")}.`;
      req = armarPeticion(prov, payload.api_key_usuario, ob.getModeloId(prov), system, payload);
    }

    let resp;
    try {
      resp = await fetch(req.url, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, req.headers),
        body: JSON.stringify(req.body),
        signal
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
    const texto = parsearRespuesta(prov, data);
    if (!texto.trim()) throw new Error("La IA no devolvió texto.");
    return texto;
  }

  /* ============ ENVÍO ============ */
  function verificarListo() {
    const cfg = ob.getConfig();
    if (cfg.modo === "nativa" && !NATIVE_ENDPOINT) {
      toast("La IA nativa aún no está conectada. Usa tu API Key en Ajustes.", 3500);
      abrirAjustes(false);
      return false;
    }
    const l = ob.listoParaEnviar();
    if (l.ok) return true;
    const t = {
      limite: "Llegaste al límite semanal de la IA nativa. Usa tu API Key o espera al lunes.",
      sin_key: "Falta tu API Key. Configúrala en Ajustes.",
      sin_modelo: "Elige un modelo en Ajustes."
    }[l.motivo];
    toast(t, 3500);
    abrirAjustes(false);
    return false;
  }

  function cancelarEnvio() {
    if (enviando && abortActual) {
      cancelado = true;
      abortActual.abort();
    }
  }

  async function responder(chatId, msgId) {
    const chat = ob.getChat(chatId);
    if (!chat) return;
    const idx = chat.mensajes.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    const msg = chat.mensajes[idx];
    const cfg = ob.getConfig();

    const historial = chat.mensajes.slice(0, idx)
      .filter((m) => !m.error)
      .map((m) => ({ rol: m.rol, texto: m.texto }));

    let datos = cacheEnvios.get(msgId);
    if (!datos) {
      datos = { texto: msg.texto, snippet: "", archivos: [], frames: [] };
      if (msg.adjuntos.length) toast("Los adjuntos no se conservan al cerrar la app; se reenvía solo el texto.", 3500);
    }

    const payload = ob.buildPayload({
      perfil_seleccionado: cfg.perfil,
      prompt_intencion: datos.texto || "Analiza los adjuntos.",
      script_snippet: datos.snippet,
      archivos: datos.archivos,
      modo_secuencia_frames: datos.frames,
      historial
    });
    if (!payload) { toast("No se pudo preparar la consulta."); renderMensajes(); return; }

    enviando = true;
    cancelado = false;
    chatEnviandoId = chatId;
    if (cfg.modo === "nativa") ob.registrarUsoNativa(1);
    actualizarEnviar();
    renderEstado();
    renderMensajes();

    const ctrl = new AbortController();
    abortActual = ctrl;
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let ok = false;

    try {
      const texto = await llamarIA(cfg, payload, ctrl.signal);
      ob.agregarMensaje(chatId, { rol: "ia", texto });
      ok = true;
    } catch (e) {
      if (!cancelado) ob.agregarMensaje(chatId, { rol: "ia", texto: "⚠ " + e.message, error: true });
    } finally {
      clearTimeout(timer);
      abortActual = null;
      enviando = false;
      chatEnviandoId = null;
      if (!ok && cfg.modo === "nativa") ob.devolverUsoNativa(1);
      actualizarEnviar();
      renderEstado();
      if (ob.getChatActivoId() === chatId) renderMensajes();
    }
  }

  async function enviar() {
    if (enviando) { cancelarEnvio(); return; }

    const texto = $("entrada").value.trim();
    if (!texto && !pendientes.length) return;
    if (!verificarListo()) return;

    cerrarMenus();
    cerrarPanel();

    const imgs = imagenesPendientes();
    const frames = imgs.map((a) => a.dataUrl.slice(a.dataUrl.indexOf(",") + 1));
    const codigos = pendientes.filter((a) => a.tipo === "codigo");
    const archivos = pendientes.filter((a) => a.tipo === "archivo").map((a) => ({ nombre: a.nombre, texto: a.texto }));
    const snippet = codigos.map((c) => `[${c.nombre}]\n${c.texto}`).join("\n\n");

    // Lo que se guarda en el chat: el texto + el código en bloques ``` (se ve colapsable).
    const textoGuardado = (texto + codigos.map((c) => `\n\n\`\`\`${c.nombre}\n${c.texto}\n\`\`\``).join("")).trim();

    const adj = [];
    imgs.slice(0, MINIS_GUARDADAS).forEach((a) => adj.push({ tipo: "imagen", nombre: a.nombre, mini: a.mini }));
    if (imgs.length > MINIS_GUARDADAS) adj.push({ tipo: "archivo", nombre: `+${imgs.length - MINIS_GUARDADAS} imágenes` });
    archivos.forEach((a) => adj.push({ tipo: "archivo", nombre: a.nombre }));

    const chatId = ob.getChatActivoId() || ob.crearChat();
    const msg = ob.agregarMensaje(chatId, { rol: "usuario", texto: textoGuardado, adjuntos: adj });
    if (!msg) { toast("No se pudo guardar el mensaje."); return; }

    cacheEnvios.set(msg.id, { texto, snippet, archivos, frames });
    while (cacheEnvios.size > MAX_CACHE) cacheEnvios.delete(cacheEnvios.keys().next().value);

    $("entrada").value = "";
    pendientes = [];
    autoajustar();
    renderAdjuntos();
    await responder(chatId, msg.id);
  }

  function regenerar() {
    if (enviando) return;
    const id = ob.getChatActivoId();
    if (!id) return;
    if (!verificarListo()) return;

    const msgs = ob.getChat(id).mensajes;
    if (!msgs.length) return;

    let ult = msgs[msgs.length - 1];
    if (ult.rol === "ia") {
      ob.borrarMensaje(id, ult.id);
      msgs.pop();
      ult = msgs[msgs.length - 1];
    }
    if (!ult || ult.rol !== "usuario") { renderMensajes(); return; }
    responder(id, ult.id);
  }

  /* ============ MODO FLOTANTE "AI" ============ */
  function renderModoCaptura() {
    const m = ob.getModoCaptura();
    $$("[data-modo-captura]").forEach((b) => b.classList.toggle("active", b.dataset.modoCaptura === m));
  }

  function elegirModoCaptura(modo) {
    ob.setModoCaptura(modo);
    renderModoCaptura();
    cerrarMenus();

    // Gancho para la app Android nativa (se conectará en el paso del botón flotante).
    const nativo = global.AIBridgeNative || global.AndroidBridge;
    if (nativo && typeof nativo.iniciarFlotante === "function") {
      try { nativo.iniciarFlotante(modo); return; } catch (_) {}
    }
    toast(`${modo === "multi" ? "Multi-Captura" : "Captura"} seleccionado. El botón flotante sobre otras apps requiere la app Android.`, 3800);
  }

  // La app nativa llama a esto para entregar las capturas al chat (data URL o base64).
  async function recibirCapturas(lista) {
    const arr = Array.isArray(lista) ? lista : [lista];
    let libres = ob.limiteImagenes() - imagenesPendientes().length;
    for (const s of arr) {
      if (libres <= 0) break;
      if (typeof s !== "string" || !s) continue;
      const src = s.startsWith("data:") ? s : "data:image/png;base64," + s;
      try {
        const r = await procesarImagen(src);
        pendientes.push({ id: nuevoId(), tipo: "imagen", nombre: "captura", dataUrl: r.dataUrl, mini: r.mini });
        libres--;
      } catch (_) {}
    }
    renderAdjuntos();
    toast("Capturas listas para enviar");
  }
  global.AIBridgeApp = { recibirCapturas };

  /* ============ EVENTOS ============ */
  function enlazarChat() {
    const entrada = $("entrada");
    entrada.maxLength = ob.MAX_PROMPT;
    entrada.addEventListener("input", () => { autoajustar(); actualizarEnviar(); });
    entrada.addEventListener("keydown", (e) => {
      const teclado = global.matchMedia && global.matchMedia("(pointer: fine)").matches;
      if (teclado && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        enviar();
      }
    });
    $("btn-enviar").addEventListener("click", enviar);
    $("btn-mic").addEventListener("click", alternarVoz);

    $("btn-nuevo-chat").addEventListener("click", nuevoChat);
    $("btn-panel-nuevo").addEventListener("click", nuevoChat);

    $("btn-mas").addEventListener("click", () => {
      const id = ob.getChatActivoId();
      $("txt-fijar").textContent = id && ob.esFijado(id) ? "Desfijar chat" : "Fijar chat";
      alternarMenu("btn-mas", "menu-chat");
    });
    $("btn-fijar").addEventListener("click", fijarChat);
    $("btn-compartir-chat").addEventListener("click", compartirChat);
    $("btn-borrar-chat").addEventListener("click", borrarChat);

    $("btn-adjuntar").addEventListener("click", () => alternarMenu("btn-adjuntar", "menu-adjuntar"));
    $("btn-adj-imagen").addEventListener("click", () => { cerrarMenus(); $("file-imagenes").click(); });
    $("btn-adj-archivo").addEventListener("click", () => { cerrarMenus(); $("file-archivos").click(); });
    $("btn-adj-codigo").addEventListener("click", abrirCodigo);

    $("file-imagenes").addEventListener("change", async (e) => {
      await agregarImagenes(e.target.files);
      e.target.value = ""; // permite elegir la misma imagen otra vez
    });
    $("file-archivos").addEventListener("change", async (e) => {
      await agregarArchivos(e.target.files);
      e.target.value = "";
    });

    $("btn-codigo-ok").addEventListener("click", adjuntarCodigo);
    $("btn-codigo-cancelar").addEventListener("click", cerrarCodigo);
    $("btn-codigo-x").addEventListener("click", cerrarCodigo);
    $("modal-codigo").addEventListener("click", (e) => { if (e.target === $("modal-codigo")) cerrarCodigo(); });

    $("btn-modo-flotante").addEventListener("click", () => alternarMenu("btn-modo-flotante", "menu-flotante"));
    $$("[data-modo-captura]").forEach((b) =>
      b.addEventListener("click", () => elegirModoCaptura(b.dataset.modoCaptura)));

    $("visor-cerrar").addEventListener("click", cerrarVisor);
    $("visor").addEventListener("click", (e) => { if (e.target === $("visor")) cerrarVisor(); });

    document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) cerrarMenus(); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("visor").hidden) cerrarVisor();
      else if (!$("modal-codigo").hidden) cerrarCodigo();
      else if (!$("modal-ajustes").hidden) cerrarAjustes();
      else { cerrarMenus(); cerrarPanel(); }
    });

    // Mantiene la barra de entrada sobre el teclado (también en iPhone).
    if (global.visualViewport) {
      const ajustar = () => {
        $("app").style.height = global.visualViewport.height + "px";
        global.scrollTo(0, 0);
      };
      global.visualViewport.addEventListener("resize", ajustar);
      global.visualViewport.addEventListener("scroll", ajustar);
    }
  }

  /* ============ INICIO ============ */
  enlazarAjustes();
  enlazarChat();
  renderModoCaptura();
  renderEstado();
  renderCuenta();
  renderMensajes();
  renderAdjuntos();
  autoajustar();

  if ("serviceWorker" in global.navigator) {
    global.addEventListener("load", () => {
      global.navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // Primera vez: abre Ajustes para elegir motor (puede empezar con la IA nativa).
  if (!ob.isDone()) abrirAjustes(true);

})(window);
