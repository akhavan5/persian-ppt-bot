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

    /** خطاهای داخلی کتابخانه‌ی BazaarUpdater که روی thread خودش (Dispatchers.IO) پرتاب می‌شوند و try/catch ما به آن‌ها نمی‌رسد:
     *  ۱) IllegalArgumentException «Service not registered» (SDK یک اتصال را دوبار unbind می‌کند)
     *  ۲) DeadObjectException / RemoteException: پروسه‌ی بازار وسط getRemoteVersionCode مرده (کم‌حافظه، به‌روزرسانی یا بستن بازار)
     *  فقط وقتی نادیده گرفته می‌شود که در ردپا (یا علت‌های آن) کلاسی از com.farsitel.bazaar.updater باشد؛ کرش‌های خودِ اپ همچنان ثبت می‌شوند. */
    private fun isBazaarUpdaterGlitch(e: Throwable): Boolean {
        var c: Throwable? = e
        var depth = 0
        while (c != null && depth++ < 6) {
            val known = (c is IllegalArgumentException && c.message?.contains("Service not registered") == true) ||
                c is android.os.RemoteException || c is android.os.DeadObjectException
            if (known && c.stackTrace.any { it.className.startsWith("com.farsitel.bazaar.updater") }) return true
            c = c.cause
        }
        return false
    }

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
