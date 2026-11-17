package com.aibridge.lite.overlay

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
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
 *  - Mantener presionado: vuelve a la app en pantalla completa con las capturas listas para enviar.
 *  - Arrastrar: mueve el botón (se pega al borde más cercano).
 */
class FloatingWidgetService : Service() {

    private lateinit var wm: WindowManager
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var job: Job? = null

    private var bubble: BubbleView? = null
    private var hiddenByApp = false

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
        if (bubble == null) addBubble()
        bubble?.setCount(CaptureBuffer.count())
        return START_NOT_STICKY
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
        v.contentDescription = "AI Bridge: toca para capturar, mantén presionado para volver a la app"
        attachGestures(v, lp)
        v.visibility = if (hiddenByApp) View.GONE else View.VISIBLE
        wm.addView(v, lp)
        bubble = v
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
            restoreApp()
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
                b.visibility = if (hiddenByApp) View.GONE else View.VISIBLE
                b.setBusy(false)
            }
        }
    }

    // ---------- Mantener presionado: volver a la app ----------
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

    /** La app lo llama al entrar (ocultar) y al salir (mostrar) para que el botón no tape el chat. */
    private fun applyHidden(hidden: Boolean) {
        hiddenByApp = hidden
        bubble?.visibility = if (hidden) View.GONE else View.VISIBLE
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    // ---------- Limpieza (sin memory leaks) ----------
    override fun onDestroy() {
        ref = null
        CaptureBuffer.listener = null
        main.removeCallbacksAndMessages(null)
        job?.cancel()
        scope.cancel()
        bubble?.let { try { wm.removeView(it) } catch (_: IllegalArgumentException) {} }
        bubble = null
        super.onDestroy()
    }

    // ---------- Dibujo del botón "AI" (sin mascota) ----------
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

        private val CYAN = Color.parseColor("#00FFCC")
        private val PINK = Color.parseColor("#FF007F")
        private val BG = Color.parseColor("#080B14")
        private val DARK = Color.parseColor("#020205")

        @Volatile
        private var modoActual = MODO_CAPTURA

        @Volatile
        private var ref: WeakReference<FloatingWidgetService>? = null

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

        /** Llamar desde el hilo principal (ciclo de vida de la Activity). */
        fun setHiddenByApp(hidden: Boolean) {
            ref?.get()?.applyHidden(hidden)
        }
    }
}
