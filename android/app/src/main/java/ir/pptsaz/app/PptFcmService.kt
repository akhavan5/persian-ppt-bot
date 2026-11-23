package ir.pptsaz.app

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** دریافت اعلان FCM؛ فقط پیام‌های data-only سرور (kind=promo) را می‌پذیرد و اعلان را خودش می‌سازد (هم همگانی ادمین، هم پیام‌های خودکار چرخه‌ی عمر با tag). */
class PptFcmService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // توکن جدید (نصب تازه یا چرخش کلید): اگر کاربر وارد شده باشد ثبت می‌شود؛ وگرنه بعد از ورود sync می‌کند
        CoroutineScope(Dispatchers.IO).launch {
            try {
                Api.init(applicationContext)
                Api.pushRegister(token, Push.promoEnabled(applicationContext), false)
            } catch (_: Exception) {
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        if (d["kind"] != "promo") return
        if (!Push.promoEnabled(this)) return
        val title = d["title"].orEmpty().ifBlank { "پاورپوینت‌ساز" }
        val body = d["body"].orEmpty()
        if (body.isBlank()) return
        // پیام خودکار سرور (tag دارد): اگر همتای محلی‌اش همین الان نشان داده شده، دوباره نشان داده نمی‌شود؛ tab = مقصد با زدن اعلان
        val tag = d["tag"].orEmpty()
        val tab = if (tag.isEmpty()) -1 else (Reminders.onServerPush(this, tag) ?: return)
        Push.showPromo(this, title, body, d["url"], tab)
    }
}
