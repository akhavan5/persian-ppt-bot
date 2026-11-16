package ir.pptsaz.app

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean
// TODO: نام بسته‌ی دقیق کلاس‌ها را با Alt+Enter در Android Studio اصلاح کنید (مستندات بازار import نشان نمی‌دهد)
import com.farsitel.bazaar.updater.BazaarUpdater
import com.farsitel.bazaar.updater.UpdateResult

/** بررسی/نصب به‌روزرسانی در بازار با BazaarUpdater SDK (بازار ۲۶.۲.۰ به بعد، امضای یکسان با نسخه‌ی منتشرشده). */
object StoreUpdate {
    /** هم‌زمان فقط یک بررسی: چند فراخوانیِ هم‌پوشان باعث unbind دوباره‌ی سرویس در SDK و کرش «Service not registered» می‌شد. */
    private val busy = AtomicBoolean(false)

    fun check(ctx: Context, manual: Boolean, fallbackUrl: String, say: (String) -> Unit, needUpdate: () -> Unit, openUrl: (String) -> Unit) {
        fun main(block: () -> Unit) { if (ctx is Activity) ctx.runOnUiThread(block) else block() }
        if (!busy.compareAndSet(false, true)) return
        val app = ctx.applicationContext ?: ctx // با Context برنامه، نه Activity؛ تا بستن/چرخش صفحه اتصال سرویس را نیندازد
        Handler(Looper.getMainLooper()).postDelayed({ busy.set(false) }, 15_000) // اگر SDK هیچ‌وقت جواب نداد قفل باز شود
        try {
            BazaarUpdater.getLastUpdateState(context = app) { result ->
                busy.set(false)
                main {
                    when (result) {
                        UpdateResult.AlreadyUpdated -> if (manual) say("نسخه‌ی شما به‌روز است ✓")
                        is UpdateResult.NeedUpdate -> needUpdate()
                        is UpdateResult.Error -> if (manual) openUrl(fallbackUrl) // بازار نصب/قدیمی است یا امضا فرق دارد
                    }
                }
            }
        } catch (_: Throwable) {
            busy.set(false)
            if (manual) openUrl(fallbackUrl)
        }
    }

    /** نصب درون‌برنامه‌ای؛ اگر نشد صفحه‌ی اپ در بازار باز می‌شود. */
    fun install(ctx: Context, url: String, openUrl: (String) -> Unit) {
        try { BazaarUpdater.updateApplication(context = ctx.applicationContext ?: ctx) } catch (_: Throwable) { openUrl(url) }
    }
}
