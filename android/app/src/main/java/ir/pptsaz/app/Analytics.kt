package ir.pptsaz.app

import android.content.Context
import android.os.Bundle
import com.google.firebase.analytics.FirebaseAnalytics

/**
 * آمار استفاده‌ی اپ با Google Analytics 4 (استریم اندروید ir.pptsaz.app).
 * فقط وقتی کار می‌کند که مقدارهای FIREBASE_* هنگام بیلد ست شده باشند (مثل Push)؛ وگرنه همه‌ی توابع بی‌اثرند.
 * هیچ اطلاعات شخصی (شماره، ایمیل، متن موضوع ارائه) نباید در پارامترها فرستاده شود.
 */
object Analytics {
    private var fa: FirebaseAnalytics? = null

    fun init(ctx: Context) {
        if (!Push.configured) return
        try {
            Push.init(ctx) // FirebaseApp باید با مقدارهای بیلد ساخته شده باشد
            val a = FirebaseAnalytics.getInstance(ctx)
            a.setAnalyticsCollectionEnabled(true)
            a.setUserProperty("store", BuildConfig.STORE)
            fa = a
        } catch (_: Exception) {
        }
    }

    fun log(name: String, vararg params: Pair<String, String>) {
        val a = fa ?: return
        try {
            a.logEvent(name, if (params.isEmpty()) null else Bundle().apply { params.forEach { (k, v) -> putString(k, v.take(100)) } })
        } catch (_: Exception) {
        }
    }

    /** صفحه‌ی اپ تک‌اکتیویتی است؛ برای دیدن تب‌ها در گزارش‌ها screen_view دستی می‌فرستیم. */
    fun screen(name: String) = log(FirebaseAnalytics.Event.SCREEN_VIEW, FirebaseAnalytics.Param.SCREEN_NAME to name, FirebaseAnalytics.Param.SCREEN_CLASS to "MainActivity")
}
