package com.aibridge.lite.overlay

import android.annotation.SuppressLint
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.IBinder
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.aibridge.lite.ai.AiClient
import com.aibridge.lite.ai.AiRequest
import com.aibridge.lite.ai.AiResult
import com.aibridge.lite.capture.ScreenCaptureService
import com.aibridge.lite.data.SecureStore
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
 * Widget flotante minimalista [AI] (SYSTEM_ALERT_WINDOW).
 * Al tocarlo abre el menú HUD con la mascota pixel art.
 * Todo se construye por código (sin XML) para facilitar el copiar y pegar.
 */
class FloatingWidgetService : Service() {

    private lateinit var wm: WindowManager
    private lateinit var store: SecureStore
    private lateinit var client: AiClient
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var job: Job? = null

    private var bubble: TextView? = null
    private var menu: View? = null
    private val chips = mutableListOf<Pair<String, TextView>>()

    private var profile = "hibrido"
    private var sequence = false
    private var lastResponse = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        store = SecureStore.get(this)
        client = AiClient(store)
        ref = WeakReference(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (bubble == null) addBubble()
        return START_NOT_STICKY
    }

    // ---------- Botón flotante [AI] ----------
    private fun addBubble() {
        val tv = TextView(this).apply {
            text = "[AI]"
            setTextColor(CYAN)
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            textSize = 14f
            gravity = Gravity.CENTER
            setShadowLayer(8f, 0f, 0f, CYAN)
            background = CutCornerDrawable(BG, CYAN, dp(2).toFloat(), dp(8).toFloat())
        }
        val lp = WindowManager.LayoutParams(
            dp(52), dp(52),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(8)
            y = dp(200)
        }
        attachDrag(tv, lp)
        wm.addView(tv, lp)
        bubble = tv
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun attachDrag(v: View, lp: WindowManager.LayoutParams) {
        val slop = ViewConfiguration.get(this).scaledTouchSlop
        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false

        v.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = lp.x; startY = lp.y
                    touchX = e.rawX; touchY = e.rawY
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - touchX).toInt()
                    val dy = (e.rawY - touchY).toInt()
                    if (abs(dx) > slop || abs(dy) > slop) moved = true
                    if (moved) {
                        val dm = resources.displayMetrics
                        lp.x = (startX + dx).coerceIn(0, dm.widthPixels - lp.width)
                        lp.y = (startY + dy).coerceIn(0, dm.heightPixels - lp.height)
                        wm.updateViewLayout(v, lp)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) openMenu()
                    true
                }
                else -> false
            }
        }
    }

    // ---------- Menú HUD ----------
    private fun openMenu() {
        if (menu != null) return
        val view = buildMenu()
        val lp = WindowManager.LayoutParams(
            (resources.displayMetrics.widthPixels * 0.92f).toInt(),
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dp(48)
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
        wm.addView(view, lp)
        menu = view
        bubble?.visibility = View.GONE
    }

    private fun closeMenu() {
        job?.cancel()
        menu?.let {
            try { wm.removeView(it) } catch (_: IllegalArgumentException) {}
        }
        menu = null
        chips.clear()
        bubble?.visibility = View.VISIBLE
    }

    private fun buildMenu(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = CutCornerDrawable(BG, CYAN, dp(1).toFloat(), dp(14).toFloat())
        }

        // Cabecera: mascota + título + cerrar
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(PixelMascotView(this), LinearLayout.LayoutParams(dp(36), dp(36)))
        header.addView(label("AI BRIDGE", CYAN, 16f, true).apply { setPadding(dp(10), 0, 0, 0) },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(label("✕", PINK, 20f, true).apply {
            setPadding(dp(14), dp(8), dp(4), dp(8))
            setOnClickListener { closeMenu() }
        })
        root.addView(header)

        // Estado
        val status = label("", MUTED, 12f, false).apply { setPadding(0, dp(6), 0, dp(6)) }
        root.addView(status)

        // Perfiles
        val chipRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("visual" to "VISUAL", "script" to "SCRIPT", "hibrido" to "HÍBRIDO", "optimizacion" to "OPTIM.")
            .forEach { (id, text) ->
                val chip = label(text, MUTED, 11f, true).apply {
                    gravity = Gravity.CENTER
                    minHeight = dp(40)
                    background = GradientDrawable().apply {
                        cornerRadius = dp(2).toFloat()
                        setStroke(dp(1), CYAN_DIM)
                    }
                    setOnClickListener { profile = id; refreshChips() }
                }
                chips.add(id to chip)
                chipRow.addView(chip, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    .apply { marginEnd = dp(4) })
            }
        root.addView(chipRow)
        refreshChips()

        // Prompt
        val input = EditText(this).apply {
            hint = "Escribe tu intención o consulta..."
            setHintTextColor(MUTED)
            setTextColor(TEXT)
            typeface = Typeface.MONOSPACE
            textSize = 14f
            minLines = 3
            maxLines = 4
            gravity = Gravity.TOP or Gravity.START
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                    InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setPadding(dp(10), dp(10), dp(10), dp(10))
            background = GradientDrawable().apply {
                setColor(DARK)
                cornerRadius = dp(2).toFloat()
                setStroke(dp(1), CYAN_DIM)
            }
        }
        root.addView(input, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = dp(10) })

        // Modo Secuencia
        val seq = CheckBox(this).apply {
            text = "Modo Secuencia (3 fotogramas)"
            setTextColor(TEXT)
            typeface = Typeface.MONOSPACE
            textSize = 12f
            minHeight = dp(48)
            isChecked = sequence
            setOnCheckedChangeListener { _, checked -> sequence = checked }
        }
        root.addView(seq)

        // Respuesta
        val out = label("Esperando consulta...", TEXT, 13f, false).apply { setTextIsSelectable(true) }
        val scroll = ScrollView(this).apply {
            setPadding(dp(10), dp(8), dp(10), dp(8))
            background = GradientDrawable().apply {
                setColor(DARK)
                cornerRadius = dp(2).toFloat()
                setStroke(dp(1), CYAN_DIM)
            }
            addView(out)
        }

        // Botones
        val send = neonButton("ENVIAR", CYAN)
        val copy = neonButton("COPIAR", PINK)
        send.setOnClickListener {
            val prompt = input.text.toString().trim()
            when {
                store.missingKeyMessage() != null -> { updateStatus(status); out.text = "Configura tu API Key para continuar." }
                prompt.isEmpty() -> out.text = "Escribe una consulta antes de enviar."
                else -> runRequest(prompt, out, send, status)
            }
        }
        copy.setOnClickListener {
            if (lastResponse.isNotBlank()) {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("AI Bridge", lastResponse))
                Toast.makeText(this, "Copiado", Toast.LENGTH_SHORT).show()
            }
        }
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        buttons.addView(send, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            .apply { marginEnd = dp(8) })
        buttons.addView(copy, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(buttons, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = dp(6); bottomMargin = dp(10) })
        root.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(160)))

        updateStatus(status)
        return root
    }

    // ---------- Lógica de envío ----------
    private fun runRequest(prompt: String, out: TextView, btn: TextView, status: TextView) {
        if (job?.isActive == true) return
        job = scope.launch {
            btn.alpha = 0.4f
            btn.isEnabled = false
            out.text = "Procesando..."
            try {
                val frames = if (profile == "script") emptyList() else grabFrames()
                val res = client.send(AiRequest(perfil = profile, prompt = prompt, framesBase64 = frames))
                when (res) {
                    is AiResult.Success -> { lastResponse = res.text; out.text = res.text }
                    is AiResult.Error -> { lastResponse = ""; out.text = "⚠ ${res.message}" }
                }
            } finally {
                btn.alpha = 1f
                btn.isEnabled = true
                updateStatus(status)
            }
        }
    }

    /** Oculta el overlay para que no salga en la captura y lo restaura siempre. */
    private suspend fun grabFrames(): List<String> {
        if (!ScreenCaptureService.isRunning()) return emptyList()
        setOverlayVisible(false)
        try {
            delay(150)
            return if (sequence) ScreenCaptureService.captureSequence(3, 150L)
            else listOfNotNull(ScreenCaptureService.capture())
        } finally {
            setOverlayVisible(true)
        }
    }

    private fun setOverlayVisible(visible: Boolean) {
        menu?.visibility = if (visible) View.VISIBLE else View.INVISIBLE
    }

    private fun updateStatus(tv: TextView) {
        val missing = store.missingKeyMessage()
        when {
            missing != null -> {
                tv.text = "⚠ $missing\n(Toca aquí para abrir la app)"
                tv.setTextColor(PINK)
                tv.setOnClickListener { openApp() }
            }
            !ScreenCaptureService.isRunning() -> {
                tv.text = "${store.getProvider().id.uppercase()} · sin captura activa (solo texto)"
                tv.setTextColor(MUTED)
                tv.setOnClickListener(null)
                tv.isClickable = false
            }
            else -> {
                tv.text = "${store.getProvider().id.uppercase()} · captura lista"
                tv.setTextColor(CYAN)
                tv.setOnClickListener(null)
                tv.isClickable = false
            }
        }
    }

    private fun openApp() {
        packageManager.getLaunchIntentForPackage(packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ?.let { startActivity(it) }
        closeMenu()
    }

    // ---------- UI helpers ----------
    private fun refreshChips() {
        chips.forEach { (id, tv) ->
            val selected = id == profile
            tv.setTextColor(if (selected) DARK else MUTED)
            (tv.background as? GradientDrawable)?.setColor(if (selected) CYAN else DARK)
        }
    }

    private fun label(text: String, color: Int, size: Float, bold: Boolean) = TextView(this).apply {
        this.text = text
        setTextColor(color)
        textSize = size
        typeface = Typeface.create(Typeface.MONOSPACE, if (bold) Typeface.BOLD else Typeface.NORMAL)
    }

    private fun neonButton(text: String, accent: Int) = label(text, accent, 13f, true).apply {
        gravity = Gravity.CENTER
        minHeight = dp(48)
        letterSpacing = 0.1f
        background = GradientDrawable().apply {
            setColor(DARK)
            cornerRadius = dp(2).toFloat()
            setStroke(dp(2), accent)
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    // ---------- Limpieza (sin memory leaks) ----------
    override fun onDestroy() {
        ref = null
        job?.cancel()
        scope.cancel()
        menu?.let { try { wm.removeView(it) } catch (_: IllegalArgumentException) {} }
        bubble?.let { try { wm.removeView(it) } catch (_: IllegalArgumentException) {} }
        menu = null
        bubble = null
        chips.clear()
        super.onDestroy()
    }

    // ---------- Dibujos ----------
    /** Tarjeta HUD con esquina superior derecha cortada. */
    private class CutCornerDrawable(
        fill: Int, stroke: Int, private val strokeW: Float, private val cut: Float
    ) : Drawable() {
        private val pf = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = fill }
        private val ps = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; color = stroke; strokeWidth = strokeW
        }
        private val path = Path()

        override fun onBoundsChange(b: Rect) {
            val h = strokeW / 2f
            path.reset()
            path.moveTo(b.left + h, b.top + h)
            path.lineTo(b.right - cut, b.top + h)
            path.lineTo(b.right - h, b.top + cut)
            path.lineTo(b.right - h, b.bottom - h)
            path.lineTo(b.left + h, b.bottom - h)
            path.close()
        }

        override fun draw(canvas: Canvas) {
            canvas.drawPath(path, pf)
            canvas.drawPath(path, ps)
        }

        override fun setAlpha(alpha: Int) {}
        override fun setColorFilter(colorFilter: ColorFilter?) {}
        @Suppress("DEPRECATION")
        override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
    }

    /** Mascota pixel art (misma cuadrícula 24x24 del SVG de la web). */
    private class PixelMascotView(context: Context) : View(context) {
        private val paint = Paint() // sin antialias: pixel art nítido
        private val colors = intArrayOf(CYAN, PINK, DARK)

        // x, y, ancho, alto, color (0 cian, 1 fucsia, 2 oscuro)
        private val rects = arrayOf(
            intArrayOf(11, 1, 2, 3, 0), intArrayOf(10, 0, 4, 1, 0),
            intArrayOf(4, 4, 16, 12, 1), intArrayOf(2, 7, 2, 6, 0),
            intArrayOf(20, 7, 2, 6, 0), intArrayOf(6, 6, 12, 8, 2),
            intArrayOf(8, 8, 3, 2, 1), intArrayOf(13, 8, 3, 2, 1),
            intArrayOf(9, 11, 6, 1, 0), intArrayOf(5, 18, 3, 4, 0),
            intArrayOf(16, 18, 3, 4, 0), intArrayOf(4, 21, 2, 2, 1),
            intArrayOf(18, 21, 2, 2, 1)
        )

        override fun onDraw(canvas: Canvas) {
            val s = minOf(width, height) / 24f
            for (r in rects) {
                paint.color = colors[r[4]]
                canvas.drawRect(r[0] * s, r[1] * s, (r[0] + r[2]) * s, (r[1] + r[3]) * s, paint)
            }
        }
    }

    companion object {
        private val CYAN = Color.parseColor("#00FFCC")
        private val CYAN_DIM = Color.parseColor("#4400FFCC")
        private val PINK = Color.parseColor("#FF007F")
        private val BG = Color.parseColor("#080B14")
        private val DARK = Color.parseColor("#020205")
        private val TEXT = Color.parseColor("#E0FBFC")
        private val MUTED = Color.parseColor("#8CA3AF")

        @Volatile
        private var ref: WeakReference<FloatingWidgetService>? = null

        fun isRunning(): Boolean = ref?.get() != null

        /** Requiere el permiso "Mostrar sobre otras apps" ya concedido. */
        fun start(context: Context) {
            context.startService(Intent(context, FloatingWidgetService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, FloatingWidgetService::class.java))
        }
    }
}
