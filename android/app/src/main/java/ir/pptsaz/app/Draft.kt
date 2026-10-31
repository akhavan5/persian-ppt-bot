package ir.pptsaz.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** پیش‌نویس فرم «ساخت» روی خود گوشی؛ اگر اپ وسط تایپ بسته شود، دفعه‌ی بعد همان متن برمی‌گردد. با خروج از حساب پاک می‌شود. */
object Draft {
    private fun p(ctx: Context) = ctx.getSharedPreferences("draft", Context.MODE_PRIVATE)

    fun load(ctx: Context): CreateForm {
        val p = p(ctx)
        return CreateForm(
            topic = p.getString("topic", "").orEmpty(),
            source = p.getString("source", "").orEmpty(),
            handout = p.getBoolean("handout", true),
            poster = p.getString("poster", "wide").orEmpty(),
            audio = p.getBoolean("audio", true),
            podcast = p.getBoolean("podcast", true),
        )
    }

    fun save(ctx: Context, f: CreateForm) {
        p(ctx).edit()
            .putString("topic", f.topic)
            .putString("source", f.source.take(120_000))
            .putBoolean("handout", f.handout)
            .putString("poster", f.poster)
            .putBoolean("audio", f.audio)
            .putBoolean("podcast", f.podcast)
            .apply()
    }

    fun clear(ctx: Context) {
        p(ctx).edit().clear().apply()
    }
}

/** کش فهرست فایل‌ها (فقط مواردی که هنوز در ۲۴ ساعت اخیرند) تا باز کردن اپ با اینترنت ضعیف، تب فایل‌ها را خالی نکند. */
object FileCache {
    private const val DAY = 24L * 3600 * 1000
    private fun p(ctx: Context) = ctx.getSharedPreferences("cache", Context.MODE_PRIVATE)

    fun save(ctx: Context, list: List<FileItem>) {
        val a = JSONArray()
        list.forEach {
            a.put(JSONObject().put("id", it.id).put("title", it.title).put("slides", it.slides).put("t", it.t).put("poster", it.poster).put("handout", it.handout).put("audio", it.audio).put("extras", JSONArray(it.extras)))
        }
        p(ctx).edit().putString("files", a.toString()).apply()
    }

    fun load(ctx: Context): List<FileItem> = try {
        val a = JSONArray(p(ctx).getString("files", "[]"))
        val now = System.currentTimeMillis()
        (0 until a.length()).mapNotNull { a.optJSONObject(it) }
            .map {
                FileItem(
                    it.optString("id"), it.optString("title"), it.optInt("slides"), it.optLong("t"), it.optBoolean("poster"), it.optBoolean("handout"), it.optString("audio"),
                    it.optJSONArray("extras")?.let { a -> (0 until a.length()).map { i -> a.optString(i) }.filter { k -> k in EXTRA_KINDS } } ?: emptyList(),
                )
            }
            .filter {
                val ms = if (it.t in 1..9_999_999_999L) it.t * 1000 else it.t // سرور ثانیه یا میلی‌ثانیه بفرستد هر دو درست است
                it.id.isNotEmpty() && now - ms < DAY
            }
    } catch (_: Exception) {
        emptyList()
    }

    fun clear(ctx: Context) {
        p(ctx).edit().clear().apply()
    }
}
