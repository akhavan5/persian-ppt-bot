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

    // ------------------------------------------------------------ اسلاید صوتی و پادکست
    // این دو بعد از ارائه در سرور جدا ساخته می‌شوند و چند دقیقه طول می‌کشند؛ سرور درصد واقعی (۰ تا ۱۰۰) می‌دهد و همین عدد
    // در اعلان پیشرفت و نوار داخل اپ (Screens.kt) نشان داده می‌شود. pct < 0 یعنی هنوز در صف (نوار نامعین).

    private fun extraLabel(kind: String) = if (kind == "podcast") "پادکست" else "اسلاید صوتی"
    private fun extraProgressId(jobId: String) = jobId.hashCode() xor 0x3C3C3C
    private fun extraDoneId(deckId: String, kind: String) = (deckId + "|" + kind).hashCode()

    /**
     * رفتن به جای درست با لمس اعلان: files = false ⇒ کارت همان ارائه (صفحه‌ی «ساخت»)، files = true ⇒ تب «فایل‌ها»
     * (برای همراهی که جدا با دکمه خواسته شده و کارتش روی صفحه نیست).
     */
    private fun extraPending(ctx: Context, deckId: String, kind: String, files: Boolean, nid: Int, code: Int): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (files) putExtra("tab", 1) else putExtra("job_action", "open").putExtra("job_id", deckId).putExtra("nid", nid)
        }
        return PendingIntent.getActivity(ctx, (deckId + "|" + kind).hashCode() * 4 + code, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** اعلان «پیشرفت زنده» ساخت اسلاید صوتی / پادکست؛ jobId = شناسه‌ی کار صوتی در سرور، deckId = ارائه‌ای که صدایش ساخته می‌شود. */
    fun extraProgress(ctx: Context, jobId: String, deckId: String, kind: String, message: String, pct: Int, files: Boolean) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        try { nm.notify(extraProgressId(jobId), buildExtraProgress(ctx, deckId, kind, message, pct, files)) } catch (_: SecurityException) {}
    }

    fun cancelExtraProgress(ctx: Context, jobId: String) {
        NotificationManagerCompat.from(ctx).cancel(extraProgressId(jobId))
    }

    private fun buildExtraProgress(ctx: Context, deckId: String, kind: String, message: String, pct: Int, files: Boolean): Notification {
        ensureChannel(ctx)
        val label = extraLabel(kind)
        val text = message.ifBlank { "کمی صبر کنید؛ آماده که شد خبرتان می‌کنیم." }.take(120)
        val p = pct.coerceIn(-1, 100)
        val indeterminate = p < 0
        val intent = extraPending(ctx, deckId, kind, files, 0, 0)
        if (Build.VERSION.SDK_INT >= 36) {
            try { return liveExtraBuilder(ctx, "در حال ساخت $label…", text, p, indeterminate, kind, intent).build() } catch (_: Throwable) {
                // اگر ProgressStyle روی بعضی دستگاه‌ها خطا داد، به اعلان ساده برمی‌گردیم
            }
        }
        val b = NotificationCompat.Builder(ctx, CHANNEL_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("در حال ساخت $label…")
            .setContentText(text)
            .setContentIntent(intent)
            .setProgress(100, p.coerceAtLeast(0), indeterminate)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
        if (!indeterminate) b.setSubText("$p٪".toFa())
        return b.build()
    }

    @android.annotation.SuppressLint("NewApi")
    private fun liveExtraBuilder(
        ctx: Context, title: String, text: String, pct: Int, indeterminate: Boolean, kind: String, intent: PendingIntent,
    ): Notification.Builder {
        val seg = { len: Int -> Notification.ProgressStyle.Segment(len) }
        // بخش‌ها هم‌اندازه‌ی درصدهای سرور: متن (تا ۲۵٪)، ساخت صدا (تا ~۸۸٪ برای اسلاید و ~۹۰٪ برای پادکست)، جاسازی/چسباندن و ارسال
        val segs = if (kind == "podcast") listOf(seg(25), seg(65), seg(10)) else listOf(seg(25), seg(63), seg(12))
        val style = Notification.ProgressStyle()
            .setStyledByProgress(true)
            .setProgressIndeterminate(indeterminate)
            .setProgressSegments(segs)
            .setProgress(pct.coerceAtLeast(0))
        return Notification.Builder(ctx, CHANNEL_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(intent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setStyle(style)
            .setShortCriticalText(if (indeterminate) "…" else "$pct٪".toFa())
            .addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
    }

    /** اعلان پیشرفتِ Worker صوتی به‌عنوان اعلان سرویس پیش‌زمینه (همان شناسه‌ی اعلان معمولی تا فقط یکی بماند). */
    fun extraForegroundInfo(ctx: Context, jobId: String, deckId: String, kind: String, message: String, pct: Int, files: Boolean): ForegroundInfo {
        val n = buildExtraProgress(ctx, deckId, kind, message, pct, files)
        return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(extraProgressId(jobId), n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else ForegroundInfo(extraProgressId(jobId), n)
    }

    fun extraDone(ctx: Context, deckId: String, kind: String, deckTitle: String, files: Boolean) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        ensureChannel(ctx)
        val id = extraDoneId(deckId, kind)
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("${extraLabel(kind)} آماده شد ✓")
            .setContentText(deckTitle.ifBlank { "برای دانلود، اعلان را باز کن." }.take(120))
            .setContentIntent(extraPending(ctx, deckId, kind, files, id, 1))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
        try { nm.notify(id, b.build()) } catch (_: SecurityException) {}
    }

    fun extraFailed(ctx: Context, deckId: String, kind: String, message: String, files: Boolean) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        ensureChannel(ctx)
        val id = extraDoneId(deckId, kind)
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("ساخت ${extraLabel(kind)} ناموفق بود")
            .setContentText(message.ifBlank { "اعتبارش برگشت؛ دوباره تلاش کن." }.take(120))
            .setContentIntent(extraPending(ctx, deckId, kind, files, id, 1))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
        try { nm.notify(id, b.build()) } catch (_: SecurityException) {}
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
                            // اسلاید صوتی / پادکست همراه هنوز در حال ساخت‌اند: پیگیری و اعلان پیشرفتشان را به Worker‌ی جدا می‌سپاریم
                            val title = j.optString("title")
                            if (j.optString("audio") == "pending") j.optString("audioId").ifEmpty { null }?.let { ExtraWatcher.schedule(ctx, it, id, "audio", title, files = false) }
                            if (j.optString("podcast") == "pending") j.optString("podcastId").ifEmpty { null }?.let { ExtraWatcher.schedule(ctx, it, id, "podcast", title, files = false) }
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
            delay(if (AppForeground.on) POLL_FG_MS else pollDelayMs(System.currentTimeMillis() - t0, 0, POLL_MS))
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

/** پیگیری پس‌زمینه‌ی ساخت اسلاید صوتی / پادکست (kind = "audio" | "podcast")؛ مثل JobWatcher ولی برای کار صوتیِ جدا. */
object ExtraWatcher {
    fun schedule(ctx: Context, jobId: String, deckId: String, kind: String, title: String, files: Boolean) {
        val req = OneTimeWorkRequestBuilder<ExtraWatchWorker>()
            .setInputData(workDataOf("id" to jobId, "deck" to deckId, "kind" to kind, "title" to title, "files" to files, "t0" to System.currentTimeMillis()))
            .addTag("extrawatch-$jobId")
            .build()
        // KEEP: اگر برای همین کار Worker در حال اجراست، دومی ساخته نمی‌شود
        WorkManager.getInstance(ctx).enqueueUniqueWork("extrawatch-$jobId", ExistingWorkPolicy.KEEP, req)
    }

    fun cancel(ctx: Context, jobId: String) {
        WorkManager.getInstance(ctx).cancelAllWorkByTag("extrawatch-$jobId")
    }
}

class ExtraWatchWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    private companion object {
        const val MAX_MS = 25L * 60 * 1000 // کل زمان پیگیری از لحظه‌ی شروع ساخت
        const val POLL_MS = 3000L
        const val POLL_FG_MS = 4000L // اپ جلوی چشم است: ViewModel خودش می‌پرسد، اینجا فقط مراقبیم
    }

    private val jobId get() = inputData.getString("id").orEmpty()
    private val deckId get() = inputData.getString("deck").orEmpty()
    private val kind get() = inputData.getString("kind") ?: "audio"
    private val title get() = inputData.getString("title").orEmpty()
    private val files get() = inputData.getBoolean("files", false)

    override suspend fun getForegroundInfo(): ForegroundInfo =
        Notifier.extraForegroundInfo(applicationContext, jobId, deckId, kind, "", -1, files)

    override suspend fun doWork(): Result {
        if (jobId.isEmpty()) return Result.success()
        val t0 = inputData.getLong("t0", System.currentTimeMillis())
        val ctx = applicationContext
        Api.init(ctx)

        var lastKey = ""
        // شروع سرویس پیش‌زمینه فقط وقتی اپ جلوی چشم است مجاز است؛ اگر نشد، با اعلان معمولی ادامه می‌دهیم
        var fg = promote("", -1)

        while (System.currentTimeMillis() - t0 < MAX_MS) {
            if (!AppForeground.on) {
                try {
                    val j = Api.job(jobId)
                    when (j.optString("state")) {
                        "done" -> {
                            Notifier.cancelExtraProgress(ctx, jobId)
                            val arr = j.optJSONArray("ids")
                            val ids = if (arr == null) emptyList() else (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotEmpty() }
                            if (ids.isEmpty()) {
                                if (!AppForeground.on) Notifier.extraFailed(ctx, deckId, kind, "", files)
                            } else {
                                if (!AppForeground.on) Notifier.extraDone(ctx, deckId, kind, title, files)
                                // نسخه‌ی محلی را بی‌صدا ذخیره می‌کنیم (فایل‌های سرور بعد از ۲۴ ساعت پاک می‌شوند)
                                LocalFiles.autoSaveExtra(ctx, title, ids.map { it to kind })
                            }
                            return Result.success()
                        }
                        "error" -> {
                            Notifier.cancelExtraProgress(ctx, jobId)
                            if (!AppForeground.on) Notifier.extraFailed(ctx, deckId, kind, j.optString("message"), files)
                            return Result.success()
                        }
                        else -> {
                            val msg = j.optString("message")
                            val pct = jobPctOf(j)
                            val key = "$pct|$msg"
                            if (key != lastKey) {
                                lastKey = key
                                if (fg) fg = promote(msg, pct)
                                if (!fg) Notifier.extraProgress(ctx, jobId, deckId, kind, msg, pct, files)
                            }
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ApiException) {
                    if (e.status == 401 || e.status == 404) { Notifier.cancelExtraProgress(ctx, jobId); return Result.success() } // نشست تمام شده یا کار پاک شده
                } catch (_: Exception) {
                    // قطعی اینترنت: ساخت در سرور ادامه دارد؛ دوباره می‌پرسیم
                }
            }
            delay(if (AppForeground.on) POLL_FG_MS else pollDelayMs(System.currentTimeMillis() - t0, 0, POLL_MS))
        }
        Notifier.cancelExtraProgress(ctx, jobId)
        return Result.success()
    }

    private suspend fun promote(msg: String, pct: Int): Boolean =
        try {
            setForeground(Notifier.extraForegroundInfo(applicationContext, jobId, deckId, kind, msg, pct, files))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            false // ForegroundServiceStartNotAllowedException (شروع از پس‌زمینه) یا نبودن مجوز
        }
}
