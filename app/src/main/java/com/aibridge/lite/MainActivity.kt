package com.aibridge.lite

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.aibridge.lite.capture.ScreenCaptureService
import com.aibridge.lite.data.Provider
import com.aibridge.lite.data.SecureStore
import com.aibridge.lite.overlay.FloatingWidgetService

/** Pantalla de configuración: proveedor, API Key (BYOK), permisos, captura y widget. */
class MainActivity : ComponentActivity() {

    private lateinit var store: SecureStore
    private lateinit var status: TextView
    private lateinit var keyInput: EditText
    private lateinit var btnCapture: TextView
    private lateinit var btnWidget: TextView
    private val chips = mutableListOf<Pair<Provider, TextView>>()

    private val captureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
            val data = r.data
            if (r.resultCode == RESULT_OK && data != null) {
                ScreenCaptureService.start(this, r.resultCode, data)
                status.postDelayed({ refresh() }, 700)
            } else {
                toast("Permiso de captura cancelado")
            }
        }

    private val notifLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { launchCapture() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore.get(this)
        setContentView(buildUi())
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    // ---------- UI ----------
    private fun buildUi(): ScrollView {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(24))
        }

        root.addView(label("AI BRIDGE LITE", CYAN, 22f, true))
        root.addView(label("BYOK · tu API Key se guarda cifrada solo en este dispositivo", MUTED, 12f, false)
            .apply { setPadding(0, dp(4), 0, dp(14)) })

        // 1. Proveedor + API Key
        val c1 = card("1 · PROVEEDOR Y API KEY")
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        Provider.values().forEach { p ->
            val chip = label(p.id.uppercase(), MUTED, 12f, true).apply {
                gravity = Gravity.CENTER
                minHeight = dp(44)
                setOnClickListener { store.setProvider(p); refresh() }
            }
            chips.add(p to chip)
            row.addView(chip, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(4) })
        }
        c1.addView(row)

        keyInput = EditText(this).apply {
            setTextColor(TEXT)
            setHintTextColor(MUTED)
            typeface = Typeface.MONOSPACE
            textSize = 14f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD or
                    InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO
            setPadding(dp(10), dp(10), dp(10), dp(10))
            background = box(DARK, CYAN_DIM, 1)
        }
        c1.addView(keyInput, lp().apply { topMargin = dp(10) })
        c1.addView(button("GUARDAR KEY", CYAN) { saveKey() }, lp().apply { topMargin = dp(8) })
        root.addView(c1)

        // 2. Permiso de overlay
        val c2 = card("2 · MOSTRAR SOBRE OTRAS APPS")
        c2.addView(button("CONCEDER PERMISO", PINK) {
            startActivity(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            )
        })
        root.addView(c2)

        // 3. Captura
        val c3 = card("3 · CAPTURA DE PANTALLA")
        btnCapture = button("ACTIVAR CAPTURA", CYAN) { toggleCapture() }
        c3.addView(btnCapture)
        root.addView(c3)

        // 4. Widget
        val c4 = card("4 · WIDGET FLOTANTE [AI]")
        btnWidget = button("MOSTRAR WIDGET", CYAN) { toggleWidget() }
        c4.addView(btnWidget)
        root.addView(c4)

        // Estado
        status = label("", TEXT, 13f, false).apply { setPadding(dp(4), dp(8), dp(4), 0) }
        root.addView(status)

        return ScrollView(this).apply {
            setBackgroundColor(DARK)
            clipToPadding = false
            addView(root)
            ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
                v.setPadding(0, bars.top, 0, bars.bottom)
                insets
            }
        }
    }

    // ---------- Acciones ----------
    private fun saveKey() {
        val p = store.getProvider()
        val raw = keyInput.text.toString().trim()
        when {
            raw.isEmpty() -> { store.setApiKey(p, ""); toast("Key eliminada") }
            raw.length < SecureStore.MIN_KEY_LENGTH -> { toast("La key parece incompleta"); return }
            else -> { store.setApiKey(p, raw); toast("Key guardada") }
        }
        keyInput.setText("") // no dejar la key visible en pantalla
        refresh()
    }

    private fun toggleCapture() {
        if (ScreenCaptureService.isRunning()) {
            ScreenCaptureService.stop(this)
            btnCapture.postDelayed({ refresh() }, 300)
            return
        }
        val needsNotif = Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        if (needsNotif) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) else launchCapture()
    }

    private fun launchCapture() {
        val mgr = getSystemService(MediaProjectionManager::class.java)
        captureLauncher.launch(mgr.createScreenCaptureIntent())
    }

    private fun toggleWidget() {
        if (FloatingWidgetService.isRunning()) {
            FloatingWidgetService.stop(this)
            btnWidget.postDelayed({ refresh() }, 300)
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            toast("Primero concede el permiso del paso 2")
            return
        }
        FloatingWidgetService.start(this)
        moveTaskToBack(true) // volver al entorno de desarrollo
    }

    // ---------- Estado ----------
    private fun refresh() {
        val provider = store.getProvider()
        chips.forEach { (p, tv) ->
            val on = p == provider
            tv.setTextColor(if (on) DARK else MUTED)
            tv.background = box(if (on) CYAN else DARK, CYAN_DIM, 1)
        }
        keyInput.hint = if (store.hasValidKey(provider)) "•••••••• (guardada)" else "Pega tu API Key"

        val overlay = Settings.canDrawOverlays(this)
        val capture = ScreenCaptureService.isRunning()
        val widget = FloatingWidgetService.isRunning()

        btnCapture.text = if (capture) "DETENER CAPTURA" else "ACTIVAR CAPTURA"
        btnWidget.text = if (widget) "OCULTAR WIDGET" else "MOSTRAR WIDGET"

        status.text = buildString {
            append(if (store.hasValidKey(provider)) "✔" else "✖").append(" API Key (${provider.id})\n")
            append(if (overlay) "✔" else "✖").append(" Permiso sobre otras apps\n")
            append(if (capture) "✔" else "·").append(" Captura de pantalla\n")
            append(if (widget) "✔" else "·").append(" Widget [AI]")
            store.missingKeyMessage()?.let { append("\n\n⚠ ").append(it) }
        }
    }

    // ---------- Helpers ----------
    private fun card(title: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(14), dp(12), dp(14), dp(14))
        background = box(BG, CYAN_DIM, 1)
        addView(label(title, CYAN, 12f, true).apply { setPadding(0, 0, 0, dp(10)) })
        layoutParams = lp().apply { bottomMargin = dp(12) }
    }

    private fun button(text: String, accent: Int, onClick: () -> Unit) =
        label(text, accent, 13f, true).apply {
            gravity = Gravity.CENTER
            minHeight = dp(48)
            letterSpacing = 0.1f
            background = box(DARK, accent, 2)
            setOnClickListener { onClick() }
            layoutParams = lp()
        }

    private fun label(text: String, color: Int, size: Float, bold: Boolean) = TextView(this).apply {
        this.text = text
        setTextColor(color)
        textSize = size
        typeface = Typeface.create(Typeface.MONOSPACE, if (bold) Typeface.BOLD else Typeface.NORMAL)
    }

    private fun box(fill: Int, stroke: Int, w: Int) = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(2).toFloat()
        setStroke(dp(w), stroke)
    }

    private fun lp() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
    )

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        private val CYAN = Color.parseColor("#00FFCC")
        private val CYAN_DIM = Color.parseColor("#4400FFCC")
        private val PINK = Color.parseColor("#FF007F")
        private val BG = Color.parseColor("#080B14")
        private val DARK = Color.parseColor("#020205")
        private val TEXT = Color.parseColor("#E0FBFC")
        private val MUTED = Color.parseColor("#8CA3AF")
    }
}
