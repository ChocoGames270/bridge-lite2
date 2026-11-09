package com.aibridge.lite.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Display
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference

/**
 * Captura de pantalla con MediaProjection -> JPEG liviano en Base64.
 * Mantiene UNA sola proyección y UN solo VirtualDisplay (Android 14+ no permite reusar el token).
 */
class ScreenCaptureService : Service() {

    private val lock = Any()
    private val mutex = Mutex()

    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var projection: MediaProjection? = null
    private var projectionCallback: MediaProjection.Callback? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var latest: Image? = null // último fotograma (se reemplaza solo)
    private var width = 0
    private var height = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        thread = HandlerThread("aibl-capture").also { it.start() }
        handler = Handler(thread!!.looper)
        ref = WeakReference(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        // Siempre promover a foreground primero (si no, Android cierra la app).
        startAsForeground()

        val data = intent?.let { IntentCompat.getParcelableExtra(it, EXTRA_DATA, Intent::class.java) }
        if (data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (projection != null) return START_NOT_STICKY // ya activo

        try {
            setup(intent.getIntExtra(EXTRA_CODE, 0), data)
        } catch (e: Exception) {
            stopSelf()
        }
        return START_NOT_STICKY
    }

    // ---------- Configuración ----------
    private fun setup(code: Int, data: Intent) {
        val mgr = getSystemService(MediaProjectionManager::class.java)
        val mp = mgr.getMediaProjection(code, data)

        val cb = object : MediaProjection.Callback() {
            override fun onStop() {
                stopSelf() // el usuario detuvo la grabación desde el sistema
            }
        }
        mp.registerCallback(cb, handler) // obligatorio ANTES de createVirtualDisplay (Android 14+)
        projection = mp
        projectionCallback = cb

        val (w, h, dpi) = targetSize()
        width = w
        height = h
        val reader = newReader(w, h)
        imageReader = reader
        virtualDisplay = mp.createVirtualDisplay(
            "aibl-capture", w, h, dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface, null, handler
        )
    }

    private fun newReader(w: Int, h: Int): ImageReader =
        ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3).also { r ->
            r.setOnImageAvailableListener({ reader -> onFrame(reader) }, handler)
        }

    private fun onFrame(reader: ImageReader) {
        val img = try {
            reader.acquireLatestImage()
        } catch (e: Exception) {
            null
        } ?: return
        synchronized(lock) {
            latest?.close()
            latest = img
        }
    }

    /** Tamaño reducido (lado mayor <= MAX_SIDE) y par, para bajo peso. */
    @Suppress("DEPRECATION")
    private fun targetSize(): Triple<Int, Int, Int> {
        val dm = DisplayMetrics()
        val display = getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        display.getRealMetrics(dm)
        val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(dm.widthPixels, dm.heightPixels))
        val w = ((dm.widthPixels * scale).toInt() and 1.inv()).coerceAtLeast(2)
        val h = ((dm.heightPixels * scale).toInt() and 1.inv()).coerceAtLeast(2)
        return Triple(w, h, dm.densityDpi)
    }

    /** Si el teléfono rota, se redimensiona el MISMO VirtualDisplay. */
    private fun ensureSize() {
        if (projection == null) return
        val (w, h, dpi) = targetSize()
        if (w == width && h == height) return
        synchronized(lock) {
            latest?.close()
            latest = null
            val old = imageReader
            val reader = newReader(w, h)
            virtualDisplay?.resize(w, h, dpi)
            virtualDisplay?.surface = reader.surface
            imageReader = reader
            old?.setOnImageAvailableListener(null, null)
            old?.close()
            width = w
            height = h
        }
    }

    // ---------- Captura ----------
    private suspend fun grab(): String? {
        ensureSize()
        repeat(20) {
            encodeLatest()?.let { return it }
            delay(50)
        }
        return null
    }

    private fun encodeLatest(): String? {
        val bytes = synchronized(lock) {
            val img = latest ?: return null
            toJpeg(img)
        }
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    private fun toJpeg(image: Image): ByteArray {
        val plane = image.planes[0]
        val pixelStride = plane.pixelStride
        val rowPadding = plane.rowStride - pixelStride * image.width
        val fullW = image.width + rowPadding / pixelStride

        val full = Bitmap.createBitmap(fullW, image.height, Bitmap.Config.ARGB_8888)
        var cropped: Bitmap? = null
        try {
            plane.buffer.rewind()
            full.copyPixelsFromBuffer(plane.buffer)
            cropped = if (fullW != image.width)
                Bitmap.createBitmap(full, 0, 0, image.width, image.height) else full
            val out = ByteArrayOutputStream(64 * 1024)
            cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            return out.toByteArray()
        } finally {
            if (cropped != null && cropped !== full) cropped.recycle()
            full.recycle()
        }
    }

    private suspend fun captureOne(): String? =
        withContext(Dispatchers.Default) { mutex.withLock { grab() } }

    private suspend fun captureBurst(count: Int, intervalMs: Long): List<String> =
        withContext(Dispatchers.Default) {
            mutex.withLock {
                val n = count.coerceIn(3, 5)
                val list = ArrayList<String>(n)
                repeat(n) { i ->
                    grab()?.let { list.add(it) }
                    if (i < n - 1) delay(intervalMs)
                }
                list
            }
        }

    // ---------- Notificación ----------
    private fun startAsForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "AI Bridge Lite", NotificationManager.IMPORTANCE_LOW)
        )
        val stop = PendingIntent.getService(
            this, 0,
            Intent(this, ScreenCaptureService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera) // reemplaza por tu ícono
            .setContentTitle("AI Bridge Lite")
            .setContentText("Captura de pantalla lista")
            .setOngoing(true)
            .addAction(0, "Detener", stop)
            .build()

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    // ---------- Limpieza (sin memory leaks) ----------
    override fun onDestroy() {
        ref = null
        synchronized(lock) {
            latest?.close()
            latest = null
        }
        imageReader?.setOnImageAvailableListener(null, null)
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        projectionCallback?.let { projection?.unregisterCallback(it) }
        projection?.stop()
        projection = null
        projectionCallback = null
        thread?.quitSafely()
        thread = null
        handler = null
        super.onDestroy()
    }

    companion object {
        private const val ACTION_STOP = "com.aibridge.lite.STOP_CAPTURE"
        private const val EXTRA_CODE = "code"
        private const val EXTRA_DATA = "data"
        private const val CHANNEL_ID = "aibl_capture"
        private const val NOTIF_ID = 1001
        private const val MAX_SIDE = 720
        private const val JPEG_QUALITY = 60

        @Volatile
        private var ref: WeakReference<ScreenCaptureService>? = null

        fun isRunning(): Boolean = ref?.get() != null

        /** Llamar con el resultado de createScreenCaptureIntent() (resultCode + data). */
        fun start(context: Context, resultCode: Int, data: Intent) {
            val i = Intent(context, ScreenCaptureService::class.java)
                .putExtra(EXTRA_CODE, resultCode)
                .putExtra(EXTRA_DATA, data)
            ContextCompat.startForegroundService(context, i)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ScreenCaptureService::class.java))
        }

        /** Un fotograma JPEG en Base64 (o null si no hay captura activa). */
        suspend fun capture(): String? = ref?.get()?.captureOne()

        /** Modo Secuencia: 3 a 5 fotogramas separados por intervalMs. */
        suspend fun captureSequence(count: Int = 3, intervalMs: Long = 150L): List<String> =
            ref?.get()?.captureBurst(count, intervalMs).orEmpty()
    }
}
