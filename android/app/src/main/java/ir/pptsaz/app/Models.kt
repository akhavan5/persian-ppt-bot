package ir.pptsaz.app

import org.json.JSONArray
import org.json.JSONObject

data class Opt(val key: String, val name: String, val color: String? = null, val hint: String = "")

data class PlanInfo(val id: String, val name: String, val price: Int, val credits: Int, val days: Int, val maxSlides: Int, val maxImages: Int, val url: String)

data class ModelOpt(val id: String, val name: String, val brand: String, val free: Boolean)

data class Config(
    val templates: List<Opt>,
    val themes: List<Opt>,
    val tones: List<Opt>,
    val fonts: List<String>,
    val slideChoices: List<Int>,
    val payEnabled: Boolean,
    val otp: Boolean,
    val link: Boolean,
    val poster: Boolean,
    val models: List<ModelOpt>,
    val dailyFree: Int,
    val bazaar: Boolean = false,
    val latestVersion: Int = 0, // آخرین versionCode منتشرشده (۰ = اعلام نشده)
    val minVersion: Int = 0, // کمترین versionCode مجاز؛ پایین‌تر از آن اپ باید حتماً به‌روز شود
    val updateUrl: String = "",
    val pdf: Boolean = false, // خروجی PDF ارائه (سرور Browser Rendering دارد)
    val audio: Boolean = false, // اسلاید صوتی و پادکست همراه ارائه (سرور Gemini TTS دارد)
    val voice: Boolean = false, // ورودی صوتی: فایل صوتی/ویس به متن (سرور کلید Deepgram دارد)
    val googleClientId: String = "", // خالی = ورود با گوگل خاموش
    val emailOtp: Boolean = false, // ورود/ثبت‌نام با کد ایمیلی (مثل وب؛ در همان کادر موبایل)
)

data class Settings(val theme: String, val template: String, val tone: String, val font: String, val slides: Int, val model: String = "",
    val mode: String = "normal", val digits: Boolean = false, val sources: Boolean = false, val questions: Boolean = false,
    val images: Boolean = true,
    /** تصویر «زیاد» (فقط پلن‌دارها): تعداد نرمال + ۱ */
    val imagesMany: Boolean = false,
    /** یادداشت سخنرانی زیر هر اسلاید؛ پیش‌فرض روشن */
    val notes: Boolean = true,
)

/** وضعیت اتصال یک پیام‌رسان به حساب (سرور: channels در /api/me)؛ key: tg | bale | eitaa | rubika | splus */
data class ChannelInfo(val key: String, val label: String, val connected: Boolean, val shown: String, val notify: Boolean, val available: Boolean, val canUnlink: Boolean)

/** مسیرهای اعلانِ غیرپیام‌رسان: اپ اندروید، اعلان مرورگر، ایمیل */
data class Devices(val app: Boolean = false, val web: Boolean = false, val email: Boolean = false)

data class Me(
    val name: String,
    val mobile: String,
    val email: String,
    val unlimited: Boolean,
    /** پلن فعال یا مدیر (برای گزینه‌ی تصویر «زیاد») */
    val premium: Boolean = false,
    val credits: Int,
    val maxSlides: Int,
    val maxImages: Int,
    val planId: String?,
    val planExp: Long,
    val planCredits: Int,
    val bonus: Int,
    val dailyFree: Boolean,
    val settings: Settings,
    val activeJob: String?,
    val plans: List<PlanInfo>,
    val support: String,
    /** تعداد ارائه‌های موفق (سرور)؛ برای یادآورهای محلی */
    val decks: Int = 0,
    /** هدیه‌ی تکمیل پروفایل: با ثبت و تایید موبایل/ایمیل (در سایت یا ربات‌ها) اعتبار هدیه؛ giftNote = جمله‌ی «یکپارچگی در همه‌ی پلتفرم‌ها» از سرور */
    val giftAvailable: Boolean = false,
    val giftCredits: Int = 0,
    val giftNote: String = "",
    /** موردهای ثبت‌نشده‌ی پروفایل که سرور ثبتشان را پشتیبانی می‌کند: "mobile" و/یا "email" */
    val giftMissing: List<String> = emptyList(),
    /** ویدئوی جایزه‌ای: هر adEvery ویدئو = adCredits اعتبار؛ adProgress = ویدئوهای حساب‌شده برای اعتبار بعدی */
    val adEvery: Int = 5,
    val adProgress: Int = 0,
    val adCredits: Int = 1,
    /** ویدئوی باقی‌مانده‌ی امروز؛ ۰ = سقف روزانه تمام شده (سرور قدیمی: ۹۹) */
    val adLeft: Int = 99,
    /** اتصال پلتفرم‌ها: هر حساب می‌تواند هم‌زمان به چند پیام‌رسان وصل باشد و اعلان به همه‌ی روشن‌ها می‌رسد */
    val channels: List<ChannelInfo> = emptyList(),
    val devices: Devices = Devices(),
)

/**
 * audio: "" = فایل معمولی، "slides" = اسلاید صوتی (یا صدای یک اسلاید)، "podcast" = پادکست.
 * extras: همراه‌هایی که هنوز برای همین ارائه ساخته نشده‌اند و روی سرور روشن‌اند (زیرمجموعه‌ی "audio"، "podcast"، "handout"، "poster")؛
 * فقط برای خودِ ارائه پر می‌شود و زیرش دکمه‌ی «ساخت جداگانه» دارد.
 */
data class FileItem(val id: String, val title: String, val slides: Int, val t: Long, val poster: Boolean, val handout: Boolean, val audio: String = "", val extras: List<String> = emptyList(),
    /** فایل نمونه‌ی دائمی (برچسب «نمونه»): منقضی نمی‌شود و پیش‌نمایش/PDF/ساخت جداگانه ندارد؛ label برچسب نوع از سرور است */
    val sample: Boolean = false, val pdf: Boolean = false, val label: String = "")

/** isPublic = false یعنی فایل در حافظه‌ی اختصاصی اپ است (اندروید ۷–۹) و کاربر باید «ذخیره در گوشی» را بزند. */
data class Saved(val uri: android.net.Uri, val mime: String, val name: String, val isPublic: Boolean = true)

private fun JSONArray?.objects(): List<JSONObject> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { optJSONObject(it) }
}

private fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key, "")

fun parseConfig(j: JSONObject): Config {
    val tones = j.optJSONObject("tones")
    val toneList = if (tones == null) emptyList() else tones.keys().asSequence().map { Opt(it, tones.optString(it)) }.toList()
    val fonts = j.optJSONArray("fonts")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
    val slides = j.optJSONArray("slideChoices")?.let { a -> (0 until a.length()).map { a.optInt(it) } } ?: listOf(5, 6, 8, 10)
    // لینک به‌روزرسانی: اول لینک مخصوص همین فروشگاه (app.urls.<bazaar|myket>)، وگرنه url عمومی قدیمی
    val appObj = j.optJSONObject("app")
    val storeUrl = appObj?.optJSONObject("urls")?.optString(Store.ID).orEmpty()
    // نسخه‌ی مخصوص همین فروشگاه (app.stores.<bazaar|myket>)، وگرنه مقدار عمومی قدیمی app.latest/min
    val storeVer = appObj?.optJSONObject("stores")?.optJSONObject(Store.ID)
    return Config(
        templates = j.optJSONArray("templates").objects().map { Opt(it.str("key"), (it.str("emoji") + " " + it.str("name")).trim(), null, it.str("hint")) },
        themes = j.optJSONArray("themes").objects().map { Opt(it.str("key"), it.str("name"), it.str("primary").ifEmpty { null }) },
        tones = toneList,
        fonts = fonts,
        slideChoices = slides,
        payEnabled = j.optBoolean("payEnabled"),
        otp = j.optBoolean("otp"),
        link = j.optBoolean("link"),
        models = j.optJSONArray("models").objects().map { ModelOpt(it.str("id"), it.str("name"), it.str("brand"), it.optBoolean("free", true)) },
        poster = j.optBoolean("poster"),
        pdf = j.optBoolean("pdf"),
        audio = j.optBoolean("audio"),
        voice = j.optBoolean("voice"),
        googleClientId = if (j.optBoolean("google")) j.str("googleClientId") else "",
        emailOtp = j.optBoolean("emailOtp"),
        dailyFree = j.optInt("dailyFree"),
        bazaar = j.optBoolean(Store.ID), // «bazaar» در نسخه‌ی بازار، «myket» در نسخه‌ی مایکت
        latestVersion = storeVer?.optInt("latest") ?: appObj?.optInt("latest") ?: 0,
        minVersion = storeVer?.optInt("min") ?: appObj?.optInt("min") ?: 0,
        updateUrl = storeUrl.ifEmpty { Store.updateUrl(appObj?.optString("url").orEmpty()) },
    )
}

fun parseMe(j: JSONObject): Me? {
    val u = j.optJSONObject("user") ?: return null
    val cr = j.optJSONObject("credit")
    val st = j.optJSONObject("settings") ?: JSONObject()
    return Me(
        name = u.str("name"),
        mobile = u.str("mobile"),
        email = u.str("email"),
        unlimited = cr?.optBoolean("unlimited") ?: false,
        premium = j.optBoolean("premium"),
        credits = cr?.optInt("total") ?: 0,
        maxSlides = j.optInt("maxSlides", 6),
        maxImages = j.optInt("maxImages", 1),
        planExp = j.optJSONObject("plan")?.optLong("exp") ?: 0L,
        planCredits = cr?.optInt("plan") ?: 0,
        bonus = cr?.optInt("bonus") ?: 0,
        dailyFree = j.optBoolean("dailyFree"),
        planId = j.optJSONObject("plan")?.str("id")?.ifEmpty { null },
        settings = Settings(
            theme = st.str("theme"), template = st.str("template"), tone = st.str("tone"), font = st.str("font"),
            slides = st.optInt("slides", 6), model = st.str("model"),
            mode = st.str("mode").ifEmpty { "normal" },
            digits = st.optBoolean("digits"), sources = st.optBoolean("sources"), questions = st.optBoolean("questions"),
            images = st.optBoolean("images", true), imagesMany = st.optBoolean("imagesMany", false), notes = st.optBoolean("notes", true),
        ),
        activeJob = j.str("activeJob").ifEmpty { null },
        plans = j.optJSONArray("plans").objects().map {
            PlanInfo(it.str("id"), it.str("name"), it.optInt("price"), it.optInt("credits"), it.optInt("days"), it.optInt("maxSlides"), it.optInt("maxImages"), it.str("url"))
        },
        support = j.str("support"),
        decks = j.optInt("decks"),
        giftAvailable = j.optJSONObject("contactReward")?.optBoolean("available") ?: false,
        giftCredits = j.optJSONObject("contactReward")?.optInt("credits") ?: 0,
        giftNote = j.optJSONObject("contactReward")?.str("note") ?: "",
        adEvery = j.optJSONObject("adReward")?.optInt("every", 5) ?: 5,
        adProgress = j.optJSONObject("adReward")?.optInt("progress") ?: 0,
        adCredits = j.optJSONObject("adReward")?.optInt("credits", 1) ?: 1,
        adLeft = j.optJSONObject("adReward")?.optInt("left", 99) ?: 99,
        giftMissing = j.optJSONObject("contactReward")?.optJSONArray("missing")?.let { a -> (0 until a.length()).map { i -> a.optString(i) } } ?: emptyList(),
        channels = j.optJSONArray("channels").objects().map {
            ChannelInfo(it.str("key"), it.str("label"), it.optBoolean("connected"), if (it.isNull("shown")) "" else it.optString("shown"), it.optBoolean("notify"), it.optBoolean("available"), it.optBoolean("canUnlink"))
        },
        devices = j.optJSONObject("devices")?.let { Devices(it.optBoolean("app"), it.optBoolean("web"), it.optBoolean("email")) } ?: Devices(),
    )
}

fun parseFiles(j: JSONObject): List<FileItem> =
    j.optJSONArray("files").objects().map {
        FileItem(
            it.str("id"), it.str("title"), it.optInt("slides"), it.optLong("t"), it.optBoolean("poster"), it.optBoolean("handout"), it.str("audio"),
            it.optJSONArray("extras")?.let { a -> (0 until a.length()).map { i -> a.optString(i) }.filter { k -> k in EXTRA_KINDS } } ?: emptyList(),
            it.optBoolean("sample"), it.optBoolean("pdf"), it.str("label"),
        )
    }

/** انواع همراهِ بعد از ساخت ارائه (همان کلیدهای سرور) به ترتیب نمایش دکمه‌ها */
val EXTRA_KINDS = listOf("audio", "podcast", "handout", "poster")

/** ارقام فارسی/عربی را به لاتین تبدیل می‌کند (برای ارسال به سرور). */
fun normDigits(s: String): String = buildString {
    for (c in s.trim()) {
        append(
            when (c) {
                in '۰'..'۹' -> '0' + (c - '۰')
                in '٠'..'٩' -> '0' + (c - '٠')
                else -> c
            }
        )
    }
}

/**
 * شماره‌ی موبایل ایران را به شکل استاندارد 09xxxxxxxxx برمی‌گرداند؛ اگر معتبر نبود null.
 * ورودی‌های قابل قبول: 09123456789، 9123456789، +989123456789، 00989123456789، 989123456789 (با ارقام فارسی و فاصله/خط تیره).
 */
/** ایمیلِ تمیزشده (حروف کوچک)؛ نامعتبر = null. */
fun normalizeEmail(raw: String): String? =
    raw.trim().lowercase().takeIf { it.length <= 254 && Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$").matches(it) }

/** کادر ورود مثل وب هم موبایل می‌گیرد هم ایمیل: اگر «@» داشته باشد ایمیل است. نامعتبر = null. */
fun normalizeLoginId(raw: String): String? = if ('@' in raw) normalizeEmail(raw) else normalizeIranMobile(raw)

fun normalizeIranMobile(raw: String): String? {
    var d = normDigits(raw).filter { it.isDigit() || it == '+' }
    d = when {
        d.startsWith("+98") -> d.substring(3)
        d.startsWith("0098") -> d.substring(4)
        d.startsWith("98") && d.length == 12 -> d.substring(2)
        else -> d
    }.removePrefix("0")
    return if (Regex("^9\\d{9}$").matches(d)) "0$d" else null
}

/** اولین رشته‌ی ۴ تا ۸ رقمی در پیامک (کد تأیید) را برمی‌گرداند. */
fun extractOtp(sms: String): String? = Regex("(?<!\\d)\\d{4,8}(?!\\d)").find(normDigits(sms))?.value

/** ارقام لاتین را برای نمایش فارسی می‌کند. */
fun Int.fa(): String = toString().map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")

/** عدد با جداکننده‌ی هزارگان و ارقام فارسی (مثلاً ۱٬۱۴۰). */
fun Int.faGrouped(): String = toString().reversed().chunked(3).joinToString("٬").reversed().map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")
