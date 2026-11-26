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
            handout = p.getBoolean("handout", false),
            poster = p.getString("poster", "").orEmpty(),
            audio = p.getBoolean("audio", false),
            podcast = p.getBoolean("podcast", false),
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
            a.put(JSONObject().put("id", it.id).put("title", it.title).put("slides", it.slides).put("t", it.t).put("poster", it.poster).put("handout", it.handout).put("audio", it.audio).put("extras", JSONArray(it.extras)).put("sample", it.sample).put("pdf", it.pdf).put("label", it.label))
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
                    it.optBoolean("sample"), it.optBoolean("pdf"), it.optString("label"),
                )
            }
            .filter {
                val ms = if (it.t in 1..9_999_999_999L) it.t * 1000 else it.t // سرور ثانیه یا میلی‌ثانیه بفرستد هر دو درست است
                it.id.isNotEmpty() && (it.sample || now - ms < DAY) // نمونه‌ها دائمی‌اند
            }
    } catch (_: Exception) {
        emptyList()
    }

    fun clear(ctx: Context) {
        p(ctx).edit().clear().apply()
    }
}

/** آخرین «دعوت دوستان» روی خود گوشی؛ کارت دعوت بعد از هر بار باز کردن اپ فوراً با آخرین مقدار دیده می‌شود و فقط عدد در پس‌زمینه به‌روز می‌شود. با خروج از حساب پاک می‌شود. */
object InviteCache {
    private fun p(ctx: Context) = ctx.getSharedPreferences("invite", Context.MODE_PRIVATE)

    fun save(ctx: Context, d: InviteInfo) {
        p(ctx).edit()
            .putString("link", d.link).putInt("count", d.count).putInt("max", d.max).putInt("every", d.every).putBoolean("canClaim", d.canClaim)
            .apply()
    }

    fun load(ctx: Context): InviteInfo? {
        val p = p(ctx)
        val link = p.getString("link", "").orEmpty()
        if (link.isEmpty()) return null
        return InviteInfo(link, p.getInt("count", 0), p.getInt("max", 50), p.getInt("every", 2), p.getBoolean("canClaim", false))
    }

    fun clear(ctx: Context) {
        p(ctx).edit().clear().apply()
    }
}
