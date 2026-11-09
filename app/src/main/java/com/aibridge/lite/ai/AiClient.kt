package com.aibridge.lite.ai

import com.aibridge.lite.data.Provider
import com.aibridge.lite.data.SecureStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext

/** Datos de entrada (equivalen al payload.schema.json). */
data class AiRequest(
    val perfil: String = "hibrido",
    val prompt: String,
    val scriptSnippet: String? = null,
    val objetoProperties: JSONObject? = null,
    val framesBase64: List<String> = emptyList() // JPEG en Base64 (sin prefijo data:)
)

sealed class AiResult {
    data class Success(val text: String) : AiResult()
    data class Error(val message: String, val code: Int = 0) : AiResult()
}

/**
 * Cliente HTTP directo a Gemini, Claude y OpenAI (sin intermediarios).
 * La key viaja solo en headers y nunca se imprime en logs ni en errores.
 */
class AiClient(private val store: SecureStore) {

    suspend fun send(req: AiRequest): AiResult = withContext(Dispatchers.IO) {
        store.missingKeyMessage()?.let { return@withContext AiResult.Error(it, 401) }

        val provider = store.getProvider()
        val key = store.getActiveApiKey()
            ?: return@withContext AiResult.Error("Falta tu API Key.", 401)

        val prompt = req.prompt.trim().take(MAX_PROMPT)
        if (prompt.isEmpty()) return@withContext AiResult.Error("Escribe una consulta antes de enviar.")

        val frames = req.framesBase64.take(MAX_FRAMES)
        val userText = buildUserText(req, prompt)
        val system = systemFor(req.perfil)

        val (url, headers, body) = when (provider) {
            Provider.GEMINI -> Triple(
                "https://generativelanguage.googleapis.com/v1beta/models/$GEMINI_MODEL:generateContent",
                mapOf("x-goog-api-key" to key),
                geminiBody(system, userText, frames)
            )
            Provider.CLAUDE -> Triple(
                "https://api.anthropic.com/v1/messages",
                mapOf("x-api-key" to key, "anthropic-version" to "2023-06-01"),
                claudeBody(system, userText, frames)
            )
            Provider.OPENAI -> Triple(
                "https://api.openai.com/v1/chat/completions",
                mapOf("Authorization" to "Bearer $key"),
                openAiBody(system, userText, frames)
            )
        }

        post(provider, url, headers, body)
    }

    // ---------- HTTP ----------
    private suspend fun post(
        provider: Provider,
        url: String,
        headers: Map<String, String>,
        body: JSONObject
    ): AiResult {
        val conn = URL(url).openConnection() as HttpURLConnection
        // Si la corrutina se cancela, se corta la conexión (evita hilos colgados).
        val handle = coroutineContext.job.invokeOnCompletion { cause ->
            if (cause is CancellationException) conn.disconnect()
        }
        return try {
            val bytes = body.toString().toByteArray(Charsets.UTF_8)
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            conn.setFixedLengthStreamingMode(bytes.size) // sin copia extra en memoria
            conn.outputStream.use { it.write(bytes) }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val raw = stream?.let { readCapped(it) }.orEmpty()

            if (code in 200..299) {
                val text = parse(provider, raw)
                if (text.isBlank()) AiResult.Error("La IA no devolvió texto.", code)
                else AiResult.Success(text)
            } else {
                AiResult.Error(friendlyError(code, raw), code)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: java.net.SocketTimeoutException) {
            AiResult.Error("Tiempo de espera agotado. Intenta de nuevo.")
        } catch (e: java.io.IOException) {
            AiResult.Error("Sin conexión con el servidor de IA.")
        } catch (e: Exception) {
            AiResult.Error("Error inesperado: ${e.javaClass.simpleName}")
        } finally {
            handle.dispose()
            conn.disconnect()
        }
    }

    private fun readCapped(input: InputStream): String {
        val out = StringBuilder()
        input.bufferedReader(Charsets.UTF_8).use { r ->
            val buf = CharArray(8192)
            while (out.length < MAX_RESPONSE_CHARS) {
                val n = r.read(buf)
                if (n < 0) break
                out.append(buf, 0, n)
            }
        }
        return out.toString()
    }

    // ---------- Cuerpos por proveedor ----------
    private fun geminiBody(system: String, text: String, frames: List<String>): JSONObject {
        val parts = JSONArray().put(JSONObject().put("text", text))
        frames.forEach {
            parts.put(
                JSONObject().put(
                    "inlineData",
                    JSONObject().put("mimeType", MIME).put("data", it)
                )
            )
        }
        return JSONObject()
            .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
            .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", parts)))
            .put("generationConfig", JSONObject().put("maxOutputTokens", MAX_OUT))
    }

    private fun claudeBody(system: String, text: String, frames: List<String>): JSONObject {
        val content = JSONArray()
        frames.forEach {
            content.put(
                JSONObject().put("type", "image").put(
                    "source",
                    JSONObject().put("type", "base64").put("media_type", MIME).put("data", it)
                )
            )
        }
        content.put(JSONObject().put("type", "text").put("text", text))
        return JSONObject()
            .put("model", CLAUDE_MODEL)
            .put("max_tokens", MAX_OUT)
            .put("system", system)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", content)))
    }

    private fun openAiBody(system: String, text: String, frames: List<String>): JSONObject {
        val content = JSONArray().put(JSONObject().put("type", "text").put("text", text))
        frames.forEach {
            content.put(
                JSONObject().put("type", "image_url").put(
                    "image_url",
                    JSONObject().put("url", "data:$MIME;base64,$it")
                )
            )
        }
        return JSONObject()
            .put("model", OPENAI_MODEL)
            .put("max_completion_tokens", MAX_OUT)
            .put(
                "messages", JSONArray()
                    .put(JSONObject().put("role", "system").put("content", system))
                    .put(JSONObject().put("role", "user").put("content", content))
            )
    }

    // ---------- Respuestas ----------
    private fun parse(provider: Provider, raw: String): String = try {
        val j = JSONObject(raw)
        when (provider) {
            Provider.GEMINI -> {
                val parts = j.getJSONArray("candidates").getJSONObject(0)
                    .getJSONObject("content").getJSONArray("parts")
                (0 until parts.length()).joinToString("") { parts.getJSONObject(it).optString("text") }
            }
            Provider.CLAUDE -> {
                val c = j.getJSONArray("content")
                (0 until c.length()).joinToString("") { c.getJSONObject(it).optString("text") }
            }
            Provider.OPENAI -> j.getJSONArray("choices").getJSONObject(0)
                .getJSONObject("message").optString("content")
        }
    } catch (_: Exception) {
        ""
    }

    private fun friendlyError(code: Int, raw: String): String {
        val detail = try {
            val j = JSONObject(raw)
            val e = j.opt("error")
            when (e) {
                is JSONObject -> e.optString("message")
                is String -> e
                else -> ""
            }
        } catch (_: Exception) {
            ""
        }.take(300)

        val base = when (code) {
            400 -> "Petición rechazada (revisa el modelo o el tamaño de las imágenes)."
            401, 403 -> "API Key inválida o sin permisos."
            404 -> "Modelo no encontrado. Revisa el nombre del modelo."
            429 -> "Límite de uso alcanzado. Espera un momento."
            in 500..599 -> "El servidor de IA tiene problemas. Intenta más tarde."
            else -> "Error del servidor ($code)."
        }
        return if (detail.isNotBlank()) "$base\n$detail" else base
    }

    // ---------- Prompts ----------
    private fun buildUserText(req: AiRequest, prompt: String): String {
        val sb = StringBuilder(prompt)
        req.scriptSnippet?.takeIf { it.isNotBlank() }?.let {
            sb.append("\n\n[SCRIPT]\n").append(it.take(MAX_SNIPPET))
        }
        req.objetoProperties?.takeIf { it.length() > 0 }?.let {
            sb.append("\n\n[OBJETO]\n").append(it.toString())
        }
        return sb.toString()
    }

    private fun systemFor(perfil: String): String = when (perfil.lowercase()) {
        "visual" -> "Analiza las capturas de un entorno de desarrollo de juegos 3D. Describe y sugiere mejoras visuales concretas."
        "script" -> "Eres experto en scripting de juegos. Revisa el código dado y responde con código corregido y breve explicación."
        "optimizacion" -> "Eres experto en optimización de juegos. Detecta cuellos de botella y propón mejoras medibles."
        else -> "Eres un asistente de desarrollo de juegos. Usa las capturas, el código y las propiedades del objeto para ayudar. Sé conciso."
    }

    companion object {
        // Revisa estos nombres en la consola de cada proveedor; cámbialos aquí si cambian.
        const val GEMINI_MODEL = "gemini-2.5-flash"
        const val CLAUDE_MODEL = "claude-sonnet-5-5"
        const val OPENAI_MODEL = "gpt-4o-mini"

        private const val MIME = "image/jpeg"
        private const val MAX_PROMPT = 1000
        private const val MAX_SNIPPET = 6000
        private const val MAX_FRAMES = 5
        private const val MAX_OUT = 1500
        private const val MAX_RESPONSE_CHARS = 1_000_000
    }
}
