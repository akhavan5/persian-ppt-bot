package ir.pptsaz.app

import android.app.Activity
import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
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
import com.adivery.sdk.AdiveryNativeCallback
import com.adivery.sdk.BannerSize
import com.adivery.sdk.NativeAd
import com.adivery.sdk.networks.adivery.AdiveryNativeAd

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
    /** کارت همسان لابه‌لای فهرست؛ ظاهر از رنگ‌های تم اپ ساخته می‌شود و تا آمدن تبلیغ جایی اشغال نمی‌کند. */
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
                val d = c.resources.displayMetrics.density
                fun dp(v: Int) = (v * d).toInt()
                val root = LinearLayout(c).apply {
                    orientation = LinearLayout.VERTICAL
                    visibility = View.GONE
                    background = GradientDrawable().apply { setColor(surface); cornerRadius = 16 * d }
                    setPadding(dp(14), dp(12), dp(14), dp(12))
                }
                val head = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                val icon = ImageView(c).apply { layoutParams = LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(10) }; visibility = View.GONE }
                val titles = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
                val title = TextView(c).apply { setTextColor(onSurface); textSize = 15f; maxLines = 1 }
                val sponsored = TextView(c).apply { setTextColor(onVariant); textSize = 11f; maxLines = 1; text = "تبلیغ" }
                titles.addView(title); titles.addView(sponsored)
                head.addView(icon); head.addView(titles)
                val desc = TextView(c).apply { setTextColor(onVariant); textSize = 13f; maxLines = 3; setPadding(0, dp(8), 0, dp(8)) }
                val image = ImageView(c).apply {
                    adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER; visibility = View.GONE
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                }
                val cta = Button(c).apply {
                    setTextColor(onPrimary)
                    background = GradientDrawable().apply { setColor(primary); cornerRadius = 12 * d }
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply { topMargin = dp(8) }
                }
                root.addView(head); root.addView(desc); root.addView(image); root.addView(cta)
                try {
                    Adivery.requestNativeAd(c, BuildConfig.ADIVERY_NATIVE_PLACEMENT, object : AdiveryNativeCallback() {
                        override fun onAdLoaded(ad: NativeAd) {
                            // فقط تبلیغ بومی خود ادیوری رندر می‌شود؛ بقیه‌ی شبکه‌ها کارت را مخفی نگه می‌دارند
                            if (ad !is AdiveryNativeAd) return
                            root.post {
                                try {
                                    val h = ad.headline
                                    if (h.isNullOrBlank()) return@post
                                    title.text = h
                                    desc.text = ad.description.orEmpty()
                                    desc.visibility = if (ad.description.isNullOrBlank()) View.GONE else View.VISIBLE
                                    ad.advertiser?.takeIf { it.isNotBlank() }?.let { sponsored.text = it }
                                    cta.text = ad.callToAction?.takeIf { it.isNotBlank() } ?: "بیشتر بدانید"
                                    ad.icon?.let { icon.setImageDrawable(it); icon.visibility = View.VISIBLE }
                                    ad.image?.let { image.setImageDrawable(it); image.visibility = View.VISIBLE }
                                    val click = View.OnClickListener { try { ad.recordClick() } catch (_: Throwable) {} }
                                    root.setOnClickListener(click); cta.setOnClickListener(click)
                                    root.visibility = View.VISIBLE
                                    ad.recordImpression()
                                } catch (_: Throwable) { root.visibility = View.GONE }
                            }
                        }
                        override fun onAdLoadFailed(reason: String) {}
                        override fun onAdShowFailed(reason: String) { root.post { root.visibility = View.GONE } }
                    })
                } catch (_: Throwable) {}
                root
            },
        )
    }
}
