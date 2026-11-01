package ir.pptsaz.app

import android.app.NotificationChannel
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/** تعداد Activityهای نمایان؛ اگر اپ جلوی چشم کاربر است اعلان نمی‌دهیم (خود صفحه وضعیت را نشان می‌دهد). */
object AppForeground {
    @Volatile var count = 0
    val on: Boolean get() = count > 0
}

/** اعلان محلی «ارائه آماده شد»؛ بدون FCM و بدون سرویس خارجی (در ایران مطمئن‌تر). */
object Notifier {
    private const val CHANNEL = "jobs"
    private const val CHANNEL_PROGRESS = "jobs_progress"

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "آماده شدن ارائه", NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = "وقتی ساخت ارائه تمام شد خبر می‌دهد" },
            )
        }
        // کانال جدا و بی‌صدا برای «در حال ساخت»، تا اعلان پایان همچنان صدا بدهد
        if (nm.getNotificationChannel(CHANNEL_PROGRESS) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_PROGRESS, "در حال ساخت ارائه", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "نشان می‌دهد ارائه هنوز در حال ساخت است" },
            )
        }
    }

    /** extras برای MainActivity: «open» = رفتن به کارت همان ارائه، «download» / «preview» = دکمه‌های روی اعلان. */
    private fun pending(ctx: Context, jobId: String, action: String, code: Int): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("job_action", action)
            putExtra("job_id", jobId)
            putExtra("nid", jobId.hashCode())
        }
        // requestCode باید برای هر دکمه فرق کند؛ PendingIntent فقط با action/data/type مقایسه می‌شود و extras را نمی‌بیند
        return PendingIntent.getActivity(ctx, jobId.hashCode() * 4 + code, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun show(ctx: Context, jobId: String, title: String, text: String, withActions: Boolean) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        ensureChannel(ctx)
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pending(ctx, jobId, "open", 0)) // اپ را روی کارت همین ارائه باز می‌کند
            .setAutoCancel(true)
            .setOnlyAlertOnce(true) // اگر VM و Worker هر دو خبر بدهند، یک اعلان می‌ماند
        if (withActions) {
            b.addAction(0, "دانلود", pending(ctx, jobId, "download", 1))
            b.addAction(0, "پیش‌نمایش", pending(ctx, jobId, "preview", 2))
        }
        try { nm.notify(jobId.hashCode(), b.build()) } catch (_: SecurityException) {}
    }

    private fun progressId(jobId: String) = jobId.hashCode() xor 0x5A5A5A

    /** درصد تقریبی هر مرحله؛ همان عددهای نوار پیشرفت داخل اپ (Screens.kt) تا اعلان و صفحه یکی باشند. */
    internal fun percentOf(step: Int, extra: Boolean): Int {
        val base = intArrayOf(0, 15, 45, 80)[step.coerceIn(0, 3)]
        return (base + if (extra) 12 else 0).coerceAtMost(95)
    }

    /**
     * اعلان «پیشرفت زنده» برای ساخت ارائه.
     * - اندروید ۱۶ به بالا: Notification.ProgressStyle با سه بخش (تحلیل، ساخت اسلاید، نهایی‌سازی) و درخواست «Live Update»
     *   تا روی صفحه‌ی قفل و نوار وضعیت به‌صورت چیپ نمایش داده شود (اگر کاربر در تنظیمات اجازه نداده باشد، اعلان عادی می‌ماند).
     * - نسخه‌های قدیمی‌تر: همان اعلان ثابت و بی‌صدا، ولی با نوار درصدی به‌جای نوار نامعین.
     * با پایان کار یا باز شدن اپ برداشته می‌شود. step = ۰ یعنی هنوز در صف / مرحله‌ی نامشخص.
     */
    fun progress(ctx: Context, jobId: String, message: String, step: Int = 0, extra: Boolean = false) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        ensureChannel(ctx)
        val text = message.ifBlank { "کمی صبر کنید؛ آماده که شد خبرتان می‌کنیم." }.take(120)
        val pct = percentOf(step, extra)
        val indeterminate = step <= 0
        val intent = pending(ctx, jobId, "open", 3)
        try {
            if (Build.VERSION.SDK_INT >= 36) {
                nm.notify(progressId(jobId), liveBuilder(ctx, text, pct, indeterminate, step, intent).build())
                return
            }
        } catch (_: SecurityException) {
            return
        } catch (_: Throwable) {
            // اگر ProgressStyle روی بعضی دستگاه‌ها خطا داد، به اعلان ساده برمی‌گردیم
        }
        val b = NotificationCompat.Builder(ctx, CHANNEL_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("در حال ساخت ارائه…")
            .setContentText(text)
            .setContentIntent(intent)
            .setProgress(100, pct, indeterminate)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
        if (!indeterminate) b.setSubText("مرحله $step از ۳".toFa())
        try { nm.notify(progressId(jobId), b.build()) } catch (_: SecurityException) {}
    }

    @android.annotation.SuppressLint("NewApi")
    private fun liveBuilder(
        ctx: Context, text: String, pct: Int, indeterminate: Boolean, step: Int, intent: PendingIntent,
    ): Notification.Builder {
        val seg = { len: Int -> Notification.ProgressStyle.Segment(len) }
        val style = Notification.ProgressStyle()
            .setStyledByProgress(true)
            .setProgressIndeterminate(indeterminate)
            .setProgressSegments(listOf(seg(15), seg(30), seg(35), seg(20))) // صف/تحلیل، ساخت، تصویر و طراحی، نهایی‌سازی
            .setProgress(pct)
        return Notification.Builder(ctx, CHANNEL_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("در حال ساخت ارائه…")
            .setContentText(text)
            .setContentIntent(intent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setStyle(style)
            .setShortCriticalText(if (indeterminate) "…" else "$pct٪".toFa())
            .setRequestPromotedOngoing(true)
    }

    private fun String.toFa(): String =
        map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")

    fun cancelProgress(ctx: Context, jobId: String) {
        NotificationManagerCompat.from(ctx).cancel(progressId(jobId))
    }

    fun done(ctx: Context, jobId: String, deckTitle: String) =
        show(ctx, jobId, "ارائه‌ات آماده شد ✓", deckTitle.ifBlank { "برای دانلود یا پیش‌نمایش، اعلان را باز کن." }, withActions = true)

    fun failed(ctx: Context, jobId: String, message: String) =
        show(ctx, jobId, "ساخت ارائه ناموفق بود", message.ifBlank { "دوباره تلاش کن." }.take(120), withActions = false)
}

/**
 * اگر کاربر اپ را ببندد و پردازش اپ را سیستم متوقف کند، این کار پس‌زمینه هر ~۳۰ ثانیه وضعیت ساخت را می‌پرسد
 * (حداکثر ۴۰ بار ≈ ۲۰ دقیقه) و در پایان اعلان می‌دهد. با پایان کار از داخل اپ لغو می‌شود.
 */
object JobWatcher {
    fun schedule(ctx: Context, jobId: String, attempt: Int = 0, delaySec: Long = 45) {
        val req = OneTimeWorkRequestBuilder<JobWatchWorker>()
            .setInitialDelay(delaySec, TimeUnit.SECONDS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf("id" to jobId, "n" to attempt))
            .addTag("jobwatch-$jobId")
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("jobwatch-$jobId-$attempt", ExistingWorkPolicy.REPLACE, req)
    }

    fun cancel(ctx: Context, jobId: String) {
        WorkManager.getInstance(ctx).cancelAllWorkByTag("jobwatch-$jobId")
    }
}

class JobWatchWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString("id") ?: return Result.success()
        val n = inputData.getInt("n", 0)
        Api.init(applicationContext)
        try {
            val j = Api.job(id)
            when (j.optString("state")) {
                "done" -> {
                    Notifier.cancelProgress(applicationContext, id)
                    if (!AppForeground.on) Notifier.done(applicationContext, id, j.optString("title"))
                    // اپ بسته است: نسخه‌ی محلی را همین‌جا بی‌صدا ذخیره می‌کنیم (فایل‌های سرور بعد از ۲۴ ساعت پاک می‌شوند)
                    val h = if (j.optString("handout") == "ok") j.optString("handoutId").ifEmpty { null } else null
                    val p = if (j.optString("poster") == "ok") j.optString("posterId").ifEmpty { null } else null
                    LocalFiles.autoSave(applicationContext, id, j.optString("title"), j.optInt("slides"), h, p)
                    return Result.success()
                }
                "error" -> {
                    Notifier.cancelProgress(applicationContext, id)
                    if (!AppForeground.on) Notifier.failed(applicationContext, id, j.optString("message"))
                    return Result.success()
                }
                else -> if (!AppForeground.on) {
                    val msg = j.optString("message")
                    Notifier.progress(applicationContext, id, msg, jobStepOf(msg))
                }
            }
        } catch (e: ApiException) {
            if (e.status == 401 || e.status == 404) return Result.success() // نشست تمام شده یا کار پاک شده
        }
        if (n < 40) JobWatcher.schedule(applicationContext, id, n + 1, 30)
        return Result.success()
    }
}
