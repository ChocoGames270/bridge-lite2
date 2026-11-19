package com.aibridge.lite.overlay

import android.annotation.SuppressLint
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.aibridge.lite.MainActivity
import com.aibridge.lite.capture.CaptureBuffer
import com.aibridge.lite.capture.ScreenCaptureService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.lang.ref.WeakReference
import kotlin.math.abs

/**
 * Botón flotante "AI" sobre otras apps (SYSTEM_ALERT_WINDOW).
 *  - Toque rápido: captura (1 fotograma) o ráfaga (5 fotogramas) según el modo; se acumulan en memoria.
 *  - Mantener presionado: menú con CHAT MINI (chat sobre la otra app) y SALIR (IA en pantalla completa).
 *  - Arrastrar: mueve el botón (se pega al borde más cercano).
 *  - Todo el modo se cierra si la captura se detiene o si la app se quita de recientes.
 */
class FloatingWidgetService : Service() {

    private lateinit var wm: WindowManager
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var job: Job? = null

    private var bubble: BubbleView? = null
    private var bubbleLp: WindowManager.LayoutParams? = null

    private var menu: View? = null
    private val cerrarMenuRun = Runnable { cerrarMenu() }

    private var mini: WebView? = null
    private var miniBox: FrameLayout? = null
    private var miniVisible = false
    private var miniListo = false
    private var inyectadas = 0 // cuántas capturas de la memoria ya se pasaron al chat mini

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        ref = WeakReference(this)
        CaptureBuffer.listener = { main.post { bubble?.setCount(CaptureBuffer.count()) } }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        intent?.getStringExtra(EXTRA_MODO)?.let {
            if (it == MODO_CAPTURA || it == MODO_MULTI) modoActual = it
        }
        if (bubble == null) {
            addBubble()
            vigilarCaptura()
        }
        bubble?.setCount(CaptureBuffer.count())
        return START_NOT_STICKY
    }

    // Se quitó la app de recientes: se cierra todo el modo captura.
    override fun onTaskRemoved(rootIntent: Intent?) {
        CaptureBuffer.clear()
        cerrarModo(false)
        super.onTaskRemoved(rootIntent)
    }

    // Si la captura se detiene (por ejemplo desde la notificación), el botón flotante también se cierra.
    private fun vigilarCaptura() {
        scope.launch {
            delay(2500)
            while (true) {
                if (!ScreenCaptureService.isRunning()) {
                    toast("Captura detenida: botón AI cerrado.")
                    stopSelf()
                    break
                }
                delay(1500)
            }
        }
    }

    // ---------- Botón flotante ----------
    private fun addBubble() {
        val v = BubbleView(this)
        val size = dp(56)
        val lp = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = dp(200)
        }
        v.contentDescription = "AI Bridge: toca para capturar, mantén presionado para el menú"
        attachGestures(v, lp)
        v.visibility = if (miniVisible) View.GONE else View.VISIBLE
        wm.addView(v, lp)
        bubble = v
        bubbleLp = lp
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun attachGestures(v: View, lp: WindowManager.LayoutParams) {
        val slop = ViewConfiguration.get(this).scaledTouchSlop
        val longMs = ViewConfiguration.getLongPressTimeout().toLong()
        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false
        var longFired = false

        val longPress = Runnable {
            longFired = true
            v.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            abrirMenu()
        }

        v.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = lp.x; startY = lp.y
                    touchX = e.rawX; touchY = e.rawY
                    moved = false
                    longFired = false
                    main.postDelayed(longPress, longMs)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - touchX).toInt()
                    val dy = (e.rawY - touchY).toInt()
                    if (abs(dx) > slop || abs(dy) > slop) {
                        moved = true
                        main.removeCallbacks(longPress)
                    }
                    if (moved && !longFired) {
                        val dm = resources.displayMetrics
                        lp.x = (startX + dx).coerceIn(0, dm.widthPixels - lp.width)
                        lp.y = (startY + dy).coerceIn(0, dm.heightPixels - lp.height)
                        updateLayoutSafe(v, lp)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    main.removeCallbacks(longPress)
                    if (moved && !longFired) {
                        val dm = resources.displayMetrics
                        lp.x = if (lp.x + lp.width / 2 < dm.widthPixels / 2) 0 else dm.widthPixels - lp.width
                        updateLayoutSafe(v, lp)
                    } else if (!moved && !longFired) {
                        onTap()
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    main.removeCallbacks(longPress)
                    true
                }
                else -> false
            }
        }
    }

    private fun updateLayoutSafe(v: View, lp: WindowManager.LayoutParams) {
        try { wm.updateViewLayout(v, lp) } catch (_: IllegalArgumentException) {}
    }

    // ---------- Toque rápido: capturar ----------
    private fun onTap() {
        cerrarMenu()
        if (job?.isActive == true) return
        if (!ScreenCaptureService.isRunning()) {
            toast("La captura no está activa. Actívala desde la app (botón AI).")
            return
        }
        if (CaptureBuffer.isFull()) {
            toast("Memoria llena (${CaptureBuffer.MAX}). Mantén presionado para enviar.")
            return
        }
        val b = bubble ?: return

        job = scope.launch {
            b.setBusy(true)
            b.visibility = View.INVISIBLE // que el botón no salga en la captura
            try {
                delay(120)
                val frames =
                    if (modoActual == MODO_MULTI) ScreenCaptureService.captureSequence(5, 200L)
                    else listOfNotNull(ScreenCaptureService.capture())
                if (frames.isEmpty()) toast("No se pudo capturar.") else CaptureBuffer.add(frames)
            } finally {
                b.visibility = if (miniVisible) View.GONE else View.VISIBLE
                b.setBusy(false)
            }
        }
    }

    // ---------- Mantener presionado: menú CHAT MINI / SALIR ----------
    private fun abrirMenu() {
        if (menu != null || miniVisible) return
        val bl = bubbleLp ?: return
        val dm = resources.displayMetrics
        val ancho = dp(150)

        val caja = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(6), dp(6), dp(6), dp(6))
            background = GradientDrawable().apply {
                setColor(BG)
                cornerRadius = dp(8).toFloat()
                setStroke(dp(1), CYAN)
            }
        }
        caja.addView(opcion("CHAT MINI", CYAN) { cerrarMenu(); abrirMini() })
        caja.addView(opcion("SALIR", PINK) { cerrarMenu(); cerrarModo(true) })
        caja.setOnTouchListener { _, e ->
            if (e.action == MotionEvent.ACTION_OUTSIDE) { cerrarMenu(); true } else false
        }

        val lp = WindowManager.LayoutParams(
            ancho, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            val izquierda = bl.x + bl.width / 2 < dm.widthPixels / 2
            x = if (izquierda) bl.x + bl.width else bl.x - ancho
            y = bl.y
        }
        try {
            wm.addView(caja, lp)
            menu = caja
            main.postDelayed(cerrarMenuRun, 6000)
        } catch (_: Exception) {}
    }

    private fun opcion(texto: String, color: Int, accion: () -> Unit): TextView =
        TextView(this).apply {
            text = texto
            setTextColor(color)
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            textSize = 14f
            letterSpacing = 0.1f
            gravity = Gravity.CENTER
            minHeight = dp(44)
            setPadding(dp(8), dp(8), dp(8), dp(8))
            background = GradientDrawable().apply {
                setColor(Color.TRANSPARENT)
                cornerRadius = dp(6).toFloat()
                setStroke(dp(1), color)
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(4); bottomMargin = dp(4) }
            setOnClickListener { accion() }
        }

    private fun cerrarMenu() {
        main.removeCallbacks(cerrarMenuRun)
        menu?.let { try { wm.removeView(it) } catch (_: IllegalArgumentException) {} }
        menu = null
    }

    // ---------- Chat mini (el mismo chat, en una ventana sobre la otra app) ----------
    @SuppressLint("SetJavaScriptEnabled")
    private fun crearMini(): FrameLayout {
        val wv = WebView(ContextThemeWrapper(applicationContext, android.R.style.Theme_DeviceDefault)).apply {
            setBackgroundColor(DARK)
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                setSupportZoom(false)
                textZoom = 100
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val u = request.url
                    return !(u.host == MainActivity.APP_HOST && (u.path ?: "").startsWith(MainActivity.APP_PATH))
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    miniListo = true
                    view.evaluateJavascript(INYECTAR_JS, null)
                    inyectarCapturas()
                }
            }
            addJavascriptInterface(PuenteMini(), "AndroidMini")
        }

        val box = FrameLayout(this).apply {
            background = GradientDrawable().apply {
                setColor(DARK)
                cornerRadius = dp(10).toFloat()
                setStroke(dp(2), CYAN)
            }
            setPadding(dp(2), dp(2), dp(2), dp(2))
            addView(wv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }

        mini = wv
        miniBox = box
        miniListo = false
        inyectadas = 0
        wv.loadUrl(MainActivity.APP_URL)
        return box
    }

    private fun abrirMini() {
        if (miniVisible) return
        val box = try {
            miniBox ?: crearMini()
        } catch (_: Exception) {
            toast("No se pudo abrir el chat mini.")
            return
        }
        val dm = resources.displayMetrics
        val lp = WindowManager.LayoutParams(
            (dm.widthPixels * 0.94f).toInt(),
            (dm.heightPixels * 0.52f).toInt(),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dp(8)
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
        try {
            wm.addView(box, lp)
        } catch (_: Exception) {
            toast("No se pudo abrir el chat mini.")
            return
        }
        miniVisible = true
        miniUsado = true
        bubble?.visibility = View.GONE
        mini?.onResume()
        inyectarCapturas()
    }

    private fun minimizarMini() {
        val box = miniBox
        if (box != null && miniVisible) {
            try { wm.removeView(box) } catch (_: IllegalArgumentException) {}
        }
        miniVisible = false
        mini?.onPause()
        bubble?.visibility = View.VISIBLE
    }

    private fun destruirMini() {
        val box = miniBox
        if (box != null && miniVisible) {
            try { wm.removeView(box) } catch (_: IllegalArgumentException) {}
        }
        miniVisible = false
        mini?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        mini = null
        miniBox = null
        miniListo = false
    }

    /** Pasa al chat mini las capturas nuevas (copias; la memoria se vacía solo cuando se envían). */
    private fun inyectarCapturas() {
        val wv = mini ?: return
        if (!miniListo) return
        val todas = CaptureBuffer.snapshot()
        if (inyectadas > todas.size) inyectadas = 0
        val nuevas = todas.drop(inyectadas)
        if (nuevas.isEmpty()) return
        inyectadas = todas.size
        nuevas.chunked(3).forEach { grupo ->
            val lista = grupo.joinToString(",", "[", "]") { "\"data:image/jpeg;base64,$it\"" }
            wv.evaluateJavascript("window.AIBridgeApp&&window.AIBridgeApp.recibirCapturas($lista);", null)
        }
    }

    private inner class PuenteMini {
        @JavascriptInterface
        fun copiar(texto: String) {
            main.post { copiarPortapapeles(texto) }
        }

        @JavascriptInterface
        fun minimizar() {
            main.post { minimizarMini() }
        }

        @JavascriptInterface
        fun salir() {
            main.post { cerrarModo(true) }
        }

        // El chat mini ya envió (o quitó) todas las capturas: se vacía la memoria.
        @JavascriptInterface
        fun enviadas() {
            main.post {
                CaptureBuffer.clear()
                inyectadas = 0
            }
        }
    }

    private fun copiarPortapapeles(t: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("AI Bridge Lite", t))
    }

    // ---------- Salir del modo captura (y abrir la IA en pantalla completa) ----------
    private fun cerrarModo(abrirApp: Boolean) {
        cerrarMenu()
        if (abrirApp) restoreApp()
        ScreenCaptureService.stop(this)
        stopSelf()
    }

    private fun restoreApp() {
        val i = Intent(this, MainActivity::class.java)
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
            .putExtra(MainActivity.EXTRA_ENTREGAR, true)
        try {
            startActivity(i)
        } catch (_: Exception) {
            toast("No se pudo abrir la app.")
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    // ---------- Limpieza ----------
    override fun onDestroy() {
        ref = null
        CaptureBuffer.listener = null
        main.removeCallbacksAndMessages(null)
        job?.cancel()
        scope.cancel()
        cerrarMenu()
        destruirMini()
        bubble?.let { try { wm.removeView(it) } catch (_: IllegalArgumentException) {} }
        bubble = null
        ScreenCaptureService.stop(this)
        super.onDestroy()
    }

    // ---------- Dibujo del botón "AI" ----------
    private class BubbleView(context: Context) : View(context) {
        private val d = resources.displayMetrics.density
        private var count = 0
        private var busy = false

        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = BG }
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2f * d }
        private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        private val badge = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = PINK }
        private val badgeText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = DARK
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        private val rect = RectF()

        fun setCount(n: Int) {
            if (n != count) { count = n; invalidate() }
        }

        fun setBusy(b: Boolean) {
            if (b != busy) { busy = b; invalidate() }
        }

        override fun onDraw(canvas: Canvas) {
            val w = width.toFloat()
            val h = height.toFloat()
            val pad = 6f * d
            rect.set(pad, pad, w - pad, h - pad)

            val accent = if (busy) PINK else CYAN
            stroke.color = accent
            label.color = accent
            label.textSize = h * 0.30f
            label.setShadowLayer(8f, 0f, 0f, accent)

            val r = 10f * d
            canvas.drawRoundRect(rect, r, r, fill)
            canvas.drawRoundRect(rect, r, r, stroke)
            canvas.drawText("AI", rect.centerX(), rect.centerY() - (label.descent() + label.ascent()) / 2f, label)

            if (count > 0) {
                val br = 10f * d
                val cx = w - br
                val cy = br
                canvas.drawCircle(cx, cy, br, badge)
                badgeText.textSize = br * (if (count > 9) 0.95f else 1.2f)
                canvas.drawText(
                    if (count > 99) "99+" else count.toString(),
                    cx, cy - (badgeText.descent() + badgeText.ascent()) / 2f, badgeText
                )
            }
        }
    }

    companion object {
        const val MODO_CAPTURA = "captura"
        const val MODO_MULTI = "multi"
        private const val EXTRA_MODO = "modo"

        // Carga js/mini.js dentro de la ventana del chat mini.
        private const val INYECTAR_JS =
            "(function(){if(window.__aiblMini)return;var s=document.createElement('script');" +
                    "s.src='js/mini.js?v=1';document.body.appendChild(s);})();"

        private val CYAN = Color.parseColor("#00FFCC")
        private val PINK = Color.parseColor("#FF007F")
        private val BG = Color.parseColor("#080B14")
        private val DARK = Color.parseColor("#020205")

        @Volatile
        private var modoActual = MODO_CAPTURA

        @Volatile
        private var ref: WeakReference<FloatingWidgetService>? = null

        /** true si se usó el chat mini: la app principal recarga el chat para leer lo que se escribió ahí. */
        @Volatile
        var miniUsado = false

        fun isRunning(): Boolean = ref?.get() != null

        /** Requiere el permiso "Mostrar sobre otras apps" ya concedido. */
        fun start(context: Context, modo: String = MODO_CAPTURA) {
            context.startService(
                Intent(context, FloatingWidgetService::class.java).putExtra(EXTRA_MODO, modo)
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, FloatingWidgetService::class.java))
        }
    }
}
