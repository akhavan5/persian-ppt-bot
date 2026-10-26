package ir.pptsaz.app

import androidx.activity.ComponentActivity
import ir.cafebazaar.poolakey.Connection
import ir.cafebazaar.poolakey.Payment
import ir.cafebazaar.poolakey.config.PaymentConfiguration
import ir.cafebazaar.poolakey.config.SecurityCheck
import ir.cafebazaar.poolakey.request.PurchaseRequest

/** مشخصات فروشگاه این نسخه‌ی اپ (هر flavor نسخه‌ی خودش را دارد). */
object Store {
    const val ID = "bazaar" // کلید فلگ در /api/config و بخش آخر مسیر /api/pay/<ID>
    const val NAME_FA = "کافه‌بازار"
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

    fun connect() {
        if (connection != null) return
        connection = payment.connect {
            connectionSucceed {
                ready = true
                onReady(true)
            }
            connectionFailed {
                ready = false
                connection = null
                onReady(false)
            }
            disconnected {
                ready = false
                connection = null
                onReady(false)
            }
        }
    }

    fun disconnect() {
        connection?.disconnect()
        connection = null
        ready = false
    }

    /** onError با متن خالی یعنی کاربر خودش انصراف داده و پیامی لازم نیست. */
    fun purchase(sku: String, onPurchase: (productId: String, token: String) -> Unit, onError: (String) -> Unit) {
        if (!ready) { onError("اتصال به کافه‌بازار برقرار نیست. بازار را باز کنید و دوباره تلاش کنید."); return }
        if (buying) return
        buying = true
        payment.purchaseProduct(
            registry = activity.activityResultRegistry,
            request = PurchaseRequest(productId = sku, payload = "pptsaz"),
        ) {
            purchaseFlowBegan { }
            failedToBeginFlow {
                buying = false
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
            purchaseFailed {
                buying = false
                onError("خرید انجام نشد. دوباره تلاش کنید.")
            }
        }
    }

    /** خرید را مصرف می‌کند تا دوباره قابل خرید شود. فقط بعد از تایید موفق سرور صدا زده شود. */
    fun consume(token: String, done: (Boolean) -> Unit = {}) {
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
