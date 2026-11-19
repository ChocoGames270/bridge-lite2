/* AI Bridge Lite - Chat mini (Repo 2)
   Se carga SOLO dentro de la ventana flotante de la app Android (existe window.AndroidMini).
   En el navegador normal no hace nada. */
(function (global) {
  "use strict";

  const M = global.AndroidMini;
  if (!M || global.__aiblMini) return;
  global.__aiblMini = true;

  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);

  document.documentElement.classList.add("mini");

  /* ---------- Estilos compactos ---------- */
  const st = document.createElement("style");
  st.textContent = [
    "html.mini #btn-menu, html.mini #btn-mas, html.mini #btn-modo-flotante, html.mini #btn-mic,",
    "html.mini #btn-adj-imagen, html.mini #btn-adj-archivo { display: none !important; }",
    "html.mini .top { padding-top: 4px; padding-bottom: 4px; }",
    "html.mini .top-der { gap: 0; }",
    "html.mini .top .btn-ic { width: 36px; height: 36px; }",
    "html.mini .chip-estado { margin-top: 4px; font-size: 0.68rem; }",
    "html.mini .chat { padding: 6px 8px 10px; }",
    "html.mini .vacio { padding: 8px 0; }",
    "html.mini .logo-ai { width: 48px; height: 48px; font-size: 1.3rem; margin-bottom: 8px; }",
    "html.mini .composer { padding: 6px 8px 8px; }",
    "html.mini .burbuja { font-size: 0.85rem; padding: 8px 10px; }"
  ].join("\n");
  document.head.appendChild(st);

  /* ---------- Portapapeles nativo (el del WebView falla en ventanas flotantes) ---------- */
  try {
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (t) => {
          try { M.copiar(String(t)); return Promise.resolve(); } catch (e) { return Promise.reject(e); }
        }
      }
    });
  } catch (_) {}

  /* ---------- Aviso breve ---------- */
  let tAviso = null;
  function aviso(t) {
    const el = $("toast");
    if (!el) return;
    el.textContent = t;
    el.hidden = false;
    clearTimeout(tAviso);
    tAviso = setTimeout(() => { el.hidden = true; }, 1600);
  }

  /* ---------- Iconos y botones ---------- */
  function iconoPath(d) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "ic");
    svg.setAttribute("viewBox", "0 0 24 24");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
    return svg;
  }

  function iconoUse(nombre) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "ic");
    const u = document.createElementNS(NS, "use");
    u.setAttribute("href", "#i-" + nombre);
    svg.appendChild(u);
    return svg;
  }

  function boton(etiqueta, icono, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-ic";
    b.setAttribute("aria-label", etiqueta);
    b.appendChild(icono);
    b.addEventListener("click", fn);
    return b;
  }

  const der = document.querySelector(".top-der");
  if (der) {
    der.appendChild(boton("Minimizar", iconoPath("M5 12h14"), () => M.minimizar()));
    der.appendChild(boton("Abrir en pantalla completa",
      iconoPath("M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"), () => M.salir()));
  }

  /* ---------- Botón "copiar" en cada respuesta ---------- */
  function textoDe(burbuja) {
    const partes = [];
    burbuja.childNodes.forEach((n) => {
      if (n.classList && n.classList.contains("codigo")) {
        const cab = n.querySelector(".codigo-lang");
        const pre = n.querySelector("pre");
        let lang = cab ? cab.textContent.split(" · ")[0] : "";
        if (lang === "código") lang = "";
        partes.push("```" + lang + "\n" + (pre ? pre.textContent : "") + "\n```");
      } else {
        partes.push(n.textContent);
      }
    });
    return partes.join("\n\n").trim();
  }

  function decorar() {
    document.querySelectorAll("#mensajes .msg.ia .acciones").forEach((barra) => {
      if (barra.dataset.copia) return;
      barra.dataset.copia = "1";
      const msg = barra.closest(".msg");
      const burbuja = msg ? msg.querySelector(".burbuja") : null;
      if (!burbuja) return;

      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", "Copiar respuesta");
      b.appendChild(iconoUse("copy"));
      b.addEventListener("click", () => {
        try { M.copiar(textoDe(burbuja)); aviso("Copiado"); } catch (_) {}
      });
      barra.appendChild(b);
    });
  }

  const cont = $("mensajes");
  if (cont) {
    new MutationObserver(decorar).observe(cont, { childList: true, subtree: true });
    decorar();
  }

  /* ---------- Avisar a la app cuando las capturas ya se enviaron o se quitaron todas ---------- */
  const adj = $("adjuntos");
  if (adj) {
    let tuvo = false;
    new MutationObserver(() => {
      const n = adj.querySelectorAll(".adjunto").length;
      if (n > 0) {
        tuvo = true;
      } else if (tuvo) {
        tuvo = false;
        try { M.enviadas(); } catch (_) {}
      }
    }).observe(adj, { childList: true });
  }
})(window);
