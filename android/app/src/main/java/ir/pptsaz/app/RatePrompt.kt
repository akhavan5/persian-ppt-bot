package ir.pptsaz.app

import android.content.Context

/**
 * زمان‌بندی درخواست امتیاز: نه در اولین خروجی، بلکه بعد از دومین بار که کاربر فایلی را برای خودش دانلود می‌کند
 * (یعنی ارائه را ساخته و استفاده کرده)، حداکثر دو بار و با فاصله‌ی ۱۰ روز. بعد از «ثبت نظر» دیگر هرگز پرسیده نمی‌شود.
 */
object RatePrompt {
    private const val MIN_EXPORTS = 2
    private const val MAX_ASKS = 2
    private const val GAP_MS = 10L * 24 * 3600 * 1000

    private fun p(ctx: Context) = ctx.getSharedPreferences("rate", Context.MODE_PRIVATE)

    /** بعد از هر دانلود موفق صدا زده می‌شود؛ true یعنی همین حالا پنجره‌ی امتیاز نشان داده شود. */
    fun onExport(ctx: Context): Boolean {
        val p = p(ctx)
        val n = p.getInt("exports", 0) + 1
        p.edit().putInt("exports", n).apply()
        if (p.getBoolean("done", false) || n < MIN_EXPORTS) return false
        val asks = p.getInt("asks", 0)
        val now = System.currentTimeMillis()
        if (asks >= MAX_ASKS || now - p.getLong("last", 0L) < GAP_MS) return false
        p.edit().putInt("asks", asks + 1).putLong("last", now).apply()
        return true
    }

    fun done(ctx: Context) {
        p(ctx).edit().putBoolean("done", true).apply()
    }
}
