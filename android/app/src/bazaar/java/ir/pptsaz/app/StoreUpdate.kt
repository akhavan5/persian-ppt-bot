package ir.pptsaz.app

import android.app.Activity
import android.content.Context
// TODO: نام بسته‌ی دقیق کلاس‌ها را با Alt+Enter در Android Studio اصلاح کنید (مستندات بازار import نشان نمی‌دهد)
import com.farsitel.bazaar.updater.BazaarUpdater
import com.farsitel.bazaar.updater.UpdateResult

/** بررسی/نصب به‌روزرسانی در بازار با BazaarUpdater SDK (بازار ۲۶.۲.۰ به بعد، امضای یکسان با نسخه‌ی منتشرشده). */
object StoreUpdate {
    fun check(ctx: Context, manual: Boolean, fallbackUrl: String, say: (String) -> Unit, needUpdate: () -> Unit, openUrl: (String) -> Unit) {
        fun main(block: () -> Unit) { if (ctx is Activity) ctx.runOnUiThread(block) else block() }
        try {
            BazaarUpdater.getLastUpdateState(context = ctx) { result ->
                main {
                    when (result) {
                        UpdateResult.AlreadyUpdated -> if (manual) say("نسخه‌ی شما به‌روز است ✓")
                        is UpdateResult.NeedUpdate -> needUpdate()
                        is UpdateResult.Error -> if (manual) openUrl(fallbackUrl) // بازار نصب/قدیمی است یا امضا فرق دارد
                    }
                }
            }
        } catch (_: Throwable) {
            if (manual) openUrl(fallbackUrl)
        }
    }

    /** نصب درون‌برنامه‌ای؛ اگر نشد صفحه‌ی اپ در بازار باز می‌شود. */
    fun install(ctx: Context, url: String, openUrl: (String) -> Unit) {
        try { BazaarUpdater.updateApplication(context = ctx) } catch (_: Throwable) { openUrl(url) }
    }
}
