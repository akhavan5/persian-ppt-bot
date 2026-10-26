package ir.pptsaz.app

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** kind: "deck" (PPTX)، "handout" (جزوه‌ی Word)، "poster" (تصویر پوستر) */
data class LocalFile(val id: String, val title: String, val name: String, val mime: String, val kind: String, val slides: Int, val t: Long, val size: Long)

class LocalBlob(val name: String, val mime: String, val bytes: ByteArray)

/**
 * نسخه‌ی محلیِ فایل‌های ساخته‌شده. فایل‌ها سمت سرور فقط ۲۴ ساعت می‌مانند؛ این‌جا (حافظه‌ی اختصاصی اپ، بدون نیاز به مجوز) تا ۴۰ فایل
 * اخیر نگه داشته می‌شود تا بعد از ۲۴ ساعت یا بدون اینترنت هم بشود دانلود/اشتراک‌گذاری‌شان کرد. با خروج از حساب پاک می‌شود.
 */
object LocalFiles {
    private const val MAX_ITEMS = 40
    private val lock = Any()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("library", Context.MODE_PRIVATE)
    private fun dir(ctx: Context) = File(ctx.filesDir, "library").apply { mkdirs() }

    private fun fileOf(ctx: Context, id: String): File {
        val safe = id.replace(Regex("[^A-Za-z0-9_-]"), "_").take(60)
        return File(dir(ctx), safe + "-" + Integer.toHexString(id.hashCode()) + ".bin")
    }

    /** ذخیره‌ی خودکار بعد از ساخت (پیش‌فرض روشن)؛ از تب «تنظیمات» قابل خاموش‌کردن است. */
    fun autoEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean("auto", true)

    fun setAuto(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean("auto", on).apply()
    }

    private fun readAll(ctx: Context): MutableList<LocalFile> = try {
        val a = JSONArray(prefs(ctx).getString("items", "[]"))
        (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map {
            LocalFile(
                it.optString("id"), it.optString("title"), it.optString("name"), it.optString("mime"),
                it.optString("kind", "deck"), it.optInt("slides"), it.optLong("t"), it.optLong("size"),
            )
        }.filter { it.id.isNotEmpty() }.toMutableList()
    } catch (_: Exception) {
        mutableListOf()
    }

    private fun writeAll(ctx: Context, list: List<LocalFile>) {
        val a = JSONArray()
        list.forEach {
            a.put(
                JSONObject().put("id", it.id).put("title", it.title).put("name", it.name).put("mime", it.mime)
                    .put("kind", it.kind).put("slides", it.slides).put("t", it.t).put("size", it.size),
            )
        }
        prefs(ctx).edit().putString("items", a.toString()).apply()
    }

    /** فهرست از جدید به قدیم؛ موردهایی که فایلشان از بین رفته حذف می‌شوند. */
    fun list(ctx: Context): List<LocalFile> = synchronized(lock) {
        val all = readAll(ctx)
        val ok = all.filter { fileOf(ctx, it.id).exists() }
        if (ok.size != all.size) writeAll(ctx, ok)
        ok.sortedByDescending { it.t }
    }

    fun has(ctx: Context, id: String): Boolean = synchronized(lock) { fileOf(ctx, id).exists() && readAll(ctx).any { it.id == id } }

    fun read(ctx: Context, id: String): LocalBlob? = synchronized(lock) {
        val meta = readAll(ctx).firstOrNull { it.id == id } ?: return null
        val f = fileOf(ctx, id)
        if (!f.exists()) return null
        try { LocalBlob(meta.name, meta.mime, f.readBytes()) } catch (_: Exception) { null }
    }

    fun put(ctx: Context, item: LocalFile, bytes: ByteArray) = synchronized(lock) {
        val f = fileOf(ctx, item.id)
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeBytes(bytes)
        if (f.exists()) f.delete()
        if (!tmp.renameTo(f)) {
            tmp.delete()
            throw java.io.IOException("rename failed")
        }
        val all = readAll(ctx).filter { it.id != item.id }.toMutableList()
        all.add(item.copy(size = bytes.size.toLong()))
        all.sortByDescending { it.t }
        while (all.size > MAX_ITEMS) {
            val old = all.removeAt(all.size - 1)
            fileOf(ctx, old.id).delete()
        }
        writeAll(ctx, all)
    }

    fun remove(ctx: Context, id: String) = synchronized(lock) {
        fileOf(ctx, id).delete()
        writeAll(ctx, readAll(ctx).filter { it.id != id })
    }

    fun clear(ctx: Context) = synchronized(lock) {
        dir(ctx).listFiles()?.forEach { it.delete() }
        prefs(ctx).edit().remove("items").apply()
    }

    /**
     * بعد از آماده‌شدن ارائه، خودِ ارائه (و جزوه/پوستر اگر ساخته شده بود) را بی‌صدا روی گوشی نگه می‌دارد.
     * هم از داخل اپ و هم از کار پس‌زمینه (وقتی اپ بسته است) صدا زده می‌شود. اگر چیزی ذخیره شد true برمی‌گرداند.
     */
    suspend fun autoSave(ctx: Context, jobId: String, title: String, slides: Int, handoutId: String?, posterId: String?): Boolean {
        if (!autoEnabled(ctx)) return false
        val items = listOfNotNull(jobId to "deck", handoutId?.let { it to "handout" }, posterId?.let { it to "poster" })
        var saved = false
        for ((id, kind) in items) {
            if (has(ctx, id)) continue
            try {
                val f = Api.fetchFile(id, maxRetries = 20)
                withContext(Dispatchers.IO) {
                    put(ctx, LocalFile(id, title, f.name, f.mime, kind, if (kind == "deck") slides else 0, System.currentTimeMillis(), 0), f.bytes)
                }
                saved = true
            } catch (_: Exception) {
                // شبکه یا حافظه: بی‌صدا رد می‌شویم؛ کاربر همچنان می‌تواند از سرور دانلود کند
            }
        }
        return saved
    }
}
