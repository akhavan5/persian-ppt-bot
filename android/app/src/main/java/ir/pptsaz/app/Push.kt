package ir.pptsaz.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * اعلان تبلیغاتی/خبری با FCM. مقدارهای فایربیس هنگام بیلد از متغیرهای محیطی می‌آیند (FIREBASE_*)؛
 * اگر خالی باشند همه‌ی این‌ها بی‌اثر است و اپ مثل قبل کار می‌کند (فایل google-services.json لازم نیست).
 * پیام‌ها «data-only» هستند و اعلان را خود اپ می‌سازد؛ و گزینه‌ی خاموش‌کردن آن‌ها در تنظیمات اپ وجود ندارد.
 */
object Push {
    private const val CHANNEL = "promo"

    val configured: Boolean
        get() = BuildConfig.FIREBASE_APP_ID.isNotEmpty() && BuildConfig.FIREBASE_API_KEY.isNotEmpty() &&
            BuildConfig.FIREBASE_PROJECT_ID.isNotEmpty() && BuildConfig.FIREBASE_SENDER_ID.isNotEmpty()

    fun init(ctx: Context) {
        if (!configured) return
        try {
            if (FirebaseApp.getApps(ctx).isEmpty()) {
                FirebaseApp.initializeApp(
                    ctx,
                    FirebaseOptions.Builder()
                        .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                        .setApiKey(BuildConfig.FIREBASE_API_KEY)
                        .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                        .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                        .build(),
                )
            }
        } catch (_: Exception) {
        }
    }

    /** اعلان اخبار و تخفیف همیشه روشن است و کاربر گزینه‌ای برای خاموش‌کردنش در اپ ندارد (مقدار قدیمیِ خاموش هم نادیده گرفته می‌شود). */
    @Suppress("UNUSED_PARAMETER")
    fun promoEnabled(ctx: Context): Boolean = true

    private suspend fun token(): String? = suspendCancellableCoroutine { c ->
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { t -> c.resume(if (t.isSuccessful) t.result else null) }
        } catch (_: Exception) {
            c.resume(null)
        }
    }

    /** توکن دستگاه را (با وضعیت روشن/خاموش بودن اعلان تبلیغاتی) روی سرور ثبت یا حذف می‌کند. بدون FCM/گوگل بی‌صدا رد می‌شود. */
    suspend fun sync(ctx: Context, remove: Boolean = false) {
        if (!configured) return
        init(ctx)
        try {
            Api.init(ctx)
            val t = token() ?: return
            Api.pushRegister(t, promoEnabled(ctx), remove)
        } catch (_: Exception) {
        }
    }

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "اخبار و تخفیف‌ها", NotificationManager.IMPORTANCE_DEFAULT)
                    .apply { description = "اطلاعیه‌ها، قابلیت‌های تازه و تخفیف‌های پاورپوینت‌ساز" },
            )
        }
    }

    fun showPromo(ctx: Context, title: String, body: String, url: String?, tab: Int = -1) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        ensureChannel(ctx)
        val id = (System.currentTimeMillis() % Int.MAX_VALUE).toInt()
        // لینک https دارد: مستقیم در مرورگر باز می‌شود (اپ اصلاً باز نمی‌شود)؛ بدون لینک (مثلاً اعلان هدیه): اپ باز می‌شود
        val i = if (!url.isNullOrEmpty() && url.startsWith("https://")) {
            Intent(Intent.ACTION_VIEW, Uri.parse(url))
        } else {
            Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                if (tab >= 0) putExtra("tab", tab)
            }
        }
        val pi = PendingIntent.getActivity(ctx, id, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pi)
            .setAutoCancel(true)
        try { nm.notify(id, b.build()) } catch (_: SecurityException) {}
    }
}
