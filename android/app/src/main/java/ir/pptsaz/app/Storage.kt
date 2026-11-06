package ir.pptsaz.app

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

/**
 * ذخیره‌ی فایل: اندروید ۱۰+ در پوشه‌ی Downloads عمومی (MediaStore).
 * اندروید ۷ تا ۹ بدون مجوز حافظه نمی‌تواند در Downloads عمومی بنویسد؛ پس در حافظه‌ی اختصاصی اپ (با FileProvider) ذخیره می‌شود
 * و Saved.isPublic = false برمی‌گردد تا اپ «ذخیره در گوشی» (ACTION_CREATE_DOCUMENT) را به کاربر پیشنهاد دهد.
 */
object Storage {
    private fun cleanName(raw: String, mime: String): String {
        var n = raw.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim().trimStart('.')
        if (n.isEmpty()) {
            val ext = if (mime.isEmpty()) null else MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
            n = "file-" + System.currentTimeMillis() + if (ext != null) ".$ext" else ""
        }
        return n.take(120)
    }

    private fun uniqueFile(dir: File, name: String): File {
        var f = File(dir, name)
        val base = name.substringBeforeLast('.', name)
        val ext = name.substringAfterLast('.', "")
        var i = 1
        while (f.exists()) {
            f = File(dir, if (ext.isEmpty()) "$base ($i)" else "$base ($i).$ext")
            i++
        }
        return f
    }

    fun save(ctx: Context, rawName: String, rawMime: String, bytes: ByteArray): Saved {
        val name = cleanName(rawName, rawMime)
        val mime = rawMime.ifEmpty {
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
        } ?: "application/octet-stream"

        val uri: Uri
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = ctx.contentResolver
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IOException("insert failed")
            val out = resolver.openOutputStream(uri) ?: throw IOException("open failed")
            out.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } else {
            // اگر حافظه‌ی خارجی در دسترس نبود، پوشه‌ی داخلی (در file_paths.xml تعریف شده است)
            val dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: File(ctx.filesDir, "downloads")
            dir.mkdirs()
            val f = uniqueFile(dir, name)
            f.writeBytes(bytes)
            uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)
        }
        return Saved(uri, mime, name, isPublic = Build.VERSION.SDK_INT >= 29)
    }

    /**
     * کپی موقتی فایل در کش اپ با آدرس FileProvider؛ وقتی startActivity با آدرس MediaStore به SecurityException می‌خورد
     * (در اندروید ۱۱+ و به‌ویژه MIUI/HyperOS گاهی مالکیت ردیف Downloads عوض می‌شود) از این استفاده می‌شود.
     * اگر کپی ممکن نشد null برمی‌گرداند.
     */
    fun cacheCopy(ctx: Context, f: Saved): Saved? = try {
        val dir = File(ctx.cacheDir, "share").apply { mkdirs() }
        dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 3_600_000L) it.delete() }
        val out = uniqueFile(dir, cleanName(f.name, f.mime))
        val inp = ctx.contentResolver.openInputStream(f.uri) ?: throw IOException("open source failed")
        inp.use { i -> out.outputStream().use { o -> i.copyTo(o) } }
        Saved(FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", out), f.mime, f.name, isPublic = false)
    } catch (_: Exception) { null }

    /** محتوای فایل ذخیره‌شده را به مقصدی که کاربر با «ذخیره در گوشی» انتخاب کرده کپی می‌کند. */
    fun copyTo(ctx: Context, src: Uri, dest: Uri) {
        val inp = ctx.contentResolver.openInputStream(src) ?: throw IOException("open source failed")
        val out = ctx.contentResolver.openOutputStream(dest) ?: throw IOException("open dest failed")
        inp.use { i -> out.use { o -> i.copyTo(o) } }
    }
}
