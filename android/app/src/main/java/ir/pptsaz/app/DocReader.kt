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
    const val PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    const val XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    /** پسوندهایی که مثل txt خوانده می‌شوند (HTML جدا پاک‌سازی می‌شود). */
    val TEXT_EXTS = setOf("txt", "md", "csv", "json")
    val HTML_EXTS = setOf("html", "htm")

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

    private fun unescape(t: String) = t
        .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&nbsp;", " ")
        .replace(Regex("&#(\\d+);")) { m -> m.groupValues[1].toIntOrNull()?.let { String(Character.toChars(it)) } ?: m.value }
        .replace(Regex("&#[xX]([0-9a-fA-F]+);")) { m -> m.groupValues[1].toIntOrNull(16)?.let { String(Character.toChars(it)) } ?: m.value }
        .replace("&amp;", "&")

    private fun zipEntries(bytes: ByteArray, want: (String) -> Boolean): Map<String, String> {
        val out = HashMap<String, String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (want(e.name)) out[e.name] = String(z.readBytes(), Charsets.UTF_8)
            }
        }
        return out
    }

    private fun num(name: String) = Regex("\\d+").find(name.substringAfterLast('/'))?.value?.toIntOrNull() ?: 0

    /** متن اسلایدهای PowerPoint (.pptx) به‌ترتیب شماره‌ی اسلاید؛ مثل نسخه‌ی وب. */
    fun pptxToText(bytes: ByteArray): String {
        val slides = zipEntries(bytes) { Regex("ppt/slides/slide\\d+\\.xml").matches(it) }
        if (slides.isEmpty()) throw IllegalArgumentException("not a pptx")
        val out = ArrayList<String>()
        for ((i, n) in slides.keys.sortedBy { num(it) }.withIndex()) {
            val paras = Regex("<a:p[ >].*?</a:p>", RegexOption.DOT_MATCHES_ALL).findAll(slides.getValue(n)).map { p ->
                Regex("<a:t[^>]*>(.*?)</a:t>", RegexOption.DOT_MATCHES_ALL).findAll(p.value).joinToString("") { unescape(it.groupValues[1]) }
            }.filter { it.isNotBlank() }.toList()
            if (paras.isNotEmpty()) out += "# اسلاید ${i + 1}\n" + paras.joinToString("\n")
        }
        return out.joinToString("\n\n").trim()
    }

    /** محتوای برگه‌های Excel (.xlsx)؛ تا ۲۰۰ ردیف از هر برگه، ستون‌ها با تب جدا می‌شوند. */
    fun xlsxToText(bytes: ByteArray): String {
        val files = zipEntries(bytes) { it == "xl/sharedStrings.xml" || Regex("xl/worksheets/sheet\\d+\\.xml").matches(it) }
        val sheets = files.keys.filter { it.startsWith("xl/worksheets/") }.sortedBy { num(it) }
        if (sheets.isEmpty()) throw IllegalArgumentException("not an xlsx")
        val shared = files["xl/sharedStrings.xml"]?.let { x ->
            Regex("<si>(.*?)</si>", RegexOption.DOT_MATCHES_ALL).findAll(x).map { si ->
                Regex("<t[^>]*>(.*?)</t>", RegexOption.DOT_MATCHES_ALL).findAll(si.groupValues[1]).joinToString("") { unescape(it.groupValues[1]) }
            }.toList()
        } ?: emptyList()
        val out = ArrayList<String>()
        for ((i, n) in sheets.withIndex()) {
            val rows = Regex("<row[ >].*?</row>", RegexOption.DOT_MATCHES_ALL).findAll(files.getValue(n)).take(200).map { r ->
                Regex("<c ([^>]*?)(?:/>|>(.*?)</c>)", RegexOption.DOT_MATCHES_ALL).findAll(r.value).joinToString("\t") { c ->
                    val attrs = c.groupValues[1]; val body = c.groupValues[2]
                    val t = Regex("""\bt="([^"]*)"""").find(attrs)?.groupValues?.get(1)
                    val v = Regex("<v>(.*?)</v>", RegexOption.DOT_MATCHES_ALL).find(body)?.groupValues?.get(1)
                    when (t) {
                        "s" -> shared.getOrNull(v?.toIntOrNull() ?: -1).orEmpty()
                        "inlineStr" -> Regex("<t[^>]*>(.*?)</t>", RegexOption.DOT_MATCHES_ALL).findAll(body).joinToString("") { unescape(it.groupValues[1]) }
                        else -> unescape(v.orEmpty())
                    }
                }
            }.filter { it.replace("\t", "").isNotBlank() }.toList()
            if (rows.isNotEmpty()) out += "# برگه ${i + 1}\n" + rows.joinToString("\n")
        }
        return out.joinToString("\n\n").trim()
    }

    /** متن صفحه‌ی HTML بدون تگ، اسکریپت و استایل. */
    fun htmlToText(html: String): String = unescape(
        html.replace(Regex("(?is)<(script|style|noscript)[^>]*>.*?</\\1>"), " ")
            .replace(Regex("(?i)<br\\s*/?>|</(p|div|li|h[1-6]|tr)>"), "\n")
            .replace(Regex("<[^>]+>"), " ")
    ).replace(Regex("[ \\t\\u00A0]+"), " ").replace(Regex(" ?\n ?"), "\n").replace(Regex("\n{3,}"), "\n\n").trim()

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
