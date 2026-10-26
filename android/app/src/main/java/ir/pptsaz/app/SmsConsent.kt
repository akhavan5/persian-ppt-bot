package ir.pptsaz.app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status

/**
 * SMS User Consent API: بدون مجوز READ_SMS و بدون هش اپ در متن پیامک.
 * سیستم از کاربر می‌پرسد «این پیامک خوانده شود؟»؛ اگر تأیید کرد، کد از متن بیرون کشیده می‌شود.
 * اگر Google Play Services روی گوشی نباشد یا خطا بدهد، بی‌صدا هیچ کاری نمی‌کند و کاربر کد را دستی می‌زند.
 * باید قبل از STARTED شدن Activity ساخته شود (registerForActivityResult).
 */
class SmsConsent(private val activity: ComponentActivity, private val onCode: (String) -> Unit) {
    private var receiver: BroadcastReceiver? = null

    private val consentLauncher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK) {
            val msg = r.data?.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE).orEmpty()
            extractOtp(msg)?.let(onCode)
        }
    }

    fun start() {
        stop()
        try {
            SmsRetriever.getClient(activity).startSmsUserConsent(null)
                .addOnFailureListener { stop() }
            val rc = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) {
                    if (i.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
                    val status = i.extras?.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
                    when (status.statusCode) {
                        CommonStatusCodes.SUCCESS -> {
                            @Suppress("DEPRECATION")
                            val intent = i.extras?.getParcelable<Intent>(SmsRetriever.EXTRA_CONSENT_INTENT)
                            if (intent != null) try { consentLauncher.launch(intent) } catch (_: Exception) {}
                            stop()
                        }
                        CommonStatusCodes.TIMEOUT -> stop()
                    }
                }
            }
            ContextCompat.registerReceiver(
                activity, rc, IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION),
                SmsRetriever.SEND_PERMISSION, null, ContextCompat.RECEIVER_EXPORTED,
            )
            receiver = rc
        } catch (_: Throwable) {
            receiver = null
        }
    }

    fun stop() {
        receiver?.let { try { activity.unregisterReceiver(it) } catch (_: Exception) {} }
        receiver = null
    }
}
