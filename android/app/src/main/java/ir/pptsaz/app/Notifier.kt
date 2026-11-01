package ir.pptsaz.app

import android.app.NotificationChannel
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

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
        try { nm.notify(progressId(jobId), buildProgress(ctx, jobId, message, step, extra)) } catch (_: SecurityException) {}
    }

    /** خود اعلان پیشرفت؛ هم برای notify معمولی و هم برای اعلان سرویس پیش‌زمینه‌ی WorkManager. */
    private fun buildProgress(ctx: Context, jobId: String, message: String, step: Int, extra: Boolean): Notification {
        ensureChannel(ctx)
        val text = message.ifBlank { "کمی صبر کنید؛ آماده که شد خبرتان می‌کنیم." }.take(120)
        val pct = percentOf(step, extra)
        val indeterminate = step <= 0
        val intent = pending(ctx, jobId, "open", 3)
        if (Build.VERSION.SDK_INT >= 36) {
            try { return liveBuilder(ctx, text, pct, indeterminate, step, intent).build() } catch (_: Throwable) {
                // اگر ProgressStyle روی بعضی دستگاه‌ها خطا داد، به اعلان ساده برمی‌گردیم
            }
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
        return b.build()
    }

    /** اعلان پیشرفت به‌عنوان اعلان سرویس پیش‌زمینه (نوع dataSync) برای Worker؛ همان شناسه‌ی اعلان معمولی تا فقط یک اعلان بماند. */
    fun foregroundInfo(ctx: Context, jobId: String, message: String, step: Int = 0, extra: Boolean = false): ForegroundInfo {
        val n = buildProgress(ctx, jobId, message, step, extra)
        return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(progressId(jobId), n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else ForegroundInfo(progressId(jobId), n)
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
            // setRequestPromotedOngoing فقط در SDK جدیدتر (36.1) هست؛ کلید extras در همه‌ی نسخه‌های اندروید ۱۶ کار می‌کند
            .addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
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
 * پیگیری ساخت ارائه در پس‌زمینه با یک Worker بلندمدت و پیش‌زمینه (setForeground، نوع dataSync).
 * سرویس پیش‌زمینه پردازش اپ را زنده نگه می‌دارد، پس حتی بعد از پاک شدن اپ از لیست اخیر هر ~۳ ثانیه وضعیت
 * پرسیده می‌شود، اعلان پیشرفت زنده به‌روز می‌ماند و در پایان اعلان «آماده شد» می‌آید.
 * با پایان کار از داخل اپ (JobWatcher.cancel) یا خودش تمام می‌شود.
 */
object JobWatcher {
    fun schedule(ctx: Context, jobId: String) {
        val req = OneTimeWorkRequestBuilder<JobWatchWorker>()
            .setInputData(workDataOf("id" to jobId, "t0" to System.currentTimeMillis()))
            .addTag("jobwatch-$jobId")
            .build()
        // KEEP: اگر برای همین کار Worker در حال اجراست، دومی ساخته نمی‌شود
        WorkManager.getInstance(ctx).enqueueUniqueWork("jobwatch-$jobId", ExistingWorkPolicy.KEEP, req)
    }

    fun cancel(ctx: Context, jobId: String) {
        WorkManager.getInstance(ctx).cancelAllWorkByTag("jobwatch-$jobId")
    }
}

class JobWatchWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    private companion object {
        const val MAX_MS = 25L * 60 * 1000 // کل زمان پیگیری از لحظه‌ی شروع ساخت
        const val POLL_MS = 3000L
        const val POLL_FG_MS = 4000L // اپ جلوی چشم است: ViewModel خودش می‌پرسد، اینجا فقط مراقبیم
    }

    // اگر سیستم Worker را متوقف و دوباره اجرا کرد (مثلاً محدودیت زمانی JobScheduler)، اعلان پیش‌زمینه از همین‌جا ساخته می‌شود
    override suspend fun getForegroundInfo(): ForegroundInfo =
        Notifier.foregroundInfo(applicationContext, inputData.getString("id").orEmpty(), "")

    override suspend fun doWork(): Result {
        val id = inputData.getString("id") ?: return Result.success()
        val t0 = inputData.getLong("t0", System.currentTimeMillis())
        val ctx = applicationContext
        Api.init(ctx)

        var step = 0
        var extra = false
        var lastKey = ""
        // شروع سرویس پیش‌زمینه فقط وقتی اپ جلوی چشم است مجاز است؛ اگر نشد، با اعلان معمولی ادامه می‌دهیم
        var fg = promote(id, "", 0, false)

        while (System.currentTimeMillis() - t0 < MAX_MS) {
            if (!AppForeground.on) {
                try {
                    val j = Api.job(id)
                    when (j.optString("state")) {
                        "done" -> {
                            Notifier.cancelProgress(ctx, id)
                            if (!AppForeground.on) Notifier.done(ctx, id, j.optString("title"))
                            // نسخه‌ی محلی را همین‌جا بی‌صدا ذخیره می‌کنیم (فایل‌های سرور بعد از ۲۴ ساعت پاک می‌شوند)
                            val h = if (j.optString("handout") == "ok") j.optString("handoutId").ifEmpty { null } else null
                            val p = if (j.optString("poster") == "ok") j.optString("posterId").ifEmpty { null } else null
                            LocalFiles.autoSave(ctx, id, j.optString("title"), j.optInt("slides"), h, p)
                            return Result.success()
                        }
                        "error" -> {
                            Notifier.cancelProgress(ctx, id)
                            if (!AppForeground.on) Notifier.failed(ctx, id, j.optString("message"))
                            return Result.success()
                        }
                        else -> {
                            val msg = j.optString("message")
                            val st = jobStepOf(msg)
                            if (st > 0) { if (st >= step) step = st }
                            else if (step >= 3 && msg.isNotBlank() && !msg.contains("صف")) extra = true
                            val key = "$step|$extra|$msg"
                            if (key != lastKey) {
                                lastKey = key
                                if (fg) fg = promote(id, msg, step, extra)
                                if (!fg) Notifier.progress(ctx, id, msg, step, extra)
                            }
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ApiException) {
                    if (e.status == 401 || e.status == 404) { Notifier.cancelProgress(ctx, id); return Result.success() } // نشست تمام شده یا کار پاک شده
                } catch (_: Exception) {
                    // قطعی اینترنت: ساخت در سرور ادامه دارد؛ دوباره می‌پرسیم
                }
            }
            delay(if (AppForeground.on) POLL_FG_MS else POLL_MS)
        }
        Notifier.cancelProgress(ctx, id)
        return Result.success()
    }

    private suspend fun promote(id: String, msg: String, step: Int, extra: Boolean): Boolean =
        try {
            setForeground(Notifier.foregroundInfo(applicationContext, id, msg, step, extra))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            false // ForegroundServiceStartNotAllowedException (شروع از پس‌زمینه) یا نبودن مجوز
        }
}
