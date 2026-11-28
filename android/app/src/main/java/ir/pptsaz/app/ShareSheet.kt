package ir.pptsaz.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap

/** پیام‌رسان‌هایی که مستقیم از داخل اپ می‌شود فایل را برایشان فرستاد (فقط آن‌هایی که روی گوشی نصب‌اند نمایش داده می‌شوند). */
private val MESSENGERS = listOf(
    "org.telegram.messenger", "org.telegram.messenger.web", // تلگرام (گوگل‌پلی و نسخه‌ی مستقل)
    "ir.eitaa.messenger", // ایتا
    "com.whatsapp", "com.whatsapp.w4b", // واتساپ و واتساپ بیزینس
    "ir.nasim", // بله
    "ir.resaneh1.iptv", // روبیکا
)

/** برنامه‌های گوگل: فایل با ACTION_VIEW (نه SEND) مستقیم در همان برنامه باز می‌شود؛ PPTX ← Slides، DOCX ← Docs. */
internal const val PKG_SLIDES = "com.google.android.apps.docs.editors.slides"
internal const val PKG_DOCS = "com.google.android.apps.docs.editors.docs"
internal fun isGoogleEditor(pkg: String?) = pkg == PKG_SLIDES || pkg == PKG_DOCS

/**
 * برنامه‌ی Google Slides نصب نیست: همان ارائه در سایت (مرورگر) باز می‌شود و دکمه‌ی «Google Slides» سایت آن را
 * مستقیم در Google Drive خودِ کاربر می‌سازد؛ نیازی به نصب برنامه نیست. فقط مسیر /open به برنامه برمی‌گردد (App Link)، پس این آدرس در مرورگر می‌ماند.
 */
internal suspend fun openSlidesOnSite(ctx: Context, fileId: String) {
    if (!Regex("[\\w-]{1,100}").matches(fileId)) return
    // لینک ورود یک‌بارمصرف از سرور (بدون ورود دوباره در مرورگر)؛ اگر نشد، آدرس ساده (کاربر خودش وارد می‌شود)
    val url = try { Api.siteLink(fileId).ifBlank { null } } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { null }
        ?: "${Api.BASE}/?files=$fileId"
    try {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {}
}

internal class ShareTarget(val pkg: String, val label: String, val icon: androidx.compose.ui.graphics.ImageBitmap?)

internal fun installedShareTargets(ctx: Context): List<ShareTarget> {
    val pm = ctx.packageManager
    return MESSENGERS.mapNotNull { pkg ->
        try {
            // بدون <queries> در manifest، اندروید ۱۱ به بالا برنامه‌ی نصب‌شده را نمی‌بیند
            val info = pm.getApplicationInfo(pkg, 0)
            val label = pm.getApplicationLabel(info).toString()
            val icon = runCatching { pm.getApplicationIcon(pkg).toBitmap(96, 96).asImageBitmap() }.getOrNull()
            ShareTarget(pkg, label, icon)
        } catch (_: Exception) {
            null
        }
    }
}

/** متن همراه فایل در پیام‌رسان‌ها (عنوان کپشن می‌شود). */
internal fun shareCaption(title: String): String =
    (if (title.isBlank()) "ارائه‌ام را با پاورپوینت‌ساز ساختم" else "«" + title.trim() + "» — ساخته‌شده با پاورپوینت‌ساز") + "\nhttps://pptsaz.ir"

/**
 * انتخاب مقصد ارسال: پیام‌رسان‌های نصب‌شده (مستقیم) یا فهرست سیستم («سایر برنامه‌ها»).
 * canPdf = فقط برای خودِ ارائه و وقتی سرور PDF را پشتیبانی می‌کند، می‌شود قالب را بین PPTX و PDF انتخاب کرد.
 * onPick(pkg, asPdf): pkg = null یعنی فهرست سیستم.
 */
@Composable
fun ShareDialog(canPdf: Boolean, onDismiss: () -> Unit, googlePkg: String? = null, webFileId: String? = null, onPick: (pkg: String?, asPdf: Boolean) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    // بعد از گرفتن توکن Drive: دریافت PPTX از سرور ← ساخت Slides در Drive کاربر ← باز کردن؛ هر خطا = مسیر سایت
    val finish: suspend (String) -> Unit = { token ->
        val id = webFileId.orEmpty()
        val link = try {
            val f = Api.fetchFile(id, maxRetries = 3)
            DriveSlides.create(token, f.name.replace(Regex("\\.pptx$", RegexOption.IGNORE_CASE), ""), f.bytes)
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { null }
        if (link != null) {
            Toast.makeText(ctx, "✅ در Google Drive تو ساخته شد", Toast.LENGTH_SHORT).show()
            try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
        } else {
            openSlidesOnSite(ctx, id)
        }
        onDismiss()
    }
    val consent = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r ->
        val t = if (r.resultCode == Activity.RESULT_OK) DriveSlides.tokenFrom(ctx, r.data) else null
        if (t != null) scope.launch { finish(t) } else busy = false // کاربر رضایت نداد: بدون مسیر جایگزین، فقط دکمه آزاد می‌شود
    }
    val targets = remember { installedShareTargets(ctx) }
    // «باز کردن در Google Slides/Docs» فقط وقتی برنامه روی گوشی نصب است (googlePkg را فقط برای ارائه‌ی PPTX و جزوه‌ی Word بده)
    val google = remember(googlePkg) {
        googlePkg?.let { p ->
            try {
                val icon = ctx.packageManager.getApplicationIcon(p).toBitmap(96, 96).asImageBitmap()
                ShareTarget(p, if (p == PKG_SLIDES) "باز کردن در Google Slides" else "باز کردن در Google Docs", icon)
            } catch (_: Exception) { null }
        }
    }
    var pdf by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("ارسال") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (canPdf) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !pdf, onClick = { pdf = false }, label = { Text("PPTX") })
                        FilterChip(selected = pdf, onClick = { pdf = true }, label = { Text("PDF") })
                    }
                    Text(
                        if (pdf) "PDF روی هر گوشی باز می‌شود (ساختنش ممکن است تا یک دقیقه طول بکشد)." else "برای ویرایش در پاورپوینت.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }
                google?.let { g -> ShareRow(g.label, g.icon) { onPick(g.pkg, false) } }
                // برنامه‌ی Slides نیست (فقط برای ارائه): ساخت Slides از راه سایت
                if (google == null && googlePkg == PKG_SLIDES && webFileId != null) {
                    ShareRow(if (busy) "در حال ساخت در Google Drive…" else "ساخت در Google Slides", null) {
                        if (!busy) {
                            busy = true
                            scope.launch {
                                when (val a = DriveSlides.authorize(ctx)) {
                                    is DriveAuth.Token -> finish(a.value)
                                    is DriveAuth.Resolve -> consent.launch(IntentSenderRequest.Builder(a.pending).build())
                                    DriveAuth.Unavailable -> { openSlidesOnSite(ctx, webFileId); onDismiss() } // بدون سرویس‌های گوگل/کلاینت: سایت
                                }
                            }
                        }
                    }
                }
                // مشاهده‌ی فایل در سایت (مرورگر، با ورود خودکار): مستقل از نصب بودن Slides و از ساخت Google Slides
                if (webFileId != null) ShareRow("مشاهده در سایت", null) { scope.launch { openSlidesOnSite(ctx, webFileId); onDismiss() } }
                targets.forEach { t ->
                    ShareRow(t.label, t.icon) { onPick(t.pkg, pdf) }
                }
                ShareRow("سایر برنامه‌ها…", null) { onPick(null, pdf) }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("انصراف") } },
    )
}

@Composable
private fun ShareRow(label: String, icon: androidx.compose.ui.graphics.ImageBitmap?, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(horizontal = 6.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (icon != null) Image(icon, contentDescription = null, modifier = Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)))
        else Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { AppIcon(AppIcons.Share, size = 26.dp) }
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}
