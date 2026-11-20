package ir.pptsaz.app

import android.app.Activity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch

/**
 * نقطه‌ی ورود تبلیغات اپ؛ بقیه‌ی کد فقط با این شیء (و AdsNative) کار دارد.
 * شبکه‌ی تبلیغاتی هر فروشگاه در زمان بیلد با متغیرهای گیت‌هاب BAZAAR_ADS / MYKET_ADS تعیین می‌شود (BuildConfig.ADS_NETWORK):
 * tapsell (TapsellAds) یا adivery (AdiveryAds).
 * معمولاً فقط یکی روشن است؛ اگر هر دو روشن باشند، ابتدا تپسل و در صورت آماده‌نبودنش ادیوری استفاده می‌شود.
 * - کاربر پولی تبلیغ بنری/آنی/همسان نمی‌بیند؛ ویدئو جایزه‌ای برای همه اختیاری است و هر ۵ ویدئو = ۱ اعتبار (سرور: /api/ad-reward).
 * - هر خطای SDK بی‌صدا نادیده گرفته می‌شود تا اپ کرش نکند.
 */
object Ads {

    val bannerOn get() = TapsellAds.bannerOn || AdiveryAds.bannerOn
    val rewardedOn get() = TapsellAds.rewardedOn || AdiveryAds.rewardedOn

    fun adFree(): Boolean = false

    /** وضعیت تبلیغات برای عیب‌یابی (فقط در پیام خطای ویدئو جایزه‌ای). */
    fun diag(): String = "net=${BuildConfig.ADS_NETWORK} v=${BuildConfig.VERSION_NAME} tapsellRewarded=${TapsellAds.rewardedOn} adiveryRewarded=${AdiveryAds.rewardedOn} ${TapsellAds.diag()}"

    /** در onCreate اکتیویتی صدا زده شود. */
    fun start(activity: Activity) {
        if (!BuildConfig.ADS_ENABLED) return
        TapsellAds.start(activity)
        AdiveryAds.start(activity)
    }

    /** بعد از پایان موفق ساخت هر ارائه (از همان ارائه‌ی اول). [paid] = کاربر پلن پولی دارد ⇒ تبلیغ ندارد. اگر تبلیغ هنوز آماده نباشد، همان بار نمایش داده نمی‌شود. */
    fun onDeckDone(activity: Activity, paid: Boolean) {
        if (!BuildConfig.ADS_ENABLED || paid) return
        try {
            if (TapsellAds.showInterstitialIfReady(activity)) return
            AdiveryAds.showInterstitialIfReady()
        } catch (_: Throwable) {}
    }

    fun rewardedReady(): Boolean = TapsellAds.rewardedReady() || AdiveryAds.rewardedReady()

    /**
     * نمایش ویدئو جایزه‌ای.
     * onReward: کاربر ویدئو را کامل دیده؛ onFail: تبلیغی آماده/نمایش‌پذیر نبود؛
     * onNoReward: ویدئو نمایش داده شد ولی کاربر بدون دریافت جایزه بستش (فقط ادیوری؛ برای باز شدن دکمه).
     */
    fun showRewarded(activity: Activity, onReward: () -> Unit, onFail: () -> Unit, onNoReward: () -> Unit = {}) {
        try {
            when {
                TapsellAds.rewardedReady() -> TapsellAds.showRewarded(activity, onReward, onFail)
                AdiveryAds.rewardedReady() -> AdiveryAds.showRewarded(onReward, onNoReward)
                else -> {
                    TapsellAds.showRewarded(activity, onReward) {} // فقط بارگذاری را شروع می‌کند
                    AdiveryAds.showRewarded(onReward) {}           // فقط prepare دوباره (در صورت لزوم)
                    onFail()
                }
            }
        } catch (_: Throwable) { onFail() }
    }

    // ---------------------------------------------------------------- بنر استاندارد
    /** بنر ۳۲۰×۵۰ بالای نوار پایین، فقط در تب تنظیمات و وسط‌چین؛ برای کاربر پولی یا «بدون تبلیغ» چیزی ترسیم نمی‌شود. */
    @Composable
    fun Banner(paid: Boolean, modifier: Modifier = Modifier) {
        if (!bannerOn || paid) return
        if (TapsellAds.bannerOn) TapsellAds.Banner(modifier) else AdiveryAds.Banner(modifier)
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
                    }, onFail = { busy = false; say("فعلاً ویدئویی آماده نیست؛ کمی بعد دوباره امتحان کنید" + "\n[${diag()}]") }, onNoReward = { busy = false })
                }) { Text("دیدن ویدئو") }
            }
        }
    }

    private fun String.faDigits(): String = map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")
}
