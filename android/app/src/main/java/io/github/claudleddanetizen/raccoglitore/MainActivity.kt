package io.github.claudleddanetizen.raccoglitore

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

/**
 * L'app è la stessa pagina web pubblicata su GitHub Pages, chiusa dentro un'app Android.
 * Questa classe fa solo da ponte con il telefono:
 *  - serve i file dell'app dalle risorse interne, senza rete;
 *  - apre la fotocamera o la scelta di un file quando la pagina lo chiede;
 *  - salva nei Download o condivide i file creati dalla pagina (Excel, copia di sicurezza).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var attesa: ValueCallback<Array<Uri>>? = null
    private var fotoFile: File? = null
    private var fotoUri: Uri? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pulisciFileTemporanei()

        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true      // la collezione vive nella memoria della pagina (IndexedDB)
            databaseEnabled = true
            allowFileAccess = false
        }
        web.addJavascriptInterface(Ponte(), "AndroidApp")
        web.webViewClient = Risorse()
        web.webChromeClient = Scelte()

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(BASE + "index.html")
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        attesa?.onReceiveValue(null)
        attesa = null
        web.destroy()
        super.onDestroy()
    }

    /** Tasto indietro: prima chiede alla pagina se ha qualcosa da chiudere, altrimenti esce. */
    @Deprecated("Sostituito dalle API di navigazione predittiva, non usate da questa app")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        val script = "(function(){try{return !!(window.App&&App.indietro&&App.indietro());}catch(e){return false;}})()"
        web.evaluateJavascript(script) { gestito ->
            if (gestito != "true") super@MainActivity.onBackPressed()
        }
    }

    // ---------- file dell'app serviti dalle risorse interne ----------

    private inner class Risorse : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (url.host != HOST) return null // quotazioni e immagini ufficiali: dalla rete
            var percorso = (url.path ?: "/").trimStart('/')
            if (percorso.isEmpty()) percorso = "index.html"
            if (percorso.contains("..")) return nonTrovato()
            val estensione = percorso.substringAfterLast('.', "").lowercase()
            val tipo = TIPI[estensione] ?: "application/octet-stream"
            val testo = tipo.startsWith("text/") || tipo.endsWith("json") || tipo.endsWith("javascript")
            return try {
                WebResourceResponse(tipo, if (testo) "utf-8" else null, assets.open("web/$percorso"))
            } catch (e: IOException) {
                nonTrovato()
            }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.host == HOST) return false
            // collegamenti esterni: si aprono nel browser del telefono
            try {
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
            } catch (e: ActivityNotFoundException) {
                Log.w(TAG, "Nessuna app per aprire ${request.url}")
            }
            return true
        }

        private fun nonTrovato(): WebResourceResponse =
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }

    // ---------- fotocamera e scelta dei file ----------

    private inner class Scelte : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams
        ): Boolean {
            attesa?.onReceiveValue(null)
            attesa = filePathCallback
            try {
                if (fileChooserParams.isCaptureEnabled) {
                    val cartella = File(cacheDir, "foto").apply { mkdirs() }
                    val file = File(cartella, "scatto-${System.currentTimeMillis()}.jpg")
                    val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.file", file)
                    fotoFile = file
                    fotoUri = uri
                    val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                        .putExtra(MediaStore.EXTRA_OUTPUT, uri)
                        .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    intent.clipData = ClipData.newRawUri("foto", uri)
                    startActivityForResult(intent, RICHIESTA_FOTO)
                } else {
                    val immagini = fileChooserParams.acceptTypes.any { it.startsWith("image/") }
                    val intent = Intent(Intent.ACTION_GET_CONTENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(if (immagini) "image/*" else "*/*")
                    startActivityForResult(Intent.createChooser(intent, null), RICHIESTA_FILE)
                }
            } catch (e: Exception) {
                // nessuna app fotocamera, oppure scelta dei file non disponibile
                Log.w(TAG, "Scelta del file non riuscita", e)
                attesa = null
                filePathCallback.onReceiveValue(null)
                Toast.makeText(this@MainActivity, "Non riesco ad aprire la fotocamera o la scelta dei file", Toast.LENGTH_LONG).show()
            }
            return true
        }
    }

    @Deprecated("Usato per restare senza dipendenze aggiuntive")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != RICHIESTA_FOTO && requestCode != RICHIESTA_FILE) {
            @Suppress("DEPRECATION")
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val risposta = attesa ?: return
        attesa = null
        var scelti: Array<Uri>? = null
        if (resultCode == RESULT_OK) {
            if (requestCode == RICHIESTA_FOTO) {
                val file = fotoFile
                val uri = fotoUri
                if (file != null && uri != null && file.length() > 0) scelti = arrayOf(uri)
            } else {
                val uri = data?.data
                if (uri != null) scelti = arrayOf(uri)
            }
        }
        risposta.onReceiveValue(scelti)
    }

    // ---------- file creati dalla pagina: salvataggio nei Download e condivisione ----------

    /** Metodi chiamati dalla pagina come window.AndroidApp. Girano su un thread separato da quello dello schermo. */
    private inner class Ponte {
        private val aperti = HashMap<String, File>()

        /** Apre un nuovo file temporaneo e restituisce il suo identificativo (vuoto se non riesce). */
        @JavascriptInterface
        fun inizia(nome: String): String {
            return try {
                val pulito = nome.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifEmpty { "file" }
                val cartella = File(cacheDir, "esporta").apply { mkdirs() }
                val file = File(cartella, pulito)
                if (file.exists()) file.delete()
                val id = UUID.randomUUID().toString()
                synchronized(aperti) { aperti[id] = file }
                id
            } catch (e: Exception) {
                Log.w(TAG, "inizia non riuscito", e)
                ""
            }
        }

        /** Aggiunge un pezzo del file, codificato in base64. */
        @JavascriptInterface
        fun aggiungi(id: String, base64: String): Boolean {
            val file = synchronized(aperti) { aperti[id] } ?: return false
            return try {
                FileOutputStream(file, true).use { it.write(Base64.decode(base64, Base64.DEFAULT)) }
                true
            } catch (e: Exception) {
                Log.w(TAG, "aggiungi non riuscito", e)
                false
            }
        }

        /** Conclude il file: modo "salva" lo mette nei Download, "condividi" apre il pannello di condivisione. */
        @JavascriptInterface
        fun concludi(id: String, tipo: String, modo: String): String {
            val file = synchronized(aperti) { aperti.remove(id) } ?: return "file non trovato"
            return try {
                if (modo == "condividi") condividi(file, tipo) else salvaNeiDownload(file, tipo)
                "ok"
            } catch (e: Exception) {
                Log.w(TAG, "concludi non riuscito", e)
                "il telefono non ha salvato il file (${e.message ?: e.javaClass.simpleName})"
            }
        }

        private fun salvaNeiDownload(file: File, tipo: String) {
            val valori = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(MediaStore.MediaColumns.MIME_TYPE, tipo)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valori)
                ?: throw IOException("cartella Download non disponibile")
            try {
                val uscita = contentResolver.openOutputStream(uri) ?: throw IOException("file non scrivibile")
                uscita.use { out -> file.inputStream().use { it.copyTo(out) } }
                valori.clear()
                valori.put(MediaStore.MediaColumns.IS_PENDING, 0)
                contentResolver.update(uri, valori, null, null)
            } catch (e: Exception) {
                contentResolver.delete(uri, null, null) // niente file a metà nei Download
                throw e
            } finally {
                file.delete()
            }
        }

        private fun condividi(file: File, tipo: String) {
            val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.file", file)
            val intent = Intent(Intent.ACTION_SEND)
                .setType(tipo)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            intent.clipData = ClipData.newRawUri(file.name, uri)
            runOnUiThread { startActivity(Intent.createChooser(intent, null)) }
        }
    }

    /** Toglie foto scattate e file condivisi più vecchi di un giorno. */
    private fun pulisciFileTemporanei() {
        val limite = System.currentTimeMillis() - 24L * 60 * 60 * 1000
        for (nome in arrayOf("foto", "esporta")) {
            File(cacheDir, nome).listFiles()?.forEach { if (it.lastModified() < limite) it.delete() }
        }
    }

    companion object {
        private const val TAG = "Raccoglitore"
        // Indirizzo riservato alle app: non esiste in rete, le richieste vengono servite dalle risorse interne
        private const val HOST = "appassets.androidplatform.net"
        private const val BASE = "https://$HOST/"
        private const val RICHIESTA_FOTO = 1001
        private const val RICHIESTA_FILE = 1002

        private val TIPI = mapOf(
            "html" to "text/html",
            "css" to "text/css",
            "js" to "text/javascript",
            "mjs" to "text/javascript",
            "json" to "application/json",
            "webmanifest" to "application/manifest+json",
            "txt" to "text/plain",
            "wasm" to "application/wasm",
            "onnx" to "application/octet-stream",
            "woff2" to "font/woff2",
            "png" to "image/png",
            "jpg" to "image/jpeg",
            "svg" to "image/svg+xml",
            "webp" to "image/webp"
        )
    }
}
