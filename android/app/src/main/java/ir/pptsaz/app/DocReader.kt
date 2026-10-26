package ir.pptsaz.app

import java.io.ByteArrayInputStream
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

    fun plainText(bytes: ByteArray): String = String(bytes, Charsets.UTF_8).removePrefix("\uFEFF").trim()
}
