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

/** ذخیره‌ی فایل در پوشه‌ی Downloads (اندروید ۱۰+ با MediaStore؛ نسخه‌های قدیمی‌تر در پوشه‌ی اختصاصی اپ و با FileProvider). */
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
            val dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: ctx.filesDir
            dir.mkdirs()
            val f = uniqueFile(dir, name)
            f.writeBytes(bytes)
            uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)
        }
        return Saved(uri, mime, name)
    }
}
