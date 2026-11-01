package ir.pptsaz.app

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import ir.cafebazaar.poolakey.Connection
import ir.cafebazaar.poolakey.Payment
import ir.cafebazaar.poolakey.config.PaymentConfiguration
import ir.cafebazaar.poolakey.config.SecurityCheck
import ir.cafebazaar.poolakey.request.PurchaseRequest
import kotlinx.coroutines.launch

/** مشخصات فروشگاه این نسخه‌ی اپ (هر flavor نسخه‌ی خودش را دارد). */
object Store {
    const val ID = "bazaar" // کلید فلگ در /api/config و بخش آخر مسیر /api/pay/<ID>
    const val NAME_FA = "کافه‌بازار"
    /** به‌روزرسانی با BazaarUpdater SDK؛ نیازی به ثبت نسخه در پنل ادمین نیست. */
    const val NATIVE_UPDATE = true
    fun updateUrl(fromServer: String): String = fromServer
}

/**
 * پرداخت درون‌برنامه‌ای کافه‌بازار (پولکی). هر پلن یک محصول «مصرفی» با شناسه‌ی plan_<id> است (plan_plus، plan_pro).
 * ترتیب: خرید ← تایید روی سرور (فعال‌سازی پلن) ← مصرف‌کردن خرید تا ماه بعد دوباره قابل خرید باشد.
 */
class BazaarBilling(
    private val activity: ComponentActivity,
    private val onReady: (Boolean) -> Unit,
) {
    private val payment = Payment(
        context = activity,
        config = PaymentConfiguration(localSecurityCheck = SecurityCheck.Enable(rsaPublicKey = BuildConfig.BAZAAR_RSA_KEY)),
    )
    private var connection: Connection? = null
    private var ready = false
    private var buying = false
    private var buyingSince = 0L
    private var stopped = false // disconnect() صدا زده شده؛ دیگر خودکار وصل نشود
    private var attempt = 0
    private var gen = 0 // هر اتصال یک نسل؛ callbackهای نسل قدیمی نادیده گرفته می‌شوند
    private val handler = Handler(Looper.getMainLooper())
    private val retry = Runnable { if (!stopped && !ready) connectNow() }

    fun connect() {
        stopped = false
        if (connection != null) return
        attempt = 0
        connectNow()
    }

    private fun connectNow() {
        if (connection != null) return
        val g = ++gen
        connection = payment.connect {
            connectionSucceed {
                if (g == gen) {
                    ready = true
                    attempt = 0
                    onReady(true)
                }
            }
            connectionFailed { if (g == gen) lost() }
            disconnected { if (g == gen) lost() }
        }
    }

    /** اتصال قطع شد/برقرار نشد: با فاصله‌ی افزایشی (۲، ۵، ۱۰، ۲۰، ۳۰ ثانیه، حداکثر ۸ بار) خودکار دوباره وصل می‌شود. */
    private fun lost() {
        ready = false
        buying = false
        connection = null
        onReady(false)
        if (stopped || attempt >= 8) return
        val d = longArrayOf(2_000, 5_000, 10_000, 20_000, 30_000)[attempt.coerceAtMost(4)]
        attempt++
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, d)
    }

    fun disconnect() {
        stopped = true
        handler.removeCallbacks(retry)
        gen++
        connection?.disconnect()
        connection = null
        ready = false
        buying = false
    }

    private fun report(code: String, sku: String, t: Throwable? = null) {
        val detail = if (t == null) "" else t.javaClass.simpleName + ":" + t.message.orEmpty()
        activity.lifecycleScope.launch { Api.reportPay(code, detail, sku) }
    }

    /** onError با متن خالی یعنی کاربر خودش انصراف داده و پیامی لازم نیست. */
    fun purchase(sku: String, onPurchase: (productId: String, token: String) -> Unit, onError: (String) -> Unit) {
        if (!ready) { onError("اتصال به کافه‌بازار برقرار نیست. بازار را باز کنید و دوباره تلاش کنید."); return }
        if (buying && SystemClock.elapsedRealtime() - buyingSince < 120_000) {
            onError("پرداخت قبلی هنوز در جریان است؛ چند لحظه صبر کنید.")
            return
        }
        buying = true
        buyingSince = SystemClock.elapsedRealtime()
        payment.purchaseProduct(
            registry = activity.activityResultRegistry,
            request = PurchaseRequest(productId = sku, payload = "pptsaz"),
        ) {
            purchaseFlowBegan { }
            failedToBeginFlow { t ->
                buying = false
                report("begin_failed", sku, t)
                onError("باز کردن صفحه‌ی پرداخت بازار ممکن نشد. از ورود به حساب بازار مطمئن شوید.")
            }
            purchaseSucceed { p ->
                buying = false
                onPurchase(p.productId, p.purchaseToken)
            }
            purchaseCanceled {
                buying = false
                onError("")
            }
            purchaseFailed { t ->
                buying = false
                report("purchase_failed", sku, t)
                onError("خرید انجام نشد. اگر مبلغی کسر شده نگران نباشید؛ اشتراک خودکار فعال می‌شود، وگرنه دوباره تلاش کنید.")
            }
        }
    }

    /** خرید را مصرف می‌کند تا دوباره قابل خرید شود. فقط بعد از تایید موفق سرور صدا زده شود. */
    fun consume(token: String, done: (Boolean) -> Unit = {}) {
        if (!ready) { done(false); return }
        payment.consumeProduct(token) {
            consumeSucceed { done(true) }
            consumeFailed { done(false) }
        }
    }

    /** خریدهای مصرف‌نشده (مثلاً پرداخت شده ولی اپ قبل از تایید بسته شده) → فهرست (شناسه‌ی محصول، توکن). */
    fun unconsumed(cb: (List<Pair<String, String>>) -> Unit) {
        if (!ready) { cb(emptyList()); return }
        payment.getPurchasedProducts {
            querySucceed { list -> cb(list.map { it.productId to it.purchaseToken }) }
            queryFailed { cb(emptyList()) }
        }
    }
}
