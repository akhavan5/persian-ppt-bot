package ir.pptsaz.app

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import ir.myket.billingclient.IabHelper
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

/** مشخصات فروشگاه این نسخه‌ی اپ (هر flavor نسخه‌ی خودش را دارد). */
object Store {
    const val ID = "myket" // کلید فلگ در /api/config و بخش آخر مسیر /api/pay/<ID>
    const val NAME_FA = "مایکت"

    /** آدرس به‌روزرسانی: اگر سرور آدرس بازار را داده بود، صفحه‌ی اپ در مایکت باز شود. */
    fun updateUrl(fromServer: String): String =
        if (fromServer.isBlank() || fromServer.contains("cafebazaar", ignoreCase = true)) "https://myket.ir/app/ir.pptsaz.app" else fromServer
}

/**
 * پرداخت درون‌برنامه‌ای مایکت (IabHelper). نام کلاس و API همان نسخه‌ی بازار است تا MainActivity و AppViewModel فرقی نکنند.
 * هر پلن یک محصول «مصرفی» با شناسه‌ی plan_<id> است (plan_plus، plan_pro) که باید در پنل توسعه‌دهندگان مایکت ساخته شود.
 *
 * «توکن» در این نسخه یک رشته‌ی JSON به شکل {"j": originalJson, "s": signature} است؛ سرور امضا را با کلید عمومی مایکت تایید می‌کند.
 * مایکت هر لحظه فقط یک درخواست async می‌پذیرد، پس همه‌ی عملیات در یک صف پشت‌سرهم اجرا می‌شوند.
 */
class BazaarBilling(
    private val activity: ComponentActivity,
    private val onReady: (Boolean) -> Unit,
) {
    private var helper: IabHelper? = null
    private var ready = false
    private var buying = false
    private var buyingSince = 0L
    private var stopped = false // disconnect() صدا زده شده؛ دیگر خودکار وصل نشود
    private var attempt = 0
    private val handler = Handler(Looper.getMainLooper())
    private val retry = Runnable { if (!stopped && !ready) connectNow() }

    private fun report(code: String, sku: String, msg: String? = null) {
        activity.lifecycleScope.launch { Api.reportPay(code, msg.orEmpty(), sku) }
    }

    /** توکن (JSON) → اجرای «مصرف» همان خرید؛ شیء Purchase داخل lambda نگه داشته می‌شود. */
    private val consumers = HashMap<String, (IabHelper.OnConsumeFinishedListener) -> Unit>()

    private val queue = ArrayDeque<(() -> Unit) -> Unit>()
    private var busy = false

    private fun enqueue(op: (done: () -> Unit) -> Unit) {
        queue.addLast(op)
        pump()
    }

    private fun pump() {
        if (busy) return
        val op = queue.removeFirstOrNull() ?: return
        busy = true
        var finished = false
        val done = {
            if (!finished) {
                finished = true
                busy = false
                pump()
            }
        }
        try { op(done) } catch (_: Exception) { done() }
    }

    private fun pack(json: String, signature: String): String = JSONObject().put("j", json).put("s", signature).toString()

    private fun skuOf(json: String): String? = try { JSONObject(json).optString("productId").ifEmpty { null } } catch (_: Exception) { null }

    /** نسخه‌های مختلف کتابخانه اسم متد آزادسازی را فرق می‌دهند (dispose یا disposeWhenFinished)؛ هرکدام بود صدا زده می‌شود. */
    private fun release(h: IabHelper) {
        for (name in arrayOf("disposeWhenFinished", "dispose")) {
            try {
                h.javaClass.getMethod(name).invoke(h)
                return
            } catch (_: NoSuchMethodException) {
            } catch (_: Exception) {
                return
            }
        }
    }

    fun connect() {
        stopped = false
        if (helper != null) return
        attempt = 0
        connectNow()
    }

    private fun connectNow() {
        if (helper != null) return
        try {
            val h = IabHelper(activity, BuildConfig.IAB_PUBLIC_KEY)
            h.enableDebugLogging(false)
            helper = h
            h.startSetup(IabHelper.OnIabSetupFinishedListener { r ->
                if (helper !== h) return@OnIabSetupFinishedListener
                ready = r.isSuccess
                if (!ready) {
                    release(h)
                    helper = null
                    scheduleRetry()
                } else {
                    attempt = 0
                }
                onReady(ready)
            })
        } catch (_: Throwable) {
            helper = null
            ready = false
            onReady(false)
            scheduleRetry()
        }
    }

    /** اتصال برقرار نشد: با فاصله‌ی افزایشی (۲، ۵، ۱۰، ۲۰، ۳۰ ثانیه، حداکثر ۸ بار) خودکار دوباره امتحان می‌شود. */
    private fun scheduleRetry() {
        if (stopped || attempt >= 8) return
        val d = longArrayOf(2_000, 5_000, 10_000, 20_000, 30_000)[attempt.coerceAtMost(4)]
        attempt++
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, d)
    }

    fun disconnect() {
        stopped = true
        handler.removeCallbacks(retry)
        helper?.let { release(it) }
        helper = null
        ready = false
        buying = false
        queue.clear()
        busy = false
        consumers.clear()
    }

    /** onError با متن خالی یعنی کاربر خودش انصراف داده و پیامی لازم نیست. */
    fun purchase(sku: String, onPurchase: (productId: String, token: String) -> Unit, onError: (String) -> Unit) {
        if (!ready) { onError("اتصال به مایکت برقرار نیست. مایکت را باز کنید و دوباره تلاش کنید."); return }
        if (buying && SystemClock.elapsedRealtime() - buyingSince < 120_000) {
            onError("پرداخت قبلی هنوز در جریان است؛ چند لحظه صبر کنید.")
            return
        }
        buying = true
        buyingSince = SystemClock.elapsedRealtime()
        enqueue { done ->
            val h = helper
            if (h == null) {
                buying = false
                onError("اتصال به مایکت برقرار نیست. مایکت را باز کنید و دوباره تلاش کنید.")
                done()
            } else {
                try {
                    h.launchPurchaseFlow(
                        activity, sku,
                        IabHelper.OnIabPurchaseFinishedListener { r, p ->
                            buying = false
                            done()
                            if (helper == null) return@OnIabPurchaseFinishedListener
                            if (r.isFailure || p == null) {
                                val cancelled = r.message?.contains("cancel", ignoreCase = true) == true
                                if (!cancelled) report("purchase_failed", sku, r.message)
                                onError(if (cancelled) "" else "خرید انجام نشد. اگر مبلغی کسر شده نگران نباشید؛ اشتراک خودکار فعال می‌شود، وگرنه دوباره تلاش کنید.")
                                return@OnIabPurchaseFinishedListener
                            }
                            val json = p.originalJson.orEmpty()
                            val token = pack(json, p.signature.orEmpty())
                            consumers[token] = { l -> h.consumeAsync(p, l) }
                            onPurchase(skuOf(json) ?: sku, token)
                        },
                        "pptsaz-" + UUID.randomUUID().toString().take(8),
                    )
                } catch (e: Exception) {
                    buying = false
                    done()
                    report("begin_failed", sku, e.javaClass.simpleName + ":" + e.message.orEmpty())
                    onError("باز کردن صفحه‌ی پرداخت مایکت ممکن نشد. از نصب‌بودن مایکت مطمئن شوید.")
                }
            }
        }
    }

    /** خرید را مصرف می‌کند تا دوباره قابل خرید شود. فقط بعد از تایید موفق سرور صدا زده شود. */
    fun consume(token: String, done: (Boolean) -> Unit = {}) {
        if (!ready) { done(false); return }
        enqueue { fin ->
            val h = helper
            val c = consumers[token]
            if (h == null || c == null) {
                done(false)
                fin()
            } else {
                try {
                    c(IabHelper.OnConsumeFinishedListener { _, r ->
                        if (r.isSuccess) consumers.remove(token)
                        done(r.isSuccess)
                        fin()
                    })
                } catch (_: Exception) {
                    done(false)
                    fin()
                }
            }
        }
    }

    /** خریدهای مصرف‌نشده (مثلاً پرداخت شده ولی اپ قبل از تایید بسته شده) → فهرست (شناسه‌ی محصول، توکن). */
    fun unconsumed(cb: (List<Pair<String, String>>) -> Unit) {
        if (!ready) { cb(emptyList()); return }
        enqueue { fin ->
            val h = helper
            if (h == null) {
                cb(emptyList())
                fin()
            } else {
                try {
                    h.queryInventoryAsync(
                        false,
                        IabHelper.QueryInventoryFinishedListener { r, inv ->
                            val out = ArrayList<Pair<String, String>>()
                            if (helper != null && r.isSuccess && inv != null) {
                                for (p in inv.allPurchases.orEmpty()) {
                                    val json = p.originalJson.orEmpty()
                                    val sku = skuOf(json) ?: continue
                                    val token = pack(json, p.signature.orEmpty())
                                    consumers[token] = { l -> h.consumeAsync(p, l) }
                                    out += sku to token
                                }
                            }
                            fin()
                            cb(out)
                        },
                    )
                } catch (_: Exception) {
                    cb(emptyList())
                    fin()
                }
            }
        }
    }
}
