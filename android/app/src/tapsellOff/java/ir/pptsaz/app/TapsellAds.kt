package ir.pptsaz.app

import android.app.Activity
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * نسخه‌ی خاموش تپسل: همان API بدون هیچ وابستگی به SDK تپسل. برای فروشگاهی کامپایل می‌شود که شبکه‌ی تبلیغاتش tapsell نیست.
 * برای روشن‌کردن تپسل در یک فروشگاه: متغیر گیت‌هاب BAZAAR_ADS یا MYKET_ADS را روی tapsell بگذارید (جزئیات در android/README.md).
 */
object TapsellAds {
    val lastError get() = ""
    fun diag() = "tapsell off"
    val bannerOn get() = false
    val rewardedOn get() = false
    val nativeBannerZone get() = ""
    val nativeVideoZone get() = ""
    fun nativeOn(zone: String) = false
    fun start(activity: Activity) {}
    fun showInterstitialIfReady(activity: Activity) = false
    fun rewardedReady() = false
    fun showRewarded(activity: Activity, onReward: () -> Unit, onFail: () -> Unit) { onFail() }
    @Composable fun Banner(modifier: Modifier = Modifier) {}
    @Composable fun NativeCard(zone: String, modifier: Modifier = Modifier) {}
}
