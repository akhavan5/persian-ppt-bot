package ir.pptsaz.app

import android.app.Activity
import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import com.adivery.sdk.Adivery
import com.adivery.sdk.AdiveryAdListener
import com.adivery.sdk.AdiveryBannerAdView
import com.adivery.sdk.AdiveryListener
import com.adivery.sdk.AdiveryNativeAdView
import com.adivery.sdk.BannerSize

/**
 * تبلیغات ادیوری (Adivery): بنر، آنی (میان‌صفحه‌ای)، ویدئو جایزه‌ای و همسان.
 * - هر نوع فقط وقتی فعال است که شناسه‌ی جایگاهش (BuildConfig.ADIVERY_*_PLACEMENT) خالی نباشد.
 * - ادیوری بعد از اولین prepare خودش تبلیغ بعدی را بارگذاری می‌کند؛ فقط برای آنی/جایزه‌ای یک‌بار prepare می‌زنیم.
 * - از onError/log فقط برای لاگ استفاده می‌شود و منطق برنامه به آن وابسته نیست (توصیه‌ی مستندات ادیوری).
 * - هر خطای SDK بی‌صدا نادیده گرفته می‌شود تا اپ کرش نکند. منطق مشترک (کاربر پولی، انتخاب شبکه) در Ads.kt است.
 */
object AdiveryAds {

    private val main = Handler(Looper.getMainLooper())
    private var configured = false
    private var appCtx: Context? = null
    private var lastPrepareAt = 0L

    private class Pending(val onReward: () -> Unit, val onNoReward: () -> Unit)
    private var pending: Pending? = null

    val on get() = BuildConfig.ADIVERY_ENABLED && BuildConfig.ADIVERY_APP_ID.isNotEmpty()
    val bannerOn get() = on && BuildConfig.ADIVERY_BANNER_PLACEMENT.isNotEmpty()
    val interstitialOn get() = on && BuildConfig.ADIVERY_INTERSTITIAL_PLACEMENT.isNotEmpty()
    val rewardedOn get() = on && BuildConfig.ADIVERY_REWARDED_PLACEMENT.isNotEmpty()
    val nativeOn get() = on && BuildConfig.ADIVERY_NATIVE_PLACEMENT.isNotEmpty()

    private val listener = object : AdiveryListener() {
        override fun onRewardedAdClosed(placementId: String, isRewarded: Boolean) {
            if (placementId != BuildConfig.ADIVERY_REWARDED_PLACEMENT) return
            val p = pending; pending = null
            if (p != null) main.post { if (isRewarded) p.onReward() else p.onNoReward() }
        }
    }

    /** در onCreate اکتیویتی صدا زده شود (چندبار صدا زدن بی‌اثر است). */
    fun start(activity: Activity) {
        if (!on || configured) return
        try {
            val app = activity.application
            appCtx = app.applicationContext
            Adivery.configure(app, BuildConfig.ADIVERY_APP_ID)
            Adivery.addGlobalListener(listener)
            configured = true
            prepare()
        } catch (_: Throwable) {}
    }

    /** آنی و جایزه‌ای را prepare می‌کند. SDK بعد از هر نمایش خودش دوباره بارگذاری می‌کند. */
    private fun prepare() {
        val ctx = appCtx ?: return
        lastPrepareAt = System.currentTimeMillis()
        try { if (interstitialOn) Adivery.prepareInterstitialAd(ctx, BuildConfig.ADIVERY_INTERSTITIAL_PLACEMENT) } catch (_: Throwable) {}
        try { if (rewardedOn) Adivery.prepareRewardedAd(ctx, BuildConfig.ADIVERY_REWARDED_PLACEMENT) } catch (_: Throwable) {}
    }

    /** اگر بارگذاری اولیه (مثلاً بدون اینترنت) شکست خورده باشد، حداکثر هر ۶۰ ثانیه یک‌بار دوباره تلاش می‌کند. */
    private fun reprepareIfStale() {
        if (configured && System.currentTimeMillis() - lastPrepareAt > 60_000) prepare()
    }

    // ---------------------------------------------------------------- آنی
    /** اگر تبلیغ آنی آماده بود نمایش می‌دهد و true برمی‌گرداند. */
    fun showInterstitialIfReady(): Boolean {
        if (!interstitialOn || !configured) return false
        return try {
            if (Adivery.isLoaded(BuildConfig.ADIVERY_INTERSTITIAL_PLACEMENT)) {
                Adivery.showAd(BuildConfig.ADIVERY_INTERSTITIAL_PLACEMENT); true
            } else { reprepareIfStale(); false }
        } catch (_: Throwable) { false }
    }

    // ---------------------------------------------------------------- ویدئو جایزه‌ای
    fun rewardedReady(): Boolean = try {
        rewardedOn && configured && Adivery.isLoaded(BuildConfig.ADIVERY_REWARDED_PLACEMENT)
    } catch (_: Throwable) { false }

    /** onReward وقتی کاربر ویدئو را کامل دیده؛ onNoReward اگر بدون دریافت جایزه بسته شد یا نمایش شکست خورد. */
    fun showRewarded(onReward: () -> Unit, onNoReward: () -> Unit) {
        if (!rewardedReady()) { reprepareIfStale(); onNoReward(); return }
        pending = Pending(onReward, onNoReward)
        try { Adivery.showAd(BuildConfig.ADIVERY_REWARDED_PLACEMENT) }
        catch (_: Throwable) { pending = null; onNoReward() }
    }

    // ---------------------------------------------------------------- بنر استاندارد
    @Composable
    fun Banner(modifier: Modifier = Modifier) {
        if (!bannerOn) return
        AndroidView(
            modifier = modifier.fillMaxWidth(),
            factory = { c ->
                AdiveryBannerAdView(c).also { banner ->
                    banner.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    try {
                        banner.setBannerAdListener(object : AdiveryAdListener() {})
                        banner.setPlacementId(BuildConfig.ADIVERY_BANNER_PLACEMENT)
                        banner.setBannerSize(BannerSize.BANNER)
                        banner.loadAd()
                    } catch (_: Throwable) {}
                }
            },
        )
    }

    // ---------------------------------------------------------------- تبلیغ همسان
    /** ویوی همسان بارگذاری‌شده؛ LazyColumn با اسکرول ردیف را می‌سازد و حذف می‌کند و بدون کش هر بار تبلیغ تازه می‌آمد. با عوض‌شدن اکتیویتی دوباره ساخته می‌شود. */
    private var nativeView: AdiveryNativeAdView? = null

    /** کارت همسان لابه‌لای فهرست (AdiveryNativeAdView + res/layout/adivery_native_card.xml)؛ رنگ‌ها از تم اپ و تا آمدن تبلیغ جایی اشغال نمی‌کند. */
    @Composable
    fun NativeCard(modifier: Modifier = Modifier) {
        if (!nativeOn) return
        val cs = MaterialTheme.colorScheme
        val surface = cs.surfaceVariant.toArgb()
        val onSurface = cs.onSurface.toArgb()
        val onVariant = cs.onSurfaceVariant.toArgb()
        val primary = cs.primary.toArgb()
        val onPrimary = cs.onPrimary.toArgb()
        AndroidView(
            modifier = modifier.fillMaxWidth(),
            factory = { c ->
                val cached = nativeView?.takeIf { it.context === c }
                if (cached != null) {
                    // قبلاً بارگذاری شده: فقط از والد قبلی جدا و دوباره وصل می‌شود (درخواست جدید نمی‌رود)
                    (cached.parent as? ViewGroup)?.removeView(cached)
                    return@AndroidView cached
                }
                val d = c.resources.displayMetrics.density
                AdiveryNativeAdView(c).also { v ->
                    nativeView = v
                    v.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    v.visibility = View.GONE
                    v.background = GradientDrawable().apply { setColor(surface); cornerRadius = 16 * d }
                    try {
                        v.setPlacementId(BuildConfig.ADIVERY_NATIVE_PLACEMENT)
                        v.setNativeAdLayout(R.layout.adivery_native_card)
                        v.setListener(object : AdiveryAdListener() {
                            override fun onAdLoaded() {
                                try {
                                    v.findViewById<TextView>(R.id.adivery_headline)?.setTextColor(onSurface)
                                    v.findViewById<TextView>(R.id.adivery_description)?.setTextColor(onVariant)
                                    v.findViewById<TextView>(R.id.adivery_advertiser)?.setTextColor(onVariant)
                                    v.findViewById<Button>(R.id.adivery_call_to_action)?.apply {
                                        setTextColor(onPrimary)
                                        background = GradientDrawable().apply { setColor(primary); cornerRadius = 12 * d }
                                    }
                                    v.visibility = View.VISIBLE
                                } catch (_: Throwable) {}
                            }
                            // شکست: از کش برداشته می‌شود تا دفعه‌ی بعد که ردیف دیده شد دوباره تلاش شود
                            override fun onError(reason: String) { v.visibility = View.GONE; if (nativeView === v) nativeView = null }
                        })
                        v.loadAd()
                    } catch (_: Throwable) {}
                }
            },
        )
    }
}
