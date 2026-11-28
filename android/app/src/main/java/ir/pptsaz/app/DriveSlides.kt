package ir.pptsaz.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/** نتیجه‌ی درخواست دسترسی Drive: توکن، صفحه‌ی رضایت (باید با Activity Result باز شود) یا ناممکن (بدون سرویس‌های گوگل، کلاینت/SHA-1 ثبت‌نشده، …). */
sealed interface DriveAuth {
    data class Token(val value: String) : DriveAuth
    data class Resolve(val pending: PendingIntent) : DriveAuth
    data object Unavailable : DriveAuth
}

/**
 * ساخت Google Slides مستقیم از داخل اپ، مثل دکمه‌ی سایت: دسترسی drive.file (Google Identity Authorization؛ بدون SDK اضافه و بدون تأیید گوگل)
 * ← آپلود چندبخشی PPTX به Drive خودِ کاربر با mimeType گوگل‌اسلایدز (گوگل خودش تبدیل می‌کند) ← webViewLink.
 * لازم: Google Play Services روی گوشی + OAuth Client از نوع Android برای همین applicationId و SHA-1 امضای همان نسخه‌ی انتشار در Google Cloud.
 * اگر هرکدام نبود Unavailable/null برمی‌گردد و ShareSheet به مسیر سایت (openSlidesOnSite) می‌رود.
 */
object DriveSlides {
    private const val SCOPE = "https://www.googleapis.com/auth/drive.file"
    private const val PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    private const val SLIDES = "application/vnd.google-apps.presentation"

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build()

    private fun granted(r: AuthorizationResult) = r.grantedScopes.contains(SCOPE) // کاربر ممکن است در صفحه‌ی رضایت تیک Drive را بردارد

    suspend fun authorize(ctx: Context): DriveAuth = suspendCancellableCoroutine { c ->
        try {
            val req = AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(SCOPE))).build()
            Identity.getAuthorizationClient(ctx).authorize(req)
                .addOnSuccessListener { r ->
                    val pi = r.pendingIntent
                    val tok = r.accessToken
                    c.resume(
                        when {
                            r.hasResolution() && pi != null -> DriveAuth.Resolve(pi)
                            !tok.isNullOrEmpty() && granted(r) -> DriveAuth.Token(tok)
                            else -> DriveAuth.Unavailable
                        },
                    )
                }
                .addOnFailureListener { c.resume(DriveAuth.Unavailable) }
        } catch (e: Exception) {
            c.resume(DriveAuth.Unavailable)
        }
    }

    /** نتیجه‌ی صفحه‌ی رضایت؛ null = رد شد یا Drive تیک نخورد. */
    fun tokenFrom(ctx: Context, data: Intent?): String? = try {
        val r = Identity.getAuthorizationClient(ctx).getAuthorizationResultFromIntent(data)
        r.accessToken?.takeIf { it.isNotEmpty() && granted(r) }
    } catch (e: Exception) {
        null
    }

    /** ارائه را در Drive می‌سازد و لینک باز کردن در Slides را برمی‌گرداند؛ هر خطایی = null. */
    suspend fun create(token: String, title: String, pptx: ByteArray): String? = withContext(Dispatchers.IO) {
        try {
            val b = "pptsaz" + System.currentTimeMillis().toString(36)
            val head = "--$b\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
                JSONObject().put("name", title).put("mimeType", SLIDES).toString() +
                "\r\n--$b\r\nContent-Type: $PPTX\r\n\r\n"
            val body = head.toByteArray(Charsets.UTF_8) + pptx + "\r\n--$b--".toByteArray(Charsets.UTF_8)
            val req = Request.Builder()
                .url("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink")
                .header("Authorization", "Bearer $token")
                .post(body.toRequestBody("multipart/related; boundary=$b".toMediaType()))
                .build()
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) return@use null
                val j = JSONObject(r.body?.string().orEmpty())
                val id = j.optString("id")
                j.optString("webViewLink").ifEmpty { if (id.isNotEmpty()) "https://docs.google.com/presentation/d/$id/edit" else "" }.ifEmpty { null }
            }
        } catch (e: IOException) {
            null
        } catch (e: Exception) {
            null
        }
    }
}
