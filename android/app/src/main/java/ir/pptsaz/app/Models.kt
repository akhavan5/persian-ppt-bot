package ir.pptsaz.app

import org.json.JSONArray
import org.json.JSONObject

data class Opt(val key: String, val name: String, val color: String? = null)

data class PlanInfo(val id: String, val name: String, val price: Int, val credits: Int, val days: Int, val maxSlides: Int)

data class Config(
    val templates: List<Opt>,
    val themes: List<Opt>,
    val tones: List<Opt>,
    val fonts: List<String>,
    val slideChoices: List<Int>,
    val payEnabled: Boolean,
    val otp: Boolean,
)

data class Settings(val theme: String, val template: String, val tone: String, val font: String, val slides: Int)

data class Me(
    val name: String,
    val mobile: String,
    val unlimited: Boolean,
    val credits: Int,
    val maxSlides: Int,
    val planId: String?,
    val settings: Settings,
    val activeJob: String?,
    val plans: List<PlanInfo>,
    val support: String,
)

data class FileItem(val id: String, val title: String, val slides: Int, val t: Long, val poster: Boolean, val handout: Boolean)

data class Saved(val uri: android.net.Uri, val mime: String, val name: String)

private fun JSONArray?.objects(): List<JSONObject> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { optJSONObject(it) }
}

private fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key, "")

fun parseConfig(j: JSONObject): Config {
    val tones = j.optJSONObject("tones")
    val toneList = if (tones == null) emptyList() else tones.keys().asSequence().map { Opt(it, tones.optString(it)) }.toList()
    val fonts = j.optJSONArray("fonts")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
    val slides = j.optJSONArray("slideChoices")?.let { a -> (0 until a.length()).map { a.optInt(it) } } ?: listOf(5, 8, 10)
    return Config(
        templates = j.optJSONArray("templates").objects().map { Opt(it.str("key"), (it.str("emoji") + " " + it.str("name")).trim()) },
        themes = j.optJSONArray("themes").objects().map { Opt(it.str("key"), it.str("name"), it.str("primary").ifEmpty { null }) },
        tones = toneList,
        fonts = fonts,
        slideChoices = slides,
        payEnabled = j.optBoolean("payEnabled"),
        otp = j.optBoolean("otp"),
    )
}

fun parseMe(j: JSONObject): Me? {
    val u = j.optJSONObject("user") ?: return null
    val cr = j.optJSONObject("credit")
    val st = j.optJSONObject("settings") ?: JSONObject()
    return Me(
        name = u.str("name"),
        mobile = u.str("mobile"),
        unlimited = cr?.optBoolean("unlimited") ?: false,
        credits = cr?.optInt("total") ?: 0,
        maxSlides = j.optInt("maxSlides", 8),
        planId = j.optJSONObject("plan")?.str("id")?.ifEmpty { null },
        settings = Settings(st.str("theme"), st.str("template"), st.str("tone"), st.str("font"), st.optInt("slides", 8)),
        activeJob = j.str("activeJob").ifEmpty { null },
        plans = j.optJSONArray("plans").objects().map {
            PlanInfo(it.str("id"), it.str("name"), it.optInt("price"), it.optInt("credits"), it.optInt("days"), it.optInt("maxSlides"))
        },
        support = j.str("support"),
    )
}

fun parseFiles(j: JSONObject): List<FileItem> =
    j.optJSONArray("files").objects().map {
        FileItem(it.str("id"), it.str("title"), it.optInt("slides"), it.optLong("t"), it.optBoolean("poster"), it.optBoolean("handout"))
    }

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

/** ارقام لاتین را برای نمایش فارسی می‌کند. */
fun Int.fa(): String = toString().map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")
