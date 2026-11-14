package ir.pptsaz.app

import android.app.Activity
import android.content.Context
import android.view.ViewGroup
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import ir.tapsell.mediation.Tapsell
import ir.tapsell.mediation.ad.AdStateListener
import ir.tapsell.mediation.ad.request.BannerSize
import ir.tapsell.mediation.ad.request.RequestResultListener
import ir.tapsell.mediation.ad.show.AdShowCompletionState
import ir.tapsell.mediation.ad.views.banner.BannerContainer
import kotlinx.coroutines.launch
import java.lang.ref.WeakReference

/**
 * تبلیغات تپسل (Tapsell Mediation): بنر استاندارد، آنی (ویدئو و بنر آنی) و ویدئو جایزه‌ای.
 * - هر نوع فقط وقتی فعال است که شناسه‌ی جایگاهش (BuildConfig.TAPSELL_*_ZONE) خالی نباشد.
 * - کاربر پولی تبلیغ بنری/آنی/همسان نمی‌بیند؛ ویدئو جایزه‌ای برای همه اختیاری است و هر ۵ ویدئو = ۱ اعتبار (سرور: /api/ad-reward).
 * - هر خطای SDK بی‌صدا نادیده گرفته می‌شود تا اپ کرش نکند.
 */
object Ads {

    private var act: WeakReference<Activity>? = null
    private val interstitial = HashMap<String, String?>() // zone → adId آماده
    private val loading = HashSet<String>()
    private var rewardedId: String? = null
    private var rewardedLoading = false


    private fun p(ctx: Context) = ctx.getSharedPreferences("ads", Context.MODE_PRIVATE)
    private val interstitialZones get() = listOf(BuildConfig.TAPSELL_INTERSTITIAL_ZONE, BuildConfig.TAPSELL_INTERSTITIAL_BANNER_ZONE).filter { it.isNotEmpty() }
    val bannerOn get() = BuildConfig.ADS_ENABLED && BuildConfig.TAPSELL_BANNER_ZONE.isNotEmpty()
    val rewardedOn get() = BuildConfig.ADS_ENABLED && BuildConfig.TAPSELL_REWARDED_ZONE.isNotEmpty()

    fun adFree(): Boolean = false

    /** در onCreate اکتیویتی صدا زده شود. فعال‌سازی SDK خودکار است؛ اینجا فقط رضایت و پیش‌بارگذاری انجام می‌شود. */
    fun start(activity: Activity) {
        if (!BuildConfig.ADS_ENABLED) return
        act = WeakReference(activity)
        try {
            Tapsell.setInitializationListener {
                try {
                    // مارکت‌های ایرانی (بازار/مایکت) دیالوگ GDPR لازم ندارند؛ رضایت پیش‌فرض ارسال می‌شود.
                    act?.get()?.let { Tapsell.setUserConsent(it, true) }
                } catch (_: Throwable) {}
                loadInterstitials()
                loadRewarded()
            }
        } catch (_: Throwable) {}
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
                override fun onFailure(message: String) { loading -= zone }
            })
        } catch (_: Throwable) { loading -= zone }
    }

    /** بعد از پایان موفق ساخت هر ارائه (از همان ارائه‌ی اول). [paid] = کاربر پلن پولی دارد ⇒ تبلیغ ندارد. اگر تبلیغ هنوز آماده نباشد، همان بار نمایش داده نمی‌شود. */
    fun onDeckDone(activity: Activity, paid: Boolean) {
        if (!BuildConfig.ADS_ENABLED || paid || interstitialZones.isEmpty()) return
        try {
            val zone = interstitialZones.firstOrNull { interstitial[it] != null }
            if (zone == null) { loadInterstitials(); return }
            val id = interstitial[zone]!!
            interstitial[zone] = null
            Tapsell.showInterstitialAd(id, activity, object : AdStateListener.Interstitial {
                override fun onAdImpression() {}
                override fun onAdClicked() {}
                override fun onAdClosed(completionState: AdShowCompletionState) { loadInterstitials() }
                override fun onAdFailed(message: String) { loadInterstitials() }
            })
        } catch (_: Throwable) {}
    }

    // ---------------------------------------------------------------- ویدئو جایزه‌ای
    private fun loadRewarded() {
        if (!rewardedOn || rewardedLoading || rewardedId != null) return
        val a = act?.get() ?: return
        rewardedLoading = true
        try {
            Tapsell.requestRewardedAd(BuildConfig.TAPSELL_REWARDED_ZONE, a, object : RequestResultListener {
                override fun onSuccess(adId: String) { rewardedId = adId; rewardedLoading = false }
                override fun onFailure(message: String) { rewardedLoading = false }
            })
        } catch (_: Throwable) { rewardedLoading = false }
    }

    fun rewardedReady(): Boolean = rewardedOn && rewardedId != null

    /** نمایش ویدئو جایزه‌ای؛ onReward وقتی کاربر ویدئو را کامل دیده؛ onFail اگر تبلیغی آماده/نمایش‌پذیر نبود. */
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
                override fun onAdFailed(message: String) { loadRewarded(); onFail() }
            })
        } catch (_: Throwable) { loadRewarded(); onFail() }
    }

    // ---------------------------------------------------------------- بنر استاندارد
    /** بنر ۳۲۰×۵۰ بالای نوار پایین؛ برای کاربر پولی یا «بدون تبلیغ» چیزی ترسیم نمی‌شود. */
    @Composable
    fun Banner(paid: Boolean, modifier: Modifier = Modifier) {
        if (!bannerOn || paid) return
        val ctx = LocalContext.current
        val activity = ctx as? Activity ?: return
        var adId by remember { mutableStateOf<String?>(null) }
        DisposableEffect(Unit) { onDispose { try { adId?.let { Tapsell.destroyBannerAd(it) } } catch (_: Throwable) {} } }
        AndroidView(
            modifier = modifier.fillMaxWidth(),
            factory = { c ->
                BannerContainer(c).also { container ->
                    container.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    try {
                        Tapsell.requestBannerAd(BuildConfig.TAPSELL_BANNER_ZONE, BannerSize.BANNER_320_50, activity, object : RequestResultListener {
                            override fun onSuccess(id: String) {
                                adId = id
                                try {
                                    Tapsell.showBannerAd(id, container, activity, object : AdStateListener.Banner {
                                        override fun onAdImpression() {}
                                        override fun onAdClicked() {}
                                        override fun onAdFailed(message: String) {}
                                    })
                                } catch (_: Throwable) {}
                            }
                            override fun onFailure(message: String) {}
                        })
                    } catch (_: Throwable) {}
                }
            },
        )
    }

    // ---------------------------------------------------------------- کارت «ویدئو ببین، اعتبار بگیر»
    /** در تب حساب: هر [every] ویدئوی کامل = [credits] اعتبار رایگان. شمارش و اعطای اعتبار سمت سرور است. */
    @Composable
    fun RewardCard(every: Int, progress: Int, credits: Int, onClaimed: (granted: Int) -> Unit, say: (String) -> Unit) {
        if (!rewardedOn) return
        val activity = LocalContext.current as? Activity ?: return
        val scope = androidx.compose.runtime.rememberCoroutineScope()
        var shown by remember(progress) { mutableStateOf(progress) }
        var busy by remember { mutableStateOf(false) }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                Text("اعتبار رایگان با دیدن ویدئو", style = MaterialTheme.typography.titleMedium)
                Text("هر ${every.toString().faDigits()} ویدئوی کوتاه = ${credits.toString().faDigits()} اعتبار رایگان. تا اینجا ${shown.toString().faDigits()} از ${every.toString().faDigits()} را دیده‌اید.", style = MaterialTheme.typography.bodyMedium)
                Button(enabled = !busy, onClick = {
                    busy = true
                    showRewarded(activity, onReward = {
                        scope.launch {
                            try {
                                val (prog, granted) = Api.adReward()
                                shown = prog
                                if (granted > 0) say("${granted.toString().faDigits()} اعتبار رایگان گرفتید 🎉")
                                onClaimed(granted)
                            } catch (e: ApiException) { say(e.message ?: "ثبت ویدئو انجام نشد") }
                            catch (_: Exception) { say("ثبت ویدئو انجام نشد؛ اینترنت را بررسی کنید") }
                            busy = false
                        }
                    }, onFail = { busy = false; say("فعلاً ویدئویی آماده نیست؛ کمی بعد دوباره امتحان کنید") })
                }) { Text("دیدن ویدئو") }
            }
        }
    }

    private fun String.faDigits(): String = map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")
}
