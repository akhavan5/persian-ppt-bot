package ir.pptsaz.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** تست‌های واحد منطق خالص (بدون نیاز به امولاتور): شماره‌ی موبایل، کد پیامکی و خواندن فایل‌های متنی/Word. */
class ParsingTest {

    @Test
    fun mobile_acceptsCommonFormats() {
        val expected = "09123456789"
        assertEquals(expected, normalizeIranMobile("09123456789"))
        assertEquals(expected, normalizeIranMobile("9123456789"))
        assertEquals(expected, normalizeIranMobile("+989123456789"))
        assertEquals(expected, normalizeIranMobile("00989123456789"))
        assertEquals(expected, normalizeIranMobile("989123456789"))
        assertEquals(expected, normalizeIranMobile("۰۹۱۲-۳۴۵ ۶۷۸۹")) // ارقام فارسی با خط تیره و فاصله
        assertEquals(expected, normalizeIranMobile("٠٩١٢٣٤٥٦٧٨٩")) // ارقام عربی
    }

    @Test
    fun mobile_rejectsInvalid() {
        assertNull(normalizeIranMobile(""))
        assertNull(normalizeIranMobile("0812345678")) // با ۹ شروع نمی‌شود
        assertNull(normalizeIranMobile("091234567")) // کوتاه
        assertNull(normalizeIranMobile("091234567890")) // بلند
        assertNull(normalizeIranMobile("abc"))
    }

    @Test
    fun otp_findsFirstStandaloneCode() {
        assertEquals("123456", extractOtp("کد ورود شما به پاورپوینت‌ساز: ۱۲۳۴۵۶"))
        assertEquals("4821", extractOtp("09123456789 کد: 4821"))
        assertNull(extractOtp("بدون کد"))
        assertNull(extractOtp("123")) // کوتاه‌تر از ۴ رقم
        assertNull(extractOtp("123456789")) // بلندتر از ۸ رقم، کد نیست
    }

    @Test
    fun plainText_utf8() {
        assertEquals("سلام دنیا", DocReader.plainText("سلام دنیا".toByteArray(Charsets.UTF_8)))
    }

    @Test
    fun plainText_utf8WithBom() {
        val bytes = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "سلام".toByteArray(Charsets.UTF_8)
        assertEquals("سلام", DocReader.plainText(bytes))
    }

    @Test
    fun plainText_utf16WithBom() {
        // گزینه‌ی «Unicode» در Notepad ویندوز: UTF-16 little-endian با BOM
        val le = byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + "ارائه‌ی فارسی".toByteArray(Charsets.UTF_16LE)
        assertEquals("ارائه‌ی فارسی", DocReader.plainText(le))
        val be = byteArrayOf(0xFE.toByte(), 0xFF.toByte()) + "ارائه".toByteArray(Charsets.UTF_16BE)
        assertEquals("ارائه", DocReader.plainText(be))
    }

    @Test
    fun plainText_windows1256_fixesArabicYehAndKaf() {
        // فایل txt فارسی قدیمی (ANSI ویندوز فارسی) UTF-8 معتبر نیست و با Windows-1256 خوانده می‌شود؛
        // این کدپیج «ی» و «ک» فارسی ندارد و همان‌ها را با «ي» و «ك» عربی ذخیره کرده است، که باید به شکل فارسی برگردند.
        val saved = "پژوهش گروه چهار كتاب سيستم".toByteArray(charset("windows-1256"))
        assertEquals("پژوهش گروه چهار کتاب سیستم", DocReader.plainText(saved))
    }

    @Test
    fun docx_extractsParagraphsAndDecodesEntities() {
        val xml = """<?xml version="1.0"?><w:document><w:body>""" +
            """<w:p><w:r><w:t>سلام</w:t></w:r></w:p>""" +
            """<w:p><w:r><w:t>A &amp; B &lt;ok&gt;</w:t></w:r></w:p>""" +
            """</w:body></w:document>"""
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z ->
            z.putNextEntry(ZipEntry("word/document.xml"))
            z.write(xml.toByteArray(Charsets.UTF_8))
            z.closeEntry()
        }
        assertEquals("سلام\nA & B <ok>", DocReader.docxToText(out.toByteArray()))
    }

    @Test(expected = IllegalArgumentException::class)
    fun docx_withoutDocumentXml_throws() {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z ->
            z.putNextEntry(ZipEntry("other.txt"))
            z.write(byteArrayOf(1))
            z.closeEntry()
        }
        DocReader.docxToText(out.toByteArray())
    }
}
