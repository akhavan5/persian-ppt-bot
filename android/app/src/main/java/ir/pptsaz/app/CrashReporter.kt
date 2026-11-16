package ir.pptsaz.app

import android.app.Application
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * گزارش کرش بدون کتابخانه‌ی اضافه: هنگام کرش، مشخصات حداقلی (نسخه‌ی اپ، مدل گوشی، متن خطا) در یک فایل کوچک ذخیره می‌شود
 * و دفعه‌ی بعد که اپ باز شد (با اینترنت) به سرور خودمان فرستاده و پاک می‌شود. هیچ اطلاعات حساب یا محتوای کاربر ارسال نمی‌شود.
 */
object CrashReporter {
    private const val FILE = "pending_crash.json"
    private const val MAX_AGE_MS = 7L * 24 * 3600 * 1000

    fun install(app: Application) {
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            if (isBazaarUpdaterGlitch(e)) return@setDefaultUncaughtExceptionHandler // باگ داخلی BazaarUpdater (unbind دوباره‌ی سرویس)؛ اپ نباید به‌خاطرش بسته شود
            try {
                val sw = StringWriter()
                e.printStackTrace(PrintWriter(sw))
                val j = JSONObject()
                    .put("v", BuildConfig.VERSION_NAME)
                    .put("c", BuildConfig.VERSION_CODE)
                    .put("sdk", Build.VERSION.SDK_INT)
                    .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                    .put("thread", t.name)
                    .put("t", System.currentTimeMillis())
                    .put("trace", sw.toString().take(6000))
                File(app.filesDir, FILE).writeText(j.toString())
            } catch (_: Throwable) {
            }
            prev?.uncaughtException(t, e)
        }
    }

    /** IllegalArgumentException «Service not registered» که از داخل کتابخانه‌ی BazaarUpdater روی thread خودش پرتاب می‌شود (SDK یک اتصال را دوبار unbind می‌کند). */
    private fun isBazaarUpdaterGlitch(e: Throwable): Boolean =
        e is IllegalArgumentException && e.message?.contains("Service not registered") == true &&
            e.stackTrace.any { it.className.startsWith("com.farsitel.bazaar.updater") }

    /** اگر گزارش کرشِ ارسال‌نشده‌ای هست می‌فرستد؛ در صورت خطای شبکه فایل می‌ماند تا دفعه‌ی بعد. */
    suspend fun sendPending(app: Application) {
        val f = File(app.filesDir, FILE)
        if (!f.exists()) return
        val j = try { JSONObject(f.readText()) } catch (_: Exception) { f.delete(); return }
        if (System.currentTimeMillis() - j.optLong("t") > MAX_AGE_MS) { f.delete(); return }
        try {
            Api.reportCrash(j)
            f.delete()
        } catch (_: Exception) {
        }
    }
}
