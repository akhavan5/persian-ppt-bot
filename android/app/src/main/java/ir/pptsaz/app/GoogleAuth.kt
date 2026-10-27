package ir.pptsaz.app

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

/** نتیجه‌ی ورود با گوگل: توکن، یا لغو توسط کاربر (بدون پیام)، یا پیام خطا. */
sealed interface GoogleResult {
    data class Token(val idToken: String) : GoogleResult
    data object Cancelled : GoogleResult
    /** ورود داخلی ممکن نیست (بدون سرویس‌های گوگل/حساب گوگل)؛ باید با مرورگر ادامه داد. */
    data object Unavailable : GoogleResult
    data class Failed(val message: String) : GoogleResult
}

/**
 * ورود با گوگل داخل خود اپ (برگه‌ی انتخاب حساب سیستم؛ بدون مرورگر).
 * [webClientId] همان GOOGLE_CLIENT_ID سرور (Web client) است که از /api/config می‌آید.
 * روی گوشی‌های بدون سرویس‌های گوگل یا بدون حساب گوگل، Unavailable برمی‌گردد و اپ ورود را با مرورگر ادامه می‌دهد.
 */
object GoogleAuth {
    suspend fun idToken(activityCtx: Context, webClientId: String): GoogleResult {
        return try {
            val option = GetSignInWithGoogleOption.Builder(webClientId).build()
            val req = GetCredentialRequest.Builder().addCredentialOption(option).build()
            val cred = CredentialManager.create(activityCtx).getCredential(activityCtx, req).credential
            if (cred is CustomCredential && cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                GoogleResult.Token(GoogleIdTokenCredential.createFrom(cred.data).idToken)
            } else {
                GoogleResult.Failed("ورود با گوگل ممکن نشد.")
            }
        } catch (e: GetCredentialCancellationException) {
            GoogleResult.Cancelled
        } catch (e: NoCredentialException) {
            GoogleResult.Unavailable
        } catch (e: GoogleIdTokenParsingException) {
            GoogleResult.Failed("پاسخ گوگل قابل خواندن نبود؛ دوباره امتحان کنید.")
        } catch (e: GetCredentialException) {
            GoogleResult.Unavailable
        } catch (e: Exception) {
            GoogleResult.Failed("ورود با گوگل ممکن نشد.")
        }
    }
}
