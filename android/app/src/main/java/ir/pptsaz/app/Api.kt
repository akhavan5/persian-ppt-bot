package ir.pptsaz.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
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

class InviteInfo(val link: String, val count: Int, val max: Int, val every: Int, val canClaim: Boolean)

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
    // نسخه‌ی اپ، فروشگاه و نسخه‌ی اندروید در User-Agent می‌رود: «PptSazApp/1.0.4 (myket; Android 14)».
    // سرور فقط برای آمار و گزارش مدیر می‌خواند (فروشگاه فقط از نسخه‌ای که این قالب را می‌فرستد به بعد شمرده می‌شود)
    private val UA: String =
        "Mozilla/5.0 (Linux; Android ${Build.VERSION.RELEASE}; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 " +
            "PptSazApp/${BuildConfig.VERSION_NAME} (${BuildConfig.STORE}; Android ${Build.VERSION.RELEASE})"
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

    /** گزارش کرش دفعه‌ی قبل (بدون ورود هم کار می‌کند). */
    suspend fun reportCrash(report: JSONObject) {
        call("POST", "/api/app/crash", report)
    }

    /** null یعنی وارد نشده‌اید. */
    suspend fun me(): Me? = parseMe(call("GET", "/api/me"))

    /** ورود با کد: id موبایل (پیامک) یا ایمیل (اگر «@» دارد)؛ سرور از روی کلید body تشخیص می‌دهد. */
    suspend fun otpSend(id: String) {
        call("POST", "/api/auth/otp/send", JSONObject().put(if ('@' in id) "email" else "mobile", id))
    }

    suspend fun otpVerify(id: String, code: String) {
        call("POST", "/api/auth/otp/verify", JSONObject().put(if ('@' in id) "email" else "mobile", id).put("code", code))
    }

    /** ورود با ID token گوگل (گرفته‌شده داخل اپ)؛ سرور توکن را اعتبارسنجی و نشست می‌سازد. */
    suspend fun googleLogin(idToken: String) {
        call("POST", "/api/auth/google/token", JSONObject().put("idToken", idToken))
    }

    /** مرورگر پشتیبان: کد یک‌بارمصرفِ pptsaz://login?c=… را به نشست تبدیل می‌کند. */
    suspend fun googleExchange(code: String) {
        call("POST", "/api/auth/google/exchange", JSONObject().put("code", code))
    }

    /** ثبت/حذف توکن FCM دستگاه؛ promo = اعلان‌های اخبار و تخفیف روشن است. */
    suspend fun pushRegister(token: String, promo: Boolean, remove: Boolean = false) {
        call("POST", "/api/app/push", JSONObject().put("token", token).put("promo", promo).put("remove", remove))
    }

    suspend fun logout() {
        try { call("POST", "/api/auth/logout") } catch (e: ApiException) { /* مهم نیست */ }
        clearSession()
    }

    suspend fun files(): List<FileItem> = parseFiles(call("GET", "/api/files"))

    /** گفتگوی قبلی با دستیار هوشمند پشتیبانی + تعداد پیام‌های باقی‌مانده‌ی امروز (همان گفتگوی سایت). */
    suspend fun supportHistory(): SupportData = parseSupport(call("GET", "/api/support/history"))

    /** پیام کاربر را می‌فرستد و گفتگوی به‌روز (همراه جواب دستیار) را برمی‌گرداند. خطای ۴۲۹ = سقف روزانه یا ارسال پشت‌سرهم. */
    suspend fun supportSend(text: String): SupportData = parseSupport(call("POST", "/api/support/send", JSONObject().put("text", text)))

    suspend fun generate(topic: String, slides: Int, handout: Boolean, source: String, poster: String?, images: Boolean, audio: Boolean = false, podcast: Boolean = false, imagesMany: Boolean = false): String {
        val b = JSONObject().put("topic", topic).put("slides", slides).put("handout", handout).put("images", images).put("imagesMany", images && imagesMany)
        if (poster != null) b.put("poster", poster)
        if (audio) b.put("audio", true)
        if (podcast) b.put("podcast", true)
        if (source.isNotEmpty()) b.put("source", source)
        return call("POST", "/api/generate", b).optString("jobId")
    }

    /**
     * ساخت جداگانه‌ی پوستر/جزوه/اسلاید صوتی/پادکست برای ارائه‌ی ساخته‌شده (۱ اعتبار جدا؛ همان سرویس دکمه‌های وب و تلگرام).
     * kind = "poster" | "handout" | "audio" | "podcast"؛ layout فقط برای پوستر ("wide" | "tall"). شناسه‌ی کار را برمی‌گرداند (وضعیت: job()).
     */
    suspend fun startExtra(deckId: String, kind: String, layout: String? = null): String {
        val b = JSONObject().put("kind", kind)
        if (layout != null) b.put("layout", layout)
        return call("POST", "/api/files/" + Uri.encode(deckId) + "/extra", b).optString("jobId")
    }

    suspend fun job(id: String): JSONObject = call("GET", "/api/jobs/" + Uri.encode(id))

    suspend fun putSetting(key: String, value: Any) {
        call("PUT", "/api/settings", JSONObject().put(key, value))
    }

    /** چند تنظیم وابسته در یک درخواست (مثل سطح تصویر: images + imagesMany) */
    suspend fun putSettings(vararg pairs: Pair<String, Any>) {
        val b = JSONObject()
        pairs.forEach { (k, v) -> b.put(k, v) }
        call("PUT", "/api/settings", b)
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

    /** ثبت موبایل/ایمیل در پروفایل، مرحله‌ی ۱: ارسال کد یک‌بارمصرف (kind: "mobile" پیامک | "email" ایمیل). */
    suspend fun contactSend(kind: String, value: String) {
        call("POST", "/api/auth/otp/send", JSONObject().put(if (kind == "email") "email" else "mobile", value))
    }

    /** مرحله‌ی ۲: تایید کد و ثبت روی حساب. خروجی: تعداد اعتبار هدیه‌ای که همین حالا اضافه شد (۰ = هدیه‌ای نبود). */
    suspend fun contactVerify(kind: String, value: String, code: String): Int {
        val key = if (kind == "email") "email" else "mobile"
        val j = call("POST", "/api/profile/$key", JSONObject().put(key, value).put("code", code))
        return j.optInt("reward")
    }

    // ------------------------------------------------------------ دعوت دوستان

    /** وضعیت دعوت این حساب: لینک سایت (برای همه‌ی پلتفرم‌ها کار می‌کند)، دعوت‌های موفق و اینکه هنوز می‌شود کد دعوت دوست را وارد کرد. */
    suspend fun invite(): InviteInfo {
        val j = call("GET", "/api/invite")
        return InviteInfo(
            link = j.optString("webLink").ifEmpty { j.optString("link") },
            count = j.optInt("count"), max = j.optInt("max", 50), every = j.optInt("every", 5),
            canClaim = j.optBoolean("canClaim"),
        )
    }

    /** ثبت کد/لینک دعوت دوست (در هر زمان، یک‌بار برای هر حساب). خطا = ApiException با پیام فارسی. */
    suspend fun inviteClaim(code: String) {
        call("POST", "/api/invite/claim", JSONObject().put("code", code.trim()))
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

    /** گزارش بی‌صدای خطای پرداخت به سرور تا در لاگ و پنل مدیر دیده شود؛ هیچ‌وقت خطا نمی‌دهد. */
    suspend fun reportPay(code: String, msg: String = "", sku: String = "") {
        try {
            call(
                "POST", "/api/app/pay-report",
                JSONObject().put("store", Store.ID).put("code", code).put("msg", msg.take(60)).put("sku", sku).put("v", BuildConfig.VERSION_NAME),
            )
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }

    /** تایید خرید کافه‌بازار روی سرور؛ بعد از موفقیت پلن فعال می‌شود (تکراری‌بودن مشکلی ندارد). */
    suspend fun bazaarVerify(productId: String, purchaseToken: String) {
        call("POST", "/api/pay/" + Store.ID, JSONObject().put("productId", productId).put("purchaseToken", purchaseToken))
    }

    class Fetched(val name: String, val mime: String, val bytes: ByteArray)

    private class Raw(val code: Int, val bytes: ByteArray, val disposition: String?, val type: String?)

    /**
     * فایل را می‌گیرد و در پوشه‌ی Downloads ذخیره می‌کند. بلافاصله بعد از اتمام کار ممکن است فایل چند ثانیه 404 بدهد؛ پس تا maxRetries بار
     * (هر ۳ ثانیه) دوباره تلاش می‌کنیم. برای فایلی که از قبل در فهرست سرور هست عدد کوچک بدهید تا فایل منقضی‌شده یک دقیقه کاربر را معطل نکند.
     */
    suspend fun fetchFile(id: String, maxRetries: Int = 20): Fetched {
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
                    return Fetched(name, mime, raw.bytes)
                }
                raw.code == 404 && attempt < maxRetries -> {
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

    /** نسخه‌ی PDF ارائه؛ اگر قبلاً ساخته نشده باشد سرور همین‌جا می‌سازد (تا حدود یک دقیقه) و در Downloads ذخیره می‌شود. */
    suspend fun downloadPdf(ctx: Context, id: String): Saved {
        val raw = withContext(Dispatchers.IO) {
            val req = Request.Builder().url(BASE + "/api/files/" + Uri.encode(id) + "/pdf")
                .header("User-Agent", UA).header("Origin", BASE).build()
            try {
                client.newBuilder().readTimeout(150, TimeUnit.SECONDS).build().newCall(req).execute().use { r ->
                    Raw(r.code, r.body?.bytes() ?: ByteArray(0), r.header("Content-Disposition"), r.header("Content-Type"))
                }
            } catch (e: IOException) {
                throw ApiException(NO_NET)
            }
        }
        if (raw.code !in 200..299) {
            val msg = try { JSONObject(String(raw.bytes)).optString("error") } catch (e: Exception) { "" }
            throw ApiException(msg.ifEmpty { "ساخت PDF انجام نشد (${raw.code})" }, raw.code)
        }
        val cd = raw.disposition.orEmpty()
        val star = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(cd)?.groupValues?.get(1)
        val name = try { star?.let { URLDecoder.decode(it, "UTF-8") } } catch (e: Exception) { null } ?: "presentation.pdf"
        return withContext(Dispatchers.IO) { Storage.save(ctx, name, "application/pdf", raw.bytes) }
    }

    /** فایل را می‌گیرد و در پوشه‌ی Downloads ذخیره می‌کند (جزئیات دریافت و تلاش دوباره در fetchFile). */
    suspend fun downloadFile(ctx: Context, id: String, maxRetries: Int = 20): Saved {
        val f = fetchFile(id, maxRetries)
        return withContext(Dispatchers.IO) { Storage.save(ctx, f.name, f.mime, f.bytes) }
    }
}
