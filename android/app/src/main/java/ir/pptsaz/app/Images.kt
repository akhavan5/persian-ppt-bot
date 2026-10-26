package ir.pptsaz.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.roundToInt

object Images {
    /**
     * هر عکسی (JPG/PNG/WebP/HEIC/…) را به JPEG با حجم مناسب تبدیل می‌کند:
     *  - جهت EXIF اعمال می‌شود (عکس عمودی دوربین چرخیده به OCR نمی‌رسد)؛
     *  - ضلع بزرگ‌تر حداکثر maxSide پیکسل؛
     *  - پس‌زمینه‌ی شفاف سفید می‌شود (در JPEG سیاه می‌شد)؛
     *  - حجم خروجی زیر maxBytes (سقف ۴ مگابایتی سرور).
     */
    fun normalize(bytes: ByteArray, maxBytes: Int = 3_500_000, maxSide: Int = 2400): ByteArray {
        var side = maxSide
        while (true) {
            val bmp = flattenOnWhite(decode(bytes, side))
            var q = 88
            while (true) {
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
                val b = out.toByteArray()
                if (b.size <= maxBytes) { bmp.recycle(); return b }
                if (q <= 50) break
                q -= 12
            }
            bmp.recycle()
            if (side <= 800) throw IOException("image too large")
            side = (side * 0.75f).roundToInt() // با کیفیت پایین هم زیاد بود؛ کوچک‌ترش می‌کنیم
        }
    }

    private fun decode(bytes: ByteArray, maxSide: Int): Bitmap {
        if (Build.VERSION.SDK_INT >= 28) {
            // ImageDecoder هم HEIC/WebP را می‌خواند و هم جهت EXIF را خودش اعمال می‌کند
            val src = ImageDecoder.createSource(ByteBuffer.wrap(bytes))
            return ImageDecoder.decodeBitmap(src) { dec, info, _ ->
                dec.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val w = info.size.width
                val h = info.size.height
                val m = max(w, h)
                if (m > maxSide) {
                    val k = maxSide.toFloat() / m
                    dec.setTargetSize((w * k).roundToInt().coerceAtLeast(1), (h * k).roundToInt().coerceAtLeast(1))
                }
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > maxSide) sample *= 2
        val raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw IOException("decode failed")
        val orientation = try {
            ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        val m = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
            else -> return raw
        }
        val rotated = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
        if (rotated !== raw) raw.recycle()
        return rotated
    }

    private fun flattenOnWhite(src: Bitmap): Bitmap {
        if (!src.hasAlpha()) return src
        val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        c.drawColor(android.graphics.Color.WHITE)
        c.drawBitmap(src, 0f, 0f, null)
        src.recycle()
        return out
    }
}
