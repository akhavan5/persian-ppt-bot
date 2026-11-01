package ir.pptsaz.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/** بررسی/نصب به‌روزرسانی در مایکت: اینتنت myket://check-update (مایکت ۹.۸.۹ به بعد). */
object StoreUpdate {
    fun check(ctx: Context, manual: Boolean, fallbackUrl: String, say: (String) -> Unit, needUpdate: () -> Unit, openUrl: (String) -> Unit) {
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("myket://check-update?id=" + BuildConfig.APPLICATION_ID)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            if (manual) say("بررسی نسخه در مایکت انجام شد؛ اگر نسخه‌ی جدیدی باشد پیشنهاد می‌شود")
        } catch (_: ActivityNotFoundException) {
            if (manual) openUrl(fallbackUrl) // کلاینت مایکت نصب نیست
        }
    }

    fun install(ctx: Context, url: String, openUrl: (String) -> Unit) = openUrl(url)
}
