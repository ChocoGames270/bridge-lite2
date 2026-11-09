package com.aibridge.lite.data

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

enum class Provider(val id: String) {
    GEMINI("gemini"),
    CLAUDE("claude"),
    OPENAI("openai");

    companion object {
        fun fromId(id: String?): Provider =
            values().firstOrNull { it.id == id } ?: GEMINI
    }
}

/**
 * Almacén local de preferencias. Las API Keys se cifran con AES-GCM
 * usando una clave que vive en Android Keystore (nunca sale del dispositivo).
 */
class SecureStore private constructor(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ---------- Proveedor ----------
    fun getProvider(): Provider = Provider.fromId(prefs.getString(K_PROVIDER, null))

    fun setProvider(p: Provider) {
        prefs.edit().putString(K_PROVIDER, p.id).apply()
    }

    // ---------- API Keys ----------
    fun setApiKey(provider: Provider, key: String) {
        val clean = key.trim()
        val editor = prefs.edit()
        if (clean.isEmpty()) {
            editor.remove(keyName(provider))
        } else {
            editor.putString(keyName(provider), encrypt(clean))
        }
        editor.apply()
    }

    fun getApiKey(provider: Provider): String? {
        val stored = prefs.getString(keyName(provider), null) ?: return null
        return decrypt(stored)
    }

    fun getActiveApiKey(): String? = getApiKey(getProvider())

    /** No bloquea la app: solo indica si hay una key usable para el proveedor activo. */
    fun hasValidKey(provider: Provider = getProvider()): Boolean =
        (getApiKey(provider)?.length ?: 0) >= MIN_KEY_LENGTH

    /** Mensaje amable para mostrar cuando falta la key. Null si todo está bien. */
    fun missingKeyMessage(): String? =
        if (hasValidKey()) null
        else "Configura tu API Key de ${getProvider().id.replaceFirstChar { it.uppercase() }} " +
                "para usar la IA. Se guarda solo en tu dispositivo."

    fun clearAll() {
        prefs.edit().clear().apply()
        try {
            val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS)
        } catch (_: Exception) {
        }
    }

    // ---------- Cifrado ----------
    private fun keyName(p: Provider) = "key_${p.id}"

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val data = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(data, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String? = try {
        val parts = stored.split(":")
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val data = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(data), Charsets.UTF_8)
    } catch (_: Exception) {
        null // clave corrupta o Keystore reiniciado: se trata como "sin key"
    }

    companion object {
        private const val PREFS = "aibl_secure_prefs"
        private const val K_PROVIDER = "provider"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "aibl_master_key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val MIN_KEY_LENGTH = 10

        @Volatile
        private var instance: SecureStore? = null

        fun get(context: Context): SecureStore =
            instance ?: synchronized(this) {
                instance ?: SecureStore(context).also { instance = it }
            }
    }
}
