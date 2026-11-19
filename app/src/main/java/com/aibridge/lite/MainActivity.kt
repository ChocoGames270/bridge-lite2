package com.aibridge.lite

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.aibridge.lite.capture.CaptureBuffer
import com.aibridge.lite.capture.ScreenCaptureService
import com.aibridge.lite.overlay.FloatingWidgetService
import org.json.JSONObject

/**
 * Contenedor nativo del chat (WebView en pantalla completa).
 *  - El chat llama a AndroidBridge.iniciarFlotante(modo): se piden los permisos, se activa la captura,
 *    aparece el botón flotante "AI" y la app se minimiza.
 *  - Al abrir la app en pantalla completa, el modo captura se cierra y las capturas sin enviar
 *    se entregan al chat.
 */
class MainActivity : ComponentActivity() {

    private enum class Paso { NINGUNO, OVERLAY, CAPTURA }

    private lateinit var webView: WebView
    private var paginaLista = false

    private var pendienteModo: String? = null
    private var paso = Paso.NINGUNO

    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // ---------- Resultados de actividades ----------
    private val captureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
            if (paso == Paso.CAPTURA) {
                val data = r.data
                if (r.resultCode == RESULT_OK && data != null) {
                    ScreenCaptureService.start(this, r.resultCode, data)
                    esperarCaptura(10)
                } else {
                    cancelarFlujo("Permiso de captura cancelado.")
                }
            }
        }

    private val notifLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { lanzarCaptura() }

    private val fileLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
            val cb = filePathCallback
            filePathCallback = null
            cb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        }

    // ---------- Ciclo de vida ----------
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        webView = WebView(this).apply {
            setBackgroundColor(DARK)
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                mediaPlaybackRequiresUserGesture = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                setSupportZoom(false)
                builtInZoomControls = false
                textZoom = 100
            }
            webViewClient = cliente()
            webChromeClient = chrome()
            addJavascriptInterface(Puente(), "AndroidBridge")
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(DARK)
            addView(
                webView,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            )
        }
        // Barras del sistema y teclado: se resuelven aquí (la web no recibe esos insets).
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        ViewCompat.requestApplyInsets(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = manejarAtras()
        })

        webView.loadUrl(APP_URL)
    }

    override fun onStart() {
        super.onStart()

        // Al abrir la app en pantalla completa se cierra el modo captura
        // (las capturas sin enviar se conservan y se entregan al chat).
        if (paso == Paso.NINGUNO &&
            (FloatingWidgetService.isRunning() || ScreenCaptureService.isRunning())
        ) {
            FloatingWidgetService.stop(this)
            ScreenCaptureService.stop(this)
        }

        // Si se usó el chat mini, se recarga para leer lo que se escribió allí.
        if (FloatingWidgetService.miniUsado) {
            FloatingWidgetService.miniUsado = false
            paginaLista = false
            webView.reload()
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        if (paso == Paso.OVERLAY) {
            if (Settings.canDrawOverlays(this)) pasoCaptura()
            else cancelarFlujo("Sin el permiso «Mostrar sobre otras apps» no funciona el botón flotante.")
        }
        entregarSiHay()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    // ---------- WebView ----------
    private fun cliente() = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val u = request.url
            val propia = u.host == APP_HOST && (u.path ?: "").startsWith(APP_PATH)
            if (propia) return false
            if (u.scheme == "http" || u.scheme == "https" || u.scheme == "mailto") {
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) {}
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            paginaLista = false
        }

        override fun onPageFinished(view: WebView, url: String?) {
            paginaLista = url?.startsWith(APP_URL) == true
            entregarSiHay()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                paginaLista = false
                view.loadDataWithBaseURL(null, ERROR_HTML, "text/html", "UTF-8", null)
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
            runOnUiThread { recreate() }
            return true
        }
    }

    private fun chrome() = object : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams
        ): Boolean {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = callback
            return try {
                fileLauncher.launch(params.createIntent())
                true
            } catch (_: Exception) {
                filePathCallback = null
                callback.onReceiveValue(null)
                false
            }
        }

        override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            AlertDialog.Builder(this@MainActivity)
                .setMessage(message)
                .setPositiveButton("Aceptar") { _, _ -> result.confirm() }
                .setNegativeButton("Cancelar") { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }
                .show()
            return true
        }

        override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            AlertDialog.Builder(this@MainActivity)
                .setMessage(message)
                .setPositiveButton("Aceptar") { _, _ -> result.confirm() }
                .setOnCancelListener { result.confirm() }
                .show()
            return true
        }
    }

    /** Atrás: cierra paneles/menús/modales del chat; si no hay ninguno abierto, minimiza la app. */
    private fun manejarAtras() {
        val js = "(function(){var g=function(i){return document.getElementById(i)};" +
                "var o=!!document.querySelector('#panel.abierto')||!g('modal-ajustes').hidden||" +
                "!g('modal-codigo').hidden||!g('visor').hidden||!g('menu-chat').hidden||" +
                "!g('menu-adjuntar').hidden||!g('menu-flotante').hidden;" +
                "if(o){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));}return o;})()"
        webView.evaluateJavascript(js) { r -> if (r != "true") moveTaskToBack(true) }
    }

    // ---------- Puente JS -> Android ----------
    private inner class Puente {
        @JavascriptInterface
        fun iniciarFlotante(modo: String) {
            val m = if (modo == FloatingWidgetService.MODO_MULTI) FloatingWidgetService.MODO_MULTI
            else FloatingWidgetService.MODO_CAPTURA
            runOnUiThread { iniciarFlujo(m) }
        }

        @JavascriptInterface
        fun detenerFlotante() {
            runOnUiThread {
                FloatingWidgetService.stop(this@MainActivity)
                ScreenCaptureService.stop(this@MainActivity)
                CaptureBuffer.clear()
            }
        }

        @JavascriptInterface
        fun estado(): String = JSONObject()
            .put("flotante", FloatingWidgetService.isRunning())
            .put("captura", ScreenCaptureService.isRunning())
            .put("capturas", CaptureBuffer.count())
            .toString()
    }

    // ---------- Flujo: permisos -> captura -> botón flotante ----------
    private fun iniciarFlujo(modo: String) {
        pendienteModo = modo
        if (!Settings.canDrawOverlays(this)) {
            paso = Paso.OVERLAY
            toast("Activa «Mostrar sobre otras apps» para AI Bridge Lite y vuelve.")
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            return
        }
        pasoCaptura()
    }

    private fun pasoCaptura() {
        val modo = pendienteModo ?: return
        if (ScreenCaptureService.isRunning()) {
            terminarFlujo(modo)
            return
        }
        paso = Paso.CAPTURA
        val needsNotif = Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        if (needsNotif) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) else lanzarCaptura()
    }

    private fun lanzarCaptura() {
        if (paso != Paso.CAPTURA) return
        val mgr = getSystemService(MediaProjectionManager::class.java)
        captureLauncher.launch(mgr.createScreenCaptureIntent())
    }

    private fun esperarCaptura(intentos: Int) {
        val modo = pendienteModo ?: return
        when {
            ScreenCaptureService.isRunning() -> terminarFlujo(modo)
            intentos <= 0 -> cancelarFlujo("No se pudo activar la captura.")
            else -> webView.postDelayed({ esperarCaptura(intentos - 1) }, 300)
        }
    }

    private fun terminarFlujo(modo: String) {
        paso = Paso.NINGUNO
        pendienteModo = null
        FloatingWidgetService.start(this, modo)
        toast("Botón AI listo: toca para capturar, mantén presionado para el menú.")
        moveTaskToBack(true) // volver al juego o app de trabajo
    }

    private fun cancelarFlujo(mensaje: String) {
        paso = Paso.NINGUNO
        pendienteModo = null
        toast(mensaje)
    }

    // ---------- Entrega de capturas al chat ----------
    /** Si hay capturas acumuladas y el chat está cargado, se las pasa (de 3 en 3 para no saturar). */
    private fun entregarSiHay() {
        if (!paginaLista || CaptureBuffer.count() == 0) return
        val frames = CaptureBuffer.drain()
        if (frames.isEmpty()) return
        frames.chunked(3).forEach { grupo ->
            val lista = grupo.joinToString(",", "[", "]") { "\"data:image/jpeg;base64,$it\"" }
            webView.evaluateJavascript(
                "window.AIBridgeApp&&window.AIBridgeApp.recibirCapturas($lista);", null
            )
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    companion object {
        /** La app de fondo (servicio) lo envía al volver; la entrega real ocurre en onResume. */
        const val EXTRA_ENTREGAR = "entregar_capturas"

        const val APP_URL = "https://chocogames270.github.io/bridge-lite2/"
        const val APP_HOST = "chocogames270.github.io"
        const val APP_PATH = "/bridge-lite2"
        private val DARK = Color.parseColor("#020205")

        private const val ERROR_HTML =
            "<html><body style=\"background:#020205;color:#e0fbfc;font-family:monospace;" +
                    "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
                    "height:100vh;margin:0;text-align:center;padding:24px\">" +
                    "<h2 style=\"color:#00ffcc\">AI BRIDGE</h2>" +
                    "<p>No se pudo cargar la app. Revisa tu conexión.</p>" +
                    "<p><a style=\"color:#ff007f\" href=\"https://chocogames270.github.io/bridge-lite2/\">REINTENTAR</a></p>" +
                    "</body></html>"
    }
}
