package ir.pptsaz.app

import android.app.NotificationChannel
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

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "آماده شدن ارائه", NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = "وقتی ساخت ارائه تمام شد خبر می‌دهد" },
            )
        }
    }

    private fun show(ctx: Context, jobId: String, title: String, text: String) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        ensureChannel(ctx)
        val open = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("tab", 1) // تب «فایل‌ها»
        }
        val pi = PendingIntent.getActivity(ctx, jobId.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true) // اگر VM و Worker هر دو خبر بدهند، یک اعلان می‌ماند
            .build()
        try { nm.notify(jobId.hashCode(), n) } catch (_: SecurityException) {}
    }

    fun done(ctx: Context, jobId: String, deckTitle: String) =
        show(ctx, jobId, "ارائه‌ات آماده شد ✓", deckTitle.ifBlank { "برای دانلود، تب فایل‌ها را باز کن." })

    fun failed(ctx: Context, jobId: String, message: String) =
        show(ctx, jobId, "ساخت ارائه ناموفق بود", message.ifBlank { "دوباره تلاش کن." }.take(120))
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
                    if (!AppForeground.on) Notifier.done(applicationContext, id, j.optString("title"))
                    return Result.success()
                }
                "error" -> {
                    if (!AppForeground.on) Notifier.failed(applicationContext, id, j.optString("message"))
                    return Result.success()
                }
            }
        } catch (e: ApiException) {
            if (e.status == 401 || e.status == 404) return Result.success() // نشست تمام شده یا کار پاک شده
        }
        if (n < 40) JobWatcher.schedule(applicationContext, id, n + 1, 30)
        return Result.success()
    }
}
