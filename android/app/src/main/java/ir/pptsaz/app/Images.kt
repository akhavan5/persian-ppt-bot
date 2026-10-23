package ir.pptsaz.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import java.io.IOException

object Images {
    /** عکس‌های گوشی معمولاً از سقف ۴ مگابایتی سرور بزرگ‌ترند؛ پس کوچک و JPEG می‌شوند. */
    fun shrink(bytes: ByteArray, maxBytes: Int = 3_500_000): ByteArray {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2400) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: throw IOException("decode failed")
        var q = 88
        while (true) {
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
            val b = out.toByteArray()
            if (b.size <= maxBytes || q <= 40) {
                bmp.recycle()
                return b
            }
            q -= 12
        }
    }
}
