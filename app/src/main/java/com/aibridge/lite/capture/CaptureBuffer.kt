package com.aibridge.lite.capture

/**
 * Memoria temporal de capturas (JPEG en Base64, sin prefijo "data:").
 * Se llena con los toques al botón flotante y se vacía al entregar al chat.
 */
object CaptureBuffer {

    const val MAX = 40 // mismo tope que las imágenes del chat

    private val items = ArrayList<String>()

    /** Se avisa cuando cambia la cantidad (puede llamarse desde cualquier hilo). */
    @Volatile
    var listener: (() -> Unit)? = null

    fun count(): Int = synchronized(this) { items.size }

    fun isFull(): Boolean = count() >= MAX

    /** Agrega hasta llenar el máximo. Devuelve cuántas se guardaron. */
    fun add(frames: List<String>): Int {
        val added = synchronized(this) {
            val free = (MAX - items.size).coerceAtLeast(0)
            val take = frames.take(free)
            items.addAll(take)
            take.size
        }
        listener?.invoke()
        return added
    }

    /** Devuelve todo lo acumulado y deja la memoria vacía. */
    fun drain(): List<String> {
        val out = synchronized(this) {
            val copy = ArrayList(items)
            items.clear()
            copy
        }
        listener?.invoke()
        return out
    }

    fun clear() {
        drain()
    }
}
