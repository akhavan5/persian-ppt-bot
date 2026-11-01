package ir.pptsaz.app

import android.content.Context
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
fun ShareDialog(canPdf: Boolean, onDismiss: () -> Unit, onPick: (pkg: String?, asPdf: Boolean) -> Unit) {
    val ctx = LocalContext.current
    val targets = remember { installedShareTargets(ctx) }
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
