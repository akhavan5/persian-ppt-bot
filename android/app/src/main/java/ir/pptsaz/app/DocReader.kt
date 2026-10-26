package ir.pptsaz.app

import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.util.zip.ZipInputStream

/** خواندن متن فایل Word (.docx) و متنی (.txt) روی خود گوشی؛ نیازی به سرور نیست. */
object DocReader {
    const val DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    fun docxToText(bytes: ByteArray): String {
        var xml: String? = null
        ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (e.name == "word/document.xml") {
                    xml = String(z.readBytes(), Charsets.UTF_8)
                    break
                }
            }
        }
        val x = xml ?: throw IllegalArgumentException("not a docx")
        return x
            .replace(Regex("</w:p>"), "\n")
            .replace(Regex("<w:br\\s*/>|<w:cr\\s*/>"), "\n")
            .replace(Regex("<w:tab\\s*/>"), "\t")
            .replace(Regex("<[^>]+>"), "")
            .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
    }

    /**
     * متن ساده را با تشخیص رمزگذاری می‌خواند. فایل‌های txt فارسیِ ویندوز اغلب UTF-16 (گزینه‌ی «Unicode» در Notepad)
     * یا Windows-1256 هستند و خواندن اجباریِ UTF-8 آن‌ها را به کاراکترهای بی‌معنی تبدیل می‌کرد.
     * ترتیب: BOM یونیکد ← UTF-8 دقیق ← Windows-1256.
     */
    fun plainText(bytes: ByteArray): String {
        val text = when {
            bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte() -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
            bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte() -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
            else -> decodeUtf8OrLegacy(bytes)
        }
        return text.removePrefix("\uFEFF").trim()
    }

    private fun decodeUtf8OrLegacy(bytes: ByteArray): String =
        try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: CharacterCodingException) {
            // Windows-1256 «ی» و «ک» فارسی ندارد و فایل‌های قدیمی از «ي» و «ك» عربی استفاده می‌کنند؛ برای متن فارسی به شکل درستشان برمی‌گردانیم
            String(bytes, try { Charset.forName("windows-1256") } catch (_: Exception) { Charsets.ISO_8859_1 })
                .replace('\u064A', '\u06CC')
                .replace('\u0643', '\u06A9')
        }
}
