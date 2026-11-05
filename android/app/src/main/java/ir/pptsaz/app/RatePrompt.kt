package ir.pptsaz.app

import android.content.Context

/**
 * زمان‌بندی درخواست امتیاز: بعد از اولین باری که کاربر از ارائه‌اش استفاده می‌کند، حداکثر ۱۰ بار و با فاصله‌ی ۷ روز.
 * «استفاده» یکی از این دو است:
 *  - اولین دانلود فایل برای خودش (نه اشتراک‌گذاری)؛
 *  - دیدن فایل داخل خود اپ (پیش‌نمایش اسلایدها یا پوستر)، فقط اگر کاربر هنوز هیچ دانلودی نداشته باشد؛
 *    کسی که دانلود کرده از مسیر دانلود شمرده می‌شود و دیدن‌های بعدی چیزی اضافه نمی‌کند.
 * بعد از «ثبت نظر» دیگر هرگز پرسیده نمی‌شود.
 */
object RatePrompt {
    private const val MIN_USES = 1
    private const val MAX_ASKS = 10
    private const val GAP_MS = 7L * 24 * 3600 * 1000

    private fun p(ctx: Context) = ctx.getSharedPreferences("rate", Context.MODE_PRIVATE)

    /** بعد از هر دانلود موفق صدا زده می‌شود؛ true یعنی همین حالا پنجره‌ی امتیاز نشان داده شود. */
    fun onExport(ctx: Context): Boolean {
        val p = p(ctx)
        val n = p.getInt("exports", 0) + 1
        p.edit().putInt("exports", n).apply()
        return shouldAsk(p, n)
    }

    /** بعد از بسته شدن پیش‌نمایش/پوستر داخل اپ صدا زده می‌شود. اگر کاربر قبلاً دانلودی داشته، بی‌اثر است. */
    fun onView(ctx: Context): Boolean {
        val p = p(ctx)
        if (p.getInt("exports", 0) > 0) return false
        val n = p.getInt("views", 0) + 1
        p.edit().putInt("views", n).apply()
        return shouldAsk(p, n)
    }

    private fun shouldAsk(p: android.content.SharedPreferences, uses: Int): Boolean {
        if (p.getBoolean("done", false) || uses < MIN_USES) return false
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
