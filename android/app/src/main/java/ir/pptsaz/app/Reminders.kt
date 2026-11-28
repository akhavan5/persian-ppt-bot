package ir.pptsaz.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * یادآورهای محلی (بدون سرور و FCM): همه‌چیز روی گوشی با WorkManager زمان‌بندی می‌شود.
 *
 *  act1 / act2    فعال‌سازی: ۲۴ ساعت و ۵ روز بعد از اولین ورود، اگر هنوز ارائه‌ای نساخته (برای همه‌ی کاربران اپ، مستقل از
 *                 ایمیل/تلگرام). با اولین ارائه‌ی موفق لغو می‌شوند.
 *  daily          اعتبار رایگان روزانه: وقتی اعتبار صفر است، فردا ساعت ۱۰ (بعد از ریست روزانه‌ی سرور = ۰۳:۳۰ تهران).
 *  plan3 / plan1  ۳ روز و ۱ روز مانده به پایان پلن (با اعتبار استفاده‌نشده).
 *  planout        اعتبار پلن تمام شده ولی روز مانده.
 *  extras         ۱ تا ۲ روز بعد از ساخت ارائه: جزوه/پوستر/پادکست.
 *  inactive7/21   ۷ و ۲۱ روز بعد از آخرین باز شدن اپ، با ایده‌ی فصلی.
 *  files1         ۱ ساعت بعد از ساخت ارائه: «فایل‌هایت آماده‌ی دانلود است» (همتای ایمیل سرور؛ تا ۲۰ ساعت مهلت چون فایل‌ها ۲۴ ساعت می‌مانند).
 *  buy48          پیشنهاد خرید پلن: ۴۸ ساعت بعد از آخرین ارائه، فقط اگر پلن فعال ندارد و هرگز پلن نداشته؛ یک‌بار برای هر دستگاه
 *                 (کاربران قدیمی که زمان آخرین ارائه‌شان ثبت نشده، ۴۸ ساعت بعد از اولین باز شدنِ نسخه‌ی جدید).
 *  next           «ارائه‌ی بعدی»: ۳ روز بعد از ارائه‌ی اول یا دوم، با یک ایده‌ی نمونه (همتای کار nx سرور).
 *  low            فقط ۱ اعتبار از پلن مانده و پلن بیش از ۲ روز دیگر فعال است (همتای کار low سرور).
 *  coffee         «یک قهوه مهمانم کن»: ۲۴ ساعت بعد از ارائه‌ی دوم یا بعدتر؛ یک‌بار برای هر دستگاه؛ لینک /support.
 *  invite         دعوت دوستان: ۳ ساعت بعد از ارائه‌ی دوم تا ششم؛ یک‌بار برای هر دستگاه.
 *  pf             هدیه‌ی تکمیل پروفایل (همتای اعلان «profile-gift» سرور): ۲۶ ساعت تا ۸ روز بعد از آخرین ارائه، فقط اگر سرور هنوز
 *                 هدیه‌ی ثبت موبایل/ایمیل را قابل‌دریافت می‌داند (giftAvailable)؛ یک‌بار برای هر دستگاه؛ با ثبت و تایید لغو می‌شود.
 *
 * قواعد: ساعت ۹ تا ۲۱ تهران؛ حداکثر ۱ در روز و ۳ در هفته؛ «بازگشت» حداکثر ۲ بار در ماه؛ هر یادآور برای هر کلید فقط یک‌بار؛
 * شرط هر یادآور هنگام نمایش دوباره از وضعیت ذخیره‌شده خوانده می‌شود (نه زمان زمان‌بندی)؛ اگر اپ باز است نشان داده نمی‌شود.
 */
object Reminders {
    private const val CHANNEL = "reminders"
    private const val HOUR = 3_600_000L
    private const val DAY = 24 * HOUR
    private const val TEHRAN = 12_600_000L // UTC+3:30 (ایران ساعت تابستانی ندارد)

    private val KINDS = listOf("act1", "act2", "daily", "plan3", "plan1", "planout", "extras", "inactive7", "inactive21", "files1", "buy48", "pf", "next", "low", "coffee", "invite")
    private const val SUPPORT_URL = "https://pptsaz.ir/support?utm_source=app&utm_medium=local&utm_campaign=coffee"

    /** برچسب اعلان FCM سرور ← نوع(های) همتای محلی؛ برای اینکه کاربر یک پیام را هم از سرور و هم از گوشی نبیند */
    private val TAG_KINDS = mapOf(
        "activation" to listOf("act1"), "activation5d" to listOf("act2"), "plan-expiry" to listOf("plan3", "plan1"),
        "plan-out" to listOf("planout"), "extras" to listOf("extras"), "buy48" to listOf("buy48"), "profile-gift" to listOf("pf"),
        "winback" to listOf("inactive7", "inactive21"), "next" to listOf("next"), "low" to listOf("low"),
        "coffee" to listOf("coffee"), "invite" to listOf("invite"), "files" to listOf("files1"),
    )

    /** برچسب اعلان FCM سرور ← تبی که با زدن اعلان باز می‌شود (۰ ساخت، ۱ فایل‌ها، ۳ حساب) */
    private val TAG_TAB = mapOf(
        "activation" to 0, "activation5d" to 0, "winback" to 0, "next" to 0, "invitee" to 0, "survey" to 0,
        "extras" to 1, "files" to 1, "deck-done" to 1, "receipt" to 3, "pay" to 3, "low" to 3, "buy48" to 3, "plan-expiry" to 3, "plan-out" to 3,
        "profile-gift" to 3, "invite" to 3, "referral" to 3,
    )

    /** اعلان خودکار سرور (FCM) رسید. null = نشان داده نشود (همتای محلی همین الان نمایش داده شده)؛ وگرنه تب مقصد (−۱ = پیش‌فرض).
     *  اگر همتای محلی دارد، آن برای ۲ روز مهار می‌شود تا کاربر همان پیام را دوباره نگیرد. */
    fun onServerPush(ctx: Context, tag: String): Int? {
        try {
            val p = prefs(ctx)
            val now = System.currentTimeMillis()
            val kinds = TAG_KINDS[tag].orEmpty()
            if (kinds.isNotEmpty()) {
                val log = logEntries(p, now)
                if (kinds.any { k -> log.any { it.second == k && now - it.first < 20 * HOUR } }) return null
                val e = p.edit()
                for (k in kinds) e.putLong("srv_$k", now)
                e.apply()
            }
        } catch (_: Exception) {
        }
        return TAG_TAB[tag] ?: -1
    }

    private fun wasSent(p: android.content.SharedPreferences, key: String): Boolean = key in p.getStringSet("sent", emptySet()).orEmpty()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("reminders", Context.MODE_PRIVATE)

    // ------------------------------------------------------------------ زمان (تهران)

    private fun dayStart(t: Long): Long = ((t + TEHRAN) / DAY) * DAY - TEHRAN
    private fun hourOf(t: Long): Int = (((t + TEHRAN) % DAY) / HOUR).toInt()

    /** اگر t بیرون از ۹ تا ۲۱ تهران است، به اولین ساعت ۱۰ بعدی می‌برد. */
    private fun snap(t: Long): Long {
        val h = hourOf(t)
        return when {
            h < 9 -> dayStart(t) + 10 * HOUR
            h >= 21 -> dayStart(t) + DAY + 10 * HOUR
            else -> t
        }
    }

    /** اولین ساعت ۱۰ صبح تهران که از t کمتر نباشد. */
    private fun next10(t: Long): Long {
        val d = dayStart(t) + 10 * HOUR
        return if (d >= t) d else d + DAY
    }

    private fun Int.fa(): String = toString().map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")

    // ------------------------------------------------------------------ رویدادهای اپ

    /** هر بار که حساب از سرور خوانده می‌شود (باز شدن اپ، برگشت به اپ، بعد از ساخت یا خرید). */
    fun onMe(ctx: Context, me: Me, dailyFreeOn: Boolean) {
        try {
            val p = prefs(ctx)
            val now = System.currentTimeMillis()
            val decks = maxOf(me.decks, p.getInt("decks", 0))
            val e = p.edit()
            e.putBoolean("in", true)
            if (!p.contains("first_seen")) e.putLong("first_seen", now)
            e.putInt("decks", decks).putInt("credits", me.credits).putBoolean("unl", me.unlimited)
            e.putLong("last_open", now)
            e.putBoolean("gift", me.giftAvailable && me.giftCredits > 0 && me.giftMissing.isNotEmpty())
                .putInt("gift_credits", me.giftCredits).putString("gift_missing", me.giftMissing.joinToString(","))

            // عکس لحظه‌ای پلن: برای تشخیص «اعتبار پلن تمام شد، روز مانده» (سرور چنین پلنی را دیگر «فعال» نمی‌داند)
            val prevExp = p.getLong("plan_exp", 0L)
            val prevCr = p.getInt("plan_credits", 0)
            val planActive = me.planId != null && me.planExp > now
            var planOutAt = 0L
            if (planActive) {
                e.putString("plan_id", me.planId).putLong("plan_exp", me.planExp).putInt("plan_credits", me.planCredits)
                e.putString("plan_name", me.plans.firstOrNull { it.id == me.planId }?.name ?: "")
            } else {
                if (prevExp > now && prevCr > 0) {
                    planOutAt = next10(now + 6 * HOUR)
                    e.putLong("planout_exp", prevExp)
                }
                e.remove("plan_id").remove("plan_exp").remove("plan_credits").remove("plan_name")
            }
            if (me.planId != null) e.putBoolean("ever_plan", true) // یک‌بار پلن داشته؛ پیشنهاد خرید ۴۸ ساعته دیگر نمی‌رود
            e.apply()

            val first = p.getLong("first_seen", now)

            // فعال‌سازی
            if (decks == 0 && !me.unlimited) {
                if (first + DAY > now) schedule(ctx, "act1", snap(first + DAY), first + 4 * DAY)
                if (first + 5 * DAY > now) schedule(ctx, "act2", snap(first + 5 * DAY), first + 8 * DAY)
            } else {
                cancel(ctx, "act1"); cancel(ctx, "act2")
            }

            // اعتبار رایگان روزانه
            if (!me.unlimited && me.credits == 0 && dailyFreeOn) {
                val boundary = (now / DAY + 1) * DAY // نیمه‌شب UTC = ۰۳:۳۰ تهران؛ ریست سهم روزانه‌ی سرور
                val t = next10(boundary)
                schedule(ctx, "daily", t, t + 2 * DAY)
            } else cancel(ctx, "daily")

            // انقضای پلن
            if (planActive && me.planCredits > 0) {
                val t3 = snap(me.planExp - 3 * DAY)
                val t1 = snap(me.planExp - DAY)
                if (t3 > now && t3 < me.planExp) schedule(ctx, "plan3", t3, me.planExp) else cancel(ctx, "plan3")
                if (t1 > now && t1 < me.planExp) schedule(ctx, "plan1", t1, me.planExp) else cancel(ctx, "plan1")
                cancel(ctx, "planout")
            } else {
                cancel(ctx, "plan3"); cancel(ctx, "plan1")
                if (planOutAt > 0 && planOutAt < prevExp) schedule(ctx, "planout", planOutAt, prevExp)
            }

            scheduleInactive(ctx, now)

            // کم‌شدن اعتبار پلن: ۱ اعتبار مانده، پلن بیش از ۲ روز دیگر فعال، و تازه ارائه ساخته؛ برای هر دوره‌ی پلن یک‌بار زمان‌بندی می‌شود
            if (planActive && me.planCredits == 1 && me.planExp - now > 2 * DAY && now - p.getLong("deck_done_at", 0L) < 2 * DAY) {
                if (p.getLong("low_for", 0L) != me.planExp) {
                    p.edit().putLong("low_for", me.planExp).apply()
                    schedule(ctx, "low", snap(now + HOUR), now + 2 * DAY)
                }
            } else cancel(ctx, "low")

            // هدیه‌ی تکمیل پروفایل: با ثبت موبایل/ایمیل (giftAvailable=false) لغو می‌شود
            if (p.getBoolean("gift", false)) scheduleGift(ctx, p, now) else cancel(ctx, "pf")

            // پیشنهاد خرید برای کاربران قدیمی: ارائه ساخته‌اند ولی زمان آخرین ارائه روی گوشی ثبت نشده (فقط یک‌بار زمان‌بندی می‌شود)
            if (decks > 0 && !me.unlimited && !planActive && !p.getBoolean("ever_plan", false) && !p.getBoolean("buy48_done", false) &&
                p.getLong("deck_done_at", 0L) == 0L && !p.getBoolean("buy48_legacy", false)
            ) {
                p.edit().putBoolean("buy48_legacy", true).apply()
                schedule(ctx, "buy48", snap(now + 2 * DAY), now + 9 * DAY)
            }
        } catch (_: Exception) {
        }
    }

    /** ۲۶ ساعت تا ۸ روز بعد از آخرین ارائه. فقط وقتی زمان هنوز نرسیده زمان‌بندی می‌شود تا فراخوانی‌های پیاپی onMe کار در حال انتظار را عقب نیندازد. */
    private fun scheduleGift(ctx: Context, p: android.content.SharedPreferences, now: Long) {
        val doneAt = p.getLong("deck_done_at", 0L)
        if (doneAt == 0L || p.getInt("decks", 0) < 1) return
        val at = snap(doneAt + 26 * HOUR)
        val deadline = doneAt + 8 * DAY
        if (at > now && at < deadline) schedule(ctx, "pf", at, deadline)
    }

    /** باز شدن اپ (onStart): شمارنده‌ی «غیرفعال» از نو شروع می‌شود. */
    fun onOpen(ctx: Context) {
        try {
            val p = prefs(ctx)
            if (!p.getBoolean("in", false)) return
            val now = System.currentTimeMillis()
            p.edit().putLong("last_open", now).apply()
            scheduleInactive(ctx, now)
        } catch (_: Exception) {
        }
    }

    private fun scheduleInactive(ctx: Context, lastOpen: Long) {
        schedule(ctx, "inactive7", snap(lastOpen + 7 * DAY), lastOpen + 9 * DAY)
        schedule(ctx, "inactive21", snap(lastOpen + 21 * DAY), lastOpen + 23 * DAY)
    }

    /** اولین (یا هر) ارائه‌ی موفق. */
    fun onDeckDone(ctx: Context) {
        try {
            val p = prefs(ctx)
            val now = System.currentTimeMillis()
            p.edit().putInt("decks", p.getInt("decks", 0) + 1).putLong("deck_done_at", now).apply()
            cancel(ctx, "act1"); cancel(ctx, "act2")
            val t = snap(now + 30 * HOUR)
            schedule(ctx, "extras", t, t + 3 * DAY)
            // ۱ ساعت بعد: فایل‌هایت آماده‌ی دانلود است (تا ۲۰ ساعت، قبل از پاک‌شدن ۲۴ ساعته‌ی فایل‌ها)
            schedule(ctx, "files1", snap(now + HOUR), now + 20 * HOUR)
            if (p.getBoolean("gift", false)) scheduleGift(ctx, p, now)
            // ۴۸ ساعت بعد از آخرین ارائه: پیشنهاد خرید (با هر ارائه‌ی تازه از نو شمرده می‌شود)
            if (!p.getBoolean("unl", false) && p.getString("plan_id", "").orEmpty().isEmpty() &&
                !p.getBoolean("ever_plan", false) && !p.getBoolean("buy48_done", false)
            ) schedule(ctx, "buy48", snap(now + 2 * DAY), now + 9 * DAY)
            val n = p.getInt("decks", 0)
            // «ارائه‌ی بعدی»: ۳ روز بعد از ارائه‌ی اول یا دوم
            if (n in 1..2) schedule(ctx, "next", snap(now + 3 * DAY), now + 5 * DAY)
            // قهوه و دعوت دوستان: یک‌بار برای هر دستگاه (کلید once در مجموعه‌ی «ارسال‌شده‌ها»)
            if (n >= 2 && !wasSent(p, "coffee|once")) schedule(ctx, "coffee", snap(now + DAY), now + 4 * DAY)
            if (n in 2..6 && !wasSent(p, "invite|once")) schedule(ctx, "invite", snap(now + 3 * HOUR), now + 3 * DAY)
        } catch (_: Exception) {
        }
    }

    /** جزوه/پوستر/اسلاید صوتی/پادکستِ جدا ساخته شد: دیگر لازم نیست یادآوری شود. */
    fun onExtraMade(ctx: Context) {
        try {
            prefs(ctx).edit().putLong("extra_made_at", System.currentTimeMillis()).apply()
            cancel(ctx, "extras")
        } catch (_: Exception) {
        }
    }

    fun onLogout(ctx: Context) {
        try {
            cancelAll(ctx)
            prefs(ctx).edit().clear().apply()
        } catch (_: Exception) {
        }
    }

    // ------------------------------------------------------------------ زمان‌بندی

    private fun schedule(ctx: Context, kind: String, at: Long, deadline: Long) {
        val delay = (at - System.currentTimeMillis()).coerceAtLeast(60_000L)
        val req = OneTimeWorkRequestBuilder<ReminderWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setInputData(workDataOf("kind" to kind, "deadline" to deadline))
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("rem-$kind", ExistingWorkPolicy.REPLACE, req)
    }

    private fun cancel(ctx: Context, kind: String) {
        WorkManager.getInstance(ctx).cancelUniqueWork("rem-$kind")
    }

    private fun cancelAll(ctx: Context) {
        for (k in KINDS) cancel(ctx, k)
    }

    // ------------------------------------------------------------------ نمایش (از ReminderWorker)

    private class Msg(val title: String, val body: String, val tab: Int, val topic: String? = null, val key: String = "", val url: String? = null)

    /** شرط هنگام نمایش از وضعیت ذخیره‌شده خوانده می‌شود؛ null = دیگر لازم نیست. */
    private fun build(ctx: Context, kind: String, deadline: Long, now: Long): Msg? {
        val p = prefs(ctx)
        if (!p.getBoolean("in", false)) return null
        val decks = p.getInt("decks", 0)
        val credits = p.getInt("credits", 0)
        val lastOpen = p.getLong("last_open", 0L)
        return when (kind) {
            "act1" -> {
                if (decks > 0) return null
                val title = if (credits > 0) "🎁 ${credits.fa()} ارائه‌ی رایگان منتظر توست" else "🎁 اولین ارائه‌ات منتظر توست"
                Msg(title, "یه موضوع بنویس تا هوش مصنوعی در چند دقیقه همه‌ی اسلایدها رو برات آماده کنه.", 0)
            }
            "act2" -> {
                if (decks > 0) return null
                val topic = SAMPLE_TOPICS[((now / DAY) % SAMPLE_TOPICS.size).toInt()]
                Msg("یه ایده برای شروع ✨", "امتحانش کن: «$topic» — فقط بزن روش تا آماده‌ی ساخت بشه.", 0, topic)
            }
            "daily" -> {
                if (p.getBoolean("unl", false) || credits > 0) return null
                Msg("🎁 اعتبار رایگان امروزت آماده‌ست", "بیا یه ارائه‌ی تازه بساز؛ فقط چند دقیقه طول می‌کشه.", 0, key = dayStart(now).toString())
            }
            "plan3", "plan1" -> {
                val exp = p.getLong("plan_exp", 0L)
                val cr = p.getInt("plan_credits", 0)
                if (exp != deadline || exp <= now || cr <= 0) return null
                val name = p.getString("plan_name", "").orEmpty().ifEmpty { "ویژه" }
                val title = if (kind == "plan3") "⏳ پلن $name ۳ روز دیگه تموم می‌شه" else "⏳ پلن $name فردا تموم می‌شه"
                Msg(title, "${cr.fa()} اعتبار هنوز مونده؛ ازش استفاده کن یا پلن رو تمدید کن (اعتبار جدید روی باقی‌مانده جمع می‌شه).", 3, key = deadline.toString())
            }
            "planout" -> {
                val exp = p.getLong("planout_exp", 0L)
                if (exp != deadline || exp <= now || p.getString("plan_id", "").orEmpty().isNotEmpty()) return null
                val days = ((exp - now + DAY - 1) / DAY).toInt().coerceAtLeast(1)
                Msg("اعتبار پلنت تموم شد", "${days.fa()} روز از مدت پلنت مونده؛ با تمدید، ۳۰ روز تازه با اعتبار جدید می‌گیری.", 3, key = deadline.toString())
            }
            "extras" -> {
                val doneAt = p.getLong("deck_done_at", 0L)
                if (decks < 1 || doneAt == 0L || p.getLong("extra_made_at", 0L) >= doneAt) return null
                Msg("ارائه‌ات رو کامل‌تر کن 📝", "برای ارائه‌ی اخیرت جزوه‌ی Word، پوستر یا پادکست هم بساز؛ هرکدام ۱ اعتبار جدا.", 1, key = doneAt.toString())
            }
            "files1" -> {
                val doneAt = p.getLong("deck_done_at", 0L)
                if (decks < 1 || doneAt == 0L) return null
                if (lastOpen - doneAt >= 30 * 60_000L) return null // بعد از ساخت دوباره اپ را باز کرده و فایل‌ها را دیده
                Msg("فایل ارائه‌ات آماده‌ی دانلوده 📂", "فایل‌های ساخته‌شده ۲۴ ساعت می‌مونن؛ اگه هنوز نگرفتیش از بخش فایل‌ها دانلودش کن.", 1, key = doneAt.toString())
            }
            "buy48" -> {
                if (p.getBoolean("buy48_done", false) || p.getBoolean("unl", false) || p.getBoolean("ever_plan", false)) return null
                if (decks < 1 || p.getString("plan_id", "").orEmpty().isNotEmpty()) return null
                val doneAt = p.getLong("deck_done_at", 0L)
                if (doneAt != 0L && now - doneAt < 2 * DAY - HOUR) return null // ارائه‌ی تازه‌تری ساخته شده؛ زمان‌بندی جدیدش جداست
                Msg("🚀 ارائه‌های بیشتر و بلندتر می‌خوای؟", "با پلن ماهانه ارائه و اسلاید بیشتری داری؛ پلن‌ها رو ببین.", 3, key = "once")
            }
            "pf" -> {
                val doneAt = p.getLong("deck_done_at", 0L)
                if (!p.getBoolean("gift", false) || decks < 1 || doneAt == 0L) return null
                if (now < doneAt + 26 * HOUR - HOUR || now > doneAt + 8 * DAY) return null // ارائه‌ی تازه‌تری ساخته شده؛ زمان‌بندی جدیدش جداست
                val missing = p.getString("gift_missing", "").orEmpty().split(",").filter { it.isNotEmpty() }
                if (missing.isEmpty()) return null
                val n = p.getInt("gift_credits", 0).fa()
                val both = missing.size > 1
                val what = if (both) "شماره‌ی موبایل و ایمیل" else if (missing[0] == "mobile") "شماره‌ی موبایل" else "ایمیل"
                val gift = if (both) "$n اعتبار هدیه برای هر مورد" else "$n اعتبار هدیه"
                Msg("🎁 هدیه‌ی تکمیل پروفایل", "با ثبت و تایید $what، $gift بگیر (برای هر مورد فقط یک‌بار).", 3, key = "once")
            }
            "next" -> {
                val doneAt = p.getLong("deck_done_at", 0L)
                if (decks !in 1..2 || doneAt == 0L || now - doneAt < 3 * DAY - HOUR) return null
                val topic = SAMPLE_TOPICS[((now / DAY) % SAMPLE_TOPICS.size).toInt()]
                Msg("ارائه‌ی بعدی‌ات چیه؟ 💡", "ایده: «$topic» — بزن روش تا آماده‌ی ساخت بشه.", 0, topic, key = doneAt.toString())
            }
            "low" -> {
                val exp = p.getLong("plan_exp", 0L)
                if (p.getInt("plan_credits", 0) != 1 || exp <= now + 2 * DAY) return null
                val name = p.getString("plan_name", "").orEmpty().ifEmpty { "ویژه" }
                val days = ((exp - now + DAY - 1) / DAY).toInt().coerceAtLeast(1)
                Msg("فقط ۱ اعتبار از پلنت مونده", "پلن $name تا ${days.fa()} روز دیگه فعاله؛ برای ادامه تمدیدش کن.", 3, key = exp.toString())
            }
            "coffee" -> {
                val doneAt = p.getLong("deck_done_at", 0L)
                if (decks < 2 || doneAt == 0L || now - doneAt < DAY - HOUR) return null
                Msg("☕ یه قهوه مهمونم می‌کنی؟", "اگه از pptساز خوشت اومده، یه قهوه مهمونم کن 💛", 0, key = "once", url = SUPPORT_URL)
            }
            "invite" -> {
                val doneAt = p.getLong("deck_done_at", 0L)
                if (decks !in 2..6 || doneAt == 0L || now - doneAt < 2 * HOUR) return null
                Msg("🙌 به دوستانت هم معرفی کن", "با دعوت دوستانت اعتبار هدیه بگیر؛ لینک اختصاصی‌ات توی بخش «حساب» آماده‌ست.", 3, key = "once")
            }
            "inactive7", "inactive21" -> {
                val days = if (kind == "inactive7") 7 else 21
                if (lastOpen == 0L || now - lastOpen < days * DAY - HOUR) return null
                val title = if (days == 7) "دلمون برات تنگ شده 👋" else "یه ایده‌ی تازه برای ارائه‌هات 💡"
                Msg(title, seasonalIdea(), 0, key = lastOpen.toString())
            }
            else -> null
        }
    }

    private val SAMPLE_TOPICS = listOf(
        "فتوسنتز و نقش آن در حیات", "هوش مصنوعی در پزشکی", "تاریخ ایران باستان", "اصول مدیریت زمان", "تغییرات اقلیمی و راه‌حل‌ها",
    )

    /** ایده‌ی متناسب با فصل تحصیلی (بر اساس ماه و روز میلادی؛ تقریبی). */
    private fun seasonalIdea(): String {
        val c = Calendar.getInstance()
        val md = (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH)
        return when {
            md in 923..1116 -> "ترم تازه شروع شده؛ ارائه‌ی کلاسی‌ت رو توی چند دقیقه آماده کن."
            md in 1117..1205 -> "هفته‌ی پژوهش نزدیکه؛ ارائه‌ی طرح یا مقاله‌ت رو با هوش مصنوعی بساز."
            md >= 1206 || md <= 218 -> "امتحان‌ها نزدیکه؛ خلاصه‌ی درس‌هات رو به اسلاید تبدیل کن تا مرورش راحت‌تر بشه."
            md in 219..420 -> "قبل از شلوغی پایان سال، ارائه‌ها و پروژه‌های عقب‌مونده‌ت رو سریع جمع کن."
            md in 421..722 -> "فصل دفاع پایان‌نامه‌ست؛ ارائه‌ی دفاعت رو توی چند دقیقه بساز."
            else -> "ترم جدید نزدیکه؛ از الان ارائه‌ی جلسه‌ی اولت رو آماده کن."
        }
    }

    // ------------------------------------------------------------------ سقف‌ها

    private fun logEntries(p: android.content.SharedPreferences, now: Long): List<Pair<Long, String>> =
        p.getString("log", "").orEmpty().split(",").mapNotNull {
            val i = it.indexOf(':')
            val t = if (i > 0) it.substring(0, i).toLongOrNull() else null
            if (t != null && now - t < 30 * DAY) t to it.substring(i + 1) else null
        }

    private fun capHit(log: List<Pair<Long, String>>, now: Long): Boolean {
        val today = dayStart(now)
        if (log.any { it.first >= today }) return true // حداکثر ۱ در روز
        return log.count { now - it.first < 7 * DAY } >= 3 // حداکثر ۳ در هفته
    }

    fun fire(ctx: Context, kind: String, deadline: Long) {
        val p = prefs(ctx)
        val now = System.currentTimeMillis()
        if (deadline > 0 && now > deadline) return
        if (AppForeground.on) return // کاربر همین حالا در اپ است
        if (now - p.getLong("srv_$kind", 0L) < 2 * DAY) return // سرور همین پیام را با FCM فرستاده (onServerPush)
        val msg = build(ctx, kind, deadline, now) ?: return
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return

        val sentKey = "$kind|${msg.key}"
        val sent = p.getStringSet("sent", emptySet()).orEmpty()
        if (sentKey in sent) return

        val window = snap(now)
        if (window > now) { if (window < deadline || deadline == 0L) schedule(ctx, kind, window, deadline); return }

        val log = logEntries(p, now)
        if (kind.startsWith("inactive") && log.count { it.second.startsWith("inactive") } >= 2) return // «بازگشت» حداکثر ۲ بار در ماه
        if (kind == "extras" && log.any { it.second == "extras" && now - it.first < 14 * DAY }) return
        if (capHit(log, now)) {
            val t = next10(dayStart(now) + DAY)
            if (deadline == 0L || t < deadline) schedule(ctx, kind, t, deadline)
            return
        }

        show(ctx, kind, msg)
        val newLog = (log + (now to kind)).joinToString(",") { "${it.first}:${it.second}" }
        // کلیدهای ارسال‌شده فقط تا ۶۰ کلید نگه داشته می‌شوند
        val newSent = (sent + sentKey).toList().takeLast(60).toSet()
        p.edit().putString("log", newLog).putStringSet("sent", newSent).also { if (kind == "buy48") it.putBoolean("buy48_done", true) }.apply()
    }

    private fun show(ctx: Context, kind: String, msg: Msg) {
        val nm = NotificationManagerCompat.from(ctx)
        if (Build.VERSION.SDK_INT >= 26) {
            val sys = ctx.getSystemService(NotificationManager::class.java)
            if (sys != null && sys.getNotificationChannel(CHANNEL) == null) {
                sys.createNotificationChannel(
                    NotificationChannel(CHANNEL, "یادآورها", NotificationManager.IMPORTANCE_DEFAULT)
                        .apply { description = "یادآوری اعتبار رایگان، پایان پلن و ایده‌هایی برای ساخت ارائه" },
                )
            }
        }
        val id = 0x52454D + KINDS.indexOf(kind)
        val i = if (msg.url != null && msg.url.startsWith("https://")) {
            Intent(Intent.ACTION_VIEW, android.net.Uri.parse(msg.url)) // مثل «قهوه»: صفحه‌ی وب
        } else Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("tab", msg.tab)
            if (msg.topic != null) putExtra("rem_topic", msg.topic)
        }
        val pi = PendingIntent.getActivity(ctx, id, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(msg.title)
            .setContentText(msg.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(msg.body))
            .setContentIntent(pi)
            .setAutoCancel(true)
        try { nm.notify(id, b.build()) } catch (_: SecurityException) {}
    }
}

class ReminderWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val kind = inputData.getString("kind") ?: return Result.success()
        try {
            Reminders.fire(applicationContext, kind, inputData.getLong("deadline", 0L))
        } catch (_: Exception) {
        }
        return Result.success()
    }
}
