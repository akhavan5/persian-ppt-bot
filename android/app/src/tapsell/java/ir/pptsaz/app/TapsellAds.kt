package ir.pptsaz.app

import android.app.Activity
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import ir.tapsell.mediation.Tapsell
import ir.tapsell.mediation.ad.AdStateListener
import ir.tapsell.mediation.ad.request.BannerSize
import ir.tapsell.mediation.ad.request.RequestResultListener
import ir.tapsell.mediation.ad.show.AdShowCompletionState
import ir.tapsell.mediation.ad.views.banner.BannerContainer
import ir.tapsell.mediation.ad.views.ntv.NativeAdView
import ir.tapsell.mediation.ad.views.ntv.NativeAdViewContainer
import java.lang.ref.WeakReference

/**
 * پیاده‌سازی تپسل (Tapsell Mediation). این فایل فقط برای فروشگاهی کامپایل می‌شود که شبکه‌ی تبلیغاتش tapsell است
 * (BAZAAR_ADS / MYKET_ADS؛ مسیر src/tapsell)؛ برای بقیه src/tapsellOff (نسخه‌ی خالی همین API) کامپایل می‌شود و خود SDK هم وارد اپ نمی‌شود.
 * منطق مشترک (کاربر پولی، انتخاب شبکه) در Ads.kt است.
 */
object TapsellAds {

    private var act: WeakReference<Activity>? = null
    private val interstitial = HashMap<String, String?>() // zone → adId آماده
    private val loading = HashSet<String>()
    private var rewardedId: String? = null
    private var rewardedLoading = false
    private var rewardedTries = 0
    private var rewardedReq = 0
    @Volatile private var initDone = false
    private val main = Handler(Looper.getMainLooper())

    /** آخرین خطای SDK تپسل (برای عیب‌یابی)؛ فقط در حافظه نگه داشته می‌شود (به کاربر نشان داده نمی‌شود). */
    @Volatile var lastError: String = ""
        private set
    private fun note(kind: String, message: String) { lastError = "$kind: $message" }

    /** وضعیت لحظه‌ای برای عیب‌یابی (در پیام «ویدئو آماده نیست» نشان داده می‌شود). */
    fun diag(): String =
        "sdk=${BuildConfig.TAPSELL_SDK} key=${BuildConfig.TAPSELL_KEY_INFO} init=$initDone loading=$rewardedLoading tries=$rewardedTries zone=${BuildConfig.TAPSELL_REWARDED_ZONE.take(6)} err=${lastError.ifEmpty { "-" }}"

    // ترتیب = اولویت نمایش: اگر هر دو آماده باشند، بنر آنی قبل از ویدئو آنی نشان داده می‌شود
    private val interstitialZones get() = listOf(BuildConfig.TAPSELL_INTERSTITIAL_BANNER_ZONE, BuildConfig.TAPSELL_INTERSTITIAL_ZONE).filter { it.isNotEmpty() }
    val bannerOn get() = BuildConfig.TAPSELL_ENABLED && BuildConfig.TAPSELL_BANNER_ZONE.isNotEmpty()
    val rewardedOn get() = BuildConfig.TAPSELL_ENABLED && BuildConfig.TAPSELL_REWARDED_ZONE.isNotEmpty()
    val nativeBannerZone get() = BuildConfig.TAPSELL_NATIVE_BANNER_ZONE
    val nativeVideoZone get() = BuildConfig.TAPSELL_NATIVE_VIDEO_ZONE
    fun nativeOn(zone: String) = BuildConfig.TAPSELL_ENABLED && zone.isNotEmpty()

    fun start(activity: Activity) {
        if (!BuildConfig.TAPSELL_ENABLED) return
        if (act?.get() !== activity) clearNative()
        act = WeakReference(activity)
        try {
            Tapsell.setInitializationListener {
                initDone = true
                try {
                    // مارکت‌های ایرانی (بازار/مایکت) دیالوگ GDPR لازم ندارند؛ رضایت پیش‌فرض ارسال می‌شود.
                    act?.get()?.let { Tapsell.setUserConsent(it, true) }
                } catch (_: Throwable) {}
                loadInterstitials()
                loadRewarded()
            }
        } catch (e: Throwable) { note("init", e.toString()) }
        // SDK تپسل خودش هنگام شروع برنامه (ContentProvider) فعال می‌شود، یعنی معمولاً قبل از ثبت listener بالا؛
        // پس به callback اتکا نمی‌کنیم و همین‌جا هم درخواست می‌دهیم (اگر زود بود، خطا لاگ می‌شود و دوباره تلاش می‌کنیم).
        loadInterstitials()
        loadRewarded()
    }

    // ---------------------------------------------------------------- آنی
    private fun loadInterstitials() = interstitialZones.forEach { loadInterstitial(it) }

    private fun loadInterstitial(zone: String) {
        if (zone in loading || interstitial[zone] != null) return
        val a = act?.get() ?: return
        loading += zone
        try {
            Tapsell.requestInterstitialAd(zone, a, object : RequestResultListener {
                override fun onSuccess(adId: String) { interstitial[zone] = adId; loading -= zone }
                override fun onFailure(message: String) { loading -= zone; note("interstitial", message) }
            })
        } catch (e: Throwable) { loading -= zone; note("interstitial", e.toString()) }
    }

    /** اگر تبلیغ آنی آماده بود نمایش می‌دهد و true برمی‌گرداند؛ وگرنه بارگذاری را شروع می‌کند و false. */
    fun showInterstitialIfReady(activity: Activity): Boolean {
        if (!BuildConfig.TAPSELL_ENABLED || interstitialZones.isEmpty()) return false
        return try {
            val zone = interstitialZones.firstOrNull { interstitial[it] != null }
            if (zone == null) { loadInterstitials(); return false }
            val id = interstitial[zone]!!
            interstitial[zone] = null
            Tapsell.showInterstitialAd(id, activity, object : AdStateListener.Interstitial {
                override fun onAdImpression() {}
                override fun onAdClicked() {}
                override fun onAdClosed(completionState: AdShowCompletionState) { loadInterstitials() }
                override fun onAdFailed(message: String) { loadInterstitials() }
            })
            true
        } catch (_: Throwable) { false }
    }

    // ---------------------------------------------------------------- ویدئو جایزه‌ای
    private fun loadRewarded() {
        if (!rewardedOn || rewardedLoading || rewardedId != null) return
        val a = act?.get() ?: return
        rewardedLoading = true
        val req = ++rewardedReq
        // اگر SDK هیچ‌کدام از onSuccess/onFailure را صدا نزند (مثلاً فعال‌نشدن SDK یا قطع ارتباط)، پرچم برای همیشه «در حال بارگذاری» می‌ماند؛ پس بعد از ۲۰ ثانیه ولش می‌کنیم
        main.postDelayed({
            if (rewardedLoading && req == rewardedReq) {
                rewardedLoading = false
                note("rewarded", "پاسخی از SDK نیامد (۲۰ ثانیه)")
                retryRewarded()
            }
        }, 20_000L)
        try {
            Tapsell.requestRewardedAd(BuildConfig.TAPSELL_REWARDED_ZONE, a, object : RequestResultListener {
                override fun onSuccess(adId: String) { rewardedId = adId; rewardedLoading = false; rewardedTries = 0; lastError = "" }
                override fun onFailure(message: String) { rewardedLoading = false; note("rewarded", message); retryRewarded() }
            })
        } catch (e: Throwable) { rewardedLoading = false; note("rewarded", e.toString()) }
    }

    /** بارگذاری ناموفق ویدئو جایزه‌ای را هر ۳۰ ثانیه (حداکثر ۵ بار) دوباره امتحان می‌کند. */
    private fun retryRewarded() {
        if (rewardedTries++ >= 5) return
        main.postDelayed({ loadRewarded() }, 30_000L)
    }

    fun rewardedReady(): Boolean = rewardedOn && rewardedId != null

    fun showRewarded(activity: Activity, onReward: () -> Unit, onFail: () -> Unit) {
        val id = rewardedId
        if (!rewardedOn || id == null) { loadRewarded(); onFail(); return }
        rewardedId = null
        try {
            Tapsell.showRewardedAd(id, activity, object : AdStateListener.Rewarded {
                override fun onAdImpression() {}
                override fun onAdClicked() {}
                override fun onRewarded() { onReward() }
                override fun onAdClosed(completionState: AdShowCompletionState) { loadRewarded() }
                override fun onAdFailed(message: String) { note("rewarded-show", message); loadRewarded(); onFail() }
            })
        } catch (_: Throwable) { loadRewarded(); onFail() }
    }

    // ---------------------------------------------------------------- بنر استاندارد
    private class BannerState {
        @Volatile var alive = true
        var tries = 0
        var adId: String? = null
    }

    private fun loadBanner(st: BannerState, container: BannerContainer, activity: Activity) {
        if (!st.alive) return
        try {
            Tapsell.requestBannerAd(BuildConfig.TAPSELL_BANNER_ZONE, BannerSize.BANNER_320_50, activity, object : RequestResultListener {
                override fun onSuccess(id: String) {
                    if (!st.alive) { try { Tapsell.destroyBannerAd(id) } catch (_: Throwable) {}; return }
                    st.adId = id
                    st.tries = 0
                    try {
                        Tapsell.showBannerAd(id, container, activity, object : AdStateListener.Banner {
                            override fun onAdImpression() {}
                            override fun onAdClicked() {}
                            override fun onAdFailed(message: String) { note("banner-show", message) }
                        })
                    } catch (e: Throwable) { note("banner-show", e.toString()) }
                }
                override fun onFailure(message: String) { note("banner", message); retryBanner(st, container, activity) }
            })
        } catch (e: Throwable) { note("banner", e.toString()); retryBanner(st, container, activity) }
    }

    /** اگر SDK هنوز فعال نشده یا تبلیغی نبود، بنر هر ۱۵ ثانیه (حداکثر ۶ بار) دوباره درخواست می‌شود. */
    private fun retryBanner(st: BannerState, container: BannerContainer, activity: Activity) {
        if (!st.alive || st.tries++ >= 6) return
        main.postDelayed({ loadBanner(st, container, activity) }, 15_000L)
    }

    @Composable
    fun Banner(modifier: Modifier = Modifier) {
        if (!bannerOn) return
        val ctx = LocalContext.current
        val activity = ctx as? Activity ?: return
        val st = remember { BannerState() }
        DisposableEffect(Unit) {
            onDispose {
                st.alive = false
                try { st.adId?.let { Tapsell.destroyBannerAd(it) } } catch (_: Throwable) {}
            }
        }
        AndroidView(
            modifier = modifier.fillMaxWidth(),
            factory = { c ->
                BannerContainer(c).also { container ->
                    container.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    loadBanner(st, container, activity)
                }
            },
        )
    }

    // ---------------------------------------------------------------- تبلیغ همسان
    /**
     * LazyColumn ردیف را با اسکرول از کامپوزیشن بیرون می‌برد و با برگشتن دوباره می‌سازد؛ بدون کش، هر بار یک درخواست و تبلیغ تازه می‌رفت.
     * پس ویوی بارگذاری‌شده‌ی هر جایگاه یک‌بار ساخته و نگه داشته می‌شود و فقط دوباره به ردیف وصل می‌شود.
     */
    private class NativeSlot(val activity: Activity, val container: NativeAdViewContainer) { var adId: String? = null }
    private val nativeSlots = HashMap<String, NativeSlot>()

    /** تبلیغ‌های همسان نگه‌داشته‌شده را آزاد می‌کند (با عوض‌شدن اکتیویتی صدا زده می‌شود تا ویوها اکتیویتی قبلی را نگه نداشته باشند). */
    private fun clearNative() {
        nativeSlots.values.forEach { slot -> try { slot.adId?.let { Tapsell.destroyNativeAd(it) } } catch (_: Throwable) {} }
        nativeSlots.clear()
    }

    /** [zone] = جایگاه همسان؛ بنر همسان و ویدئو همسان در داشبورد تپسل دو جایگاه جدا هستند. */
    @Composable
    fun NativeCard(zone: String, modifier: Modifier = Modifier) {
        if (!nativeOn(zone)) return
        val activity = LocalContext.current as? Activity ?: return
        val cs = MaterialTheme.colorScheme
        val surface = cs.surfaceVariant.toArgb()
        val onSurface = cs.onSurface.toArgb()
        val onVariant = cs.onSurfaceVariant.toArgb()
        val primary = cs.primary.toArgb()
        val onPrimary = cs.onPrimary.toArgb()
        AndroidView(
            modifier = modifier.fillMaxWidth(),
            factory = { c ->
                val cached = nativeSlots[zone]?.takeIf { it.activity === activity }
                if (cached != null) {
                    // قبلاً بارگذاری شده: فقط از والد قبلی جدا و دوباره وصل می‌شود (درخواست جدید نمی‌رود)
                    (cached.container.parent as? ViewGroup)?.removeView(cached.container)
                    return@AndroidView cached.container
                }
                val d = c.resources.displayMetrics.density
                fun dp(v: Int) = (v * d).toInt()
                val container = NativeAdViewContainer(c)
                container.visibility = View.GONE // تا تبلیغ نیامده جایی اشغال نمی‌کند
                container.background = GradientDrawable().apply { setColor(surface); cornerRadius = 16 * d }
                val col = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(12), dp(14), dp(12)) }
                val head = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                val logo = ImageView(c).apply { layoutParams = LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(10) } }
                val titles = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
                val title = TextView(c).apply { setTextColor(onSurface); textSize = 15f; maxLines = 1 }
                val sponsored = TextView(c).apply { setTextColor(onVariant); textSize = 11f; maxLines = 1 }
                titles.addView(title); titles.addView(sponsored)
                head.addView(logo); head.addView(titles)
                val desc = TextView(c).apply { setTextColor(onVariant); textSize = 13f; maxLines = 3; setPadding(0, dp(8), 0, dp(8)) }
                val media = FrameLayout(c).apply { layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT) }
                val cta = Button(c).apply {
                    setTextColor(onPrimary)
                    background = GradientDrawable().apply { setColor(primary); cornerRadius = 12 * d }
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply { topMargin = dp(8) }
                }
                col.addView(head); col.addView(desc); col.addView(media); col.addView(cta)
                container.addView(col)
                val view = NativeAdView.Builder(container)
                    .withLogo(logo).withTitle(title).withSponsored(sponsored)
                    .withDescription(desc).withCtaButton(cta).withMedia(media).build()
                val slot = NativeSlot(activity, container)
                nativeSlots[zone] = slot
                try {
                    Tapsell.requestNativeAd(zone, activity, object : RequestResultListener {
                        override fun onSuccess(id: String) {
                            slot.adId = id
                            try {
                                Tapsell.showNativeAd(id, view, activity, object : AdStateListener.Native {
                                    override fun onAdImpression() { container.visibility = View.VISIBLE }
                                    override fun onAdClicked() {}
                                    override fun onAdClosed(completionState: AdShowCompletionState) {}
                                    override fun onAdFailed(message: String) { container.visibility = View.GONE; note("native-show", message) }
                                })
                                container.visibility = View.VISIBLE
                            } catch (_: Throwable) {}
                        }
                        // شکست: از کش برداشته می‌شود تا دفعه‌ی بعد که ردیف دیده شد دوباره تلاش شود
                        override fun onFailure(message: String) { note("native", message); if (nativeSlots[zone] === slot) nativeSlots.remove(zone) }
                    })
                } catch (e: Throwable) { note("native", e.toString()); if (nativeSlots[zone] === slot) nativeSlots.remove(zone) }
                container
            },
        )
    }
}
