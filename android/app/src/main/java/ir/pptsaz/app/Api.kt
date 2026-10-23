package ir.pptsaz.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.net.URLDecoder
import java.util.concurrent.TimeUnit

class ApiException(
    message: String,
    val status: Int = 0,
    val needPlan: Boolean = false,
    val noCredit: Boolean = false,
) : Exception(message)

/** کوکی نشست (sid) را در SharedPreferences نگه می‌دارد تا بعد از بستن اپ هم وارد بمانید. */
class PrefsCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val e = prefs.edit()
        for (c in cookies) {
            if (c.expiresAt < System.currentTimeMillis() || c.value.isEmpty()) e.remove(c.name)
            else e.putString(c.name, c.toString())
        }
        e.apply()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        return prefs.all.values.mapNotNull { (it as? String)?.let { s -> Cookie.parse(url, s) } }
            .filter { it.expiresAt > now }
    }

    @Synchronized
    fun clear() {
        prefs.edit().clear().apply()
    }
}

object Api {
    const val BASE = "https://pptsaz.ir"
    private const val UA =
        "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 PptSazApp/2.0"
    private const val NO_NET = "اتصال برقرار نشد. اینترنت خود را بررسی کنید."

    private lateinit var jar: PrefsCookieJar
    private lateinit var client: OkHttpClient

    fun init(ctx: Context) {
        if (::client.isInitialized) return
        jar = PrefsCookieJar(ctx.applicationContext)
        client = OkHttpClient.Builder()
            .cookieJar(jar)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    fun clearSession() = jar.clear()

    private fun builder(path: String) = Request.Builder()
        .url(BASE + path)
        .header("User-Agent", UA)
        .header("Accept", "application/json")
        .header("Origin", BASE) // سرور برای درخواست‌های غیر GET همین هدر را چک می‌کند (ضد CSRF)

    private suspend fun call(method: String, path: String, body: JSONObject? = null): JSONObject {
        val rb = if (method == "GET") null
        else (body ?: JSONObject()).toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        return send(method, path, rb)
    }

    private suspend fun send(method: String, path: String, rb: RequestBody?): JSONObject =
        withContext(Dispatchers.IO) {
            val req = builder(path).method(method, rb).build()
            try {
                client.newCall(req).execute().use { r ->
                    val text = r.body?.string().orEmpty()
                    val j = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
                    if (!r.isSuccessful) {
                        throw ApiException(
                            j.optString("error").ifEmpty { "خطا در ارتباط با سرور (${r.code})" },
                            r.code, j.optBoolean("needPlan"), j.optBoolean("noCredit"),
                        )
                    }
                    j
                }
            } catch (e: IOException) {
                throw ApiException(NO_NET)
            }
        }

    suspend fun config(): Config = parseConfig(call("GET", "/api/config"))

    /** null یعنی وارد نشده‌اید. */
    suspend fun me(): Me? = parseMe(call("GET", "/api/me"))

    suspend fun otpSend(mobile: String) {
        call("POST", "/api/auth/otp/send", JSONObject().put("mobile", mobile))
    }

    suspend fun otpVerify(mobile: String, code: String) {
        call("POST", "/api/auth/otp/verify", JSONObject().put("mobile", mobile).put("code", code))
    }

    suspend fun logout() {
        try { call("POST", "/api/auth/logout") } catch (e: ApiException) { /* مهم نیست */ }
        clearSession()
    }

    suspend fun files(): List<FileItem> = parseFiles(call("GET", "/api/files"))

    suspend fun generate(topic: String, slides: Int, handout: Boolean, source: String, poster: String?, imageCount: Int): String {
        val b = JSONObject().put("topic", topic).put("slides", slides).put("handout", handout).put("imageCount", imageCount)
        if (poster != null) b.put("poster", poster)
        if (source.isNotEmpty()) b.put("source", source)
        return call("POST", "/api/generate", b).optString("jobId")
    }

    suspend fun job(id: String): JSONObject = call("GET", "/api/jobs/" + Uri.encode(id))

    suspend fun putSetting(key: String, value: Any) {
        call("PUT", "/api/settings", JSONObject().put(key, value))
    }

    /** true یعنی کد در تلگرام ارسال شد؛ false یعنی تلگرام از قبل وصل بوده است. */
    suspend fun telegramSend(tgId: String): Boolean {
        val j = call("POST", "/api/profile/telegram/send", JSONObject().put("tgId", tgId))
        return !j.optBoolean("already")
    }

    suspend fun telegramVerify(code: String) {
        call("POST", "/api/profile/telegram/verify", JSONObject().put("code", code))
    }

    /** متن PDF یا عکس را استخراج می‌کند (سرور کار را در پس‌زمینه انجام می‌دهد و ما وضعیت را پیگیری می‌کنیم). */
    suspend fun extractText(bytes: ByteArray, mime: String): String {
        val j = send("POST", "/api/extract", bytes.toRequestBody(mime.toMediaType()))
        val direct = j.optString("text")
        if (direct.isNotEmpty()) return direct
        val id = j.optString("jobId")
        if (id.isEmpty()) throw ApiException("استخراج متن انجام نشد.")
        repeat(100) {
            delay(3000)
            val s = call("GET", "/api/extract/" + Uri.encode(id))
            when (s.optString("state")) {
                "done" -> return s.optString("text")
                "error" -> throw ApiException(s.optString("message").ifEmpty { "استخراج متن انجام نشد." })
            }
        }
        throw ApiException("استخراج متن بیش از حد طول کشید. دوباره تلاش کنید.")
    }

    /** متن صفحه‌ی وب را برای استفاده به‌عنوان منبع می‌گیرد. */
    suspend fun linkSource(url: String): String =
        call("POST", "/api/link", JSONObject().put("url", url)).optString("text")

    // ------------------------------------------------------------ پروفایل

    suspend fun updateName(name: String) {
        call("PUT", "/api/profile", JSONObject().put("name", name))
    }

    // ------------------------------------------------------------ پیش‌نمایش و پوستر

    fun previewUrl(id: String): String = "$BASE/api/files/" + Uri.encode(id) + "/preview"

    /** پیش‌نمایش را سرور به‌صورت صفحه‌ی HTML می‌سازد؛ برای نمایش، نشست اپ را به WebView می‌دهیم. */
    fun syncCookiesToWebView() {
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        jar.loadForRequest(BASE.toHttpUrl()).forEach { cm.setCookie(BASE, it.toString()) }
        cm.flush()
    }

    /** تصویر پوستر را می‌گیرد (برای نمایش در اپ، با کاهش اندازه‌ی مناسب). */
    suspend fun fetchImage(id: String): Bitmap = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(BASE + "/api/files/" + Uri.encode(id) + "?inline=1")
            .header("User-Agent", UA).header("Origin", BASE).build()
        var bytes: ByteArray? = null
        for (attempt in 0 until 4) {
            try {
                client.newCall(req).execute().use { r -> if (r.isSuccessful) bytes = r.body?.bytes() }
            } catch (e: IOException) {
                throw ApiException(NO_NET)
            }
            if (bytes != null) break
            delay(2000)
        }
        val data = bytes ?: throw ApiException("تصویر دریافت نشد.")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2048) sample *= 2
        BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw ApiException("تصویر قابل نمایش نیست.")
    }

    /** آدرس صفحه‌ی پرداخت را برمی‌گرداند تا در مرورگر باز شود. */
    suspend fun startPayment(planId: String): String {
        val url = call("POST", "/api/pay/start", JSONObject().put("plan", planId)).optString("url")
        if (url.isEmpty()) throw ApiException("آدرس پرداخت دریافت نشد.")
        return if (url.startsWith("/")) BASE + url else url
    }

    private class Raw(val code: Int, val bytes: ByteArray, val disposition: String?, val type: String?)

    /** فایل را می‌گیرد و در پوشه‌ی Downloads ذخیره می‌کند. بلافاصله بعد از اتمام کار ممکن است فایل چند ثانیه 404 بدهد؛ پس چند بار تلاش می‌کنیم. */
    suspend fun downloadFile(ctx: Context, id: String): Saved {
        var attempt = 0
        while (true) {
            val raw = withContext(Dispatchers.IO) {
                val req = Request.Builder().url(BASE + "/api/files/" + Uri.encode(id))
                    .header("User-Agent", UA).header("Origin", BASE).build()
                try {
                    client.newCall(req).execute().use { r ->
                        Raw(r.code, r.body?.bytes() ?: ByteArray(0), r.header("Content-Disposition"), r.header("Content-Type"))
                    }
                } catch (e: IOException) {
                    throw ApiException(NO_NET)
                }
            }
            when {
                raw.code in 200..299 -> {
                    val cd = raw.disposition.orEmpty()
                    val star = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(cd)?.groupValues?.get(1)
                    val plain = Regex("filename=\"?([^\";]+)\"?", RegexOption.IGNORE_CASE).find(cd)?.groupValues?.get(1)
                    val decoded = try { star?.let { URLDecoder.decode(it, "UTF-8") } } catch (e: Exception) { null }
                    val name = decoded ?: plain ?: "presentation.pptx"
                    val mime = raw.type?.substringBefore(';')?.trim().orEmpty()
                    return withContext(Dispatchers.IO) { Storage.save(ctx, name, mime, raw.bytes) }
                }
                raw.code == 404 && attempt < 20 -> {
                    attempt++
                    delay(3000)
                }
                else -> {
                    val msg = try { JSONObject(String(raw.bytes)).optString("error") } catch (e: Exception) { "" }
                    throw ApiException(msg.ifEmpty { "دانلود انجام نشد (${raw.code})" }, raw.code)
                }
            }
        }
    }
}
