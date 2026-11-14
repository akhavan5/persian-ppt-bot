package ir.pptsaz.app

import android.app.Activity
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * نسخه‌ی خاموش تپسل (TAPSELL_ENABLED=false): همان API بدون هیچ وابستگی به SDK تپسل.
 * برای روشن‌کردن دوباره: متغیر محیطی TAPSELL_ENABLED=true (جزئیات در android/README.md).
 */
object TapsellAds {
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
