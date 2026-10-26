package ir.pptsaz.app

import androidx.activity.ComponentActivity

/**
 * نسخه‌ی مایکت (و هر فروشگاه دیگر): بدون پولکی و بدون هیچ مجوز کافه‌بازار.
 * API همان کلاس نسخه‌ی بازار است؛ onReady(false) یعنی پرداخت از طریق درگاه وب انجام می‌شود.
 */
@Suppress("UNUSED_PARAMETER")
class BazaarBilling(
    activity: ComponentActivity,
    private val onReady: (Boolean) -> Unit,
) {
    fun connect() = onReady(false)

    fun disconnect() {}

    fun purchase(sku: String, onPurchase: (productId: String, token: String) -> Unit, onError: (String) -> Unit) {
        onError("پرداخت درون‌برنامه‌ای در این نسخه فعال نیست.")
    }

    fun consume(token: String, done: (Boolean) -> Unit = {}) = done(false)

    fun unconsumed(cb: (List<Pair<String, String>>) -> Unit) = cb(emptyList())
}
