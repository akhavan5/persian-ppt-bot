package ir.pptsaz.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * پشتیبانی هوشمند (همان دستیار چت سایت): فقط دستیار هوشمند جواب می‌دهد و موضوع‌های خاص (پرداخت، خطای فنی، حساب …) را
 * خودش به تیم پشتیبانی «ارجاع» می‌دهد. سرور همان اندپوینت‌های سایت است (/api/support/history و /api/support/send) با همان نشست اپ؛
 * سقف پیام روزانه و ضداسپم هم سمت سرور اعمال می‌شود. گفتگو روی سرور نگه‌داری می‌شود و بین اپ و سایت یکی است.
 */

/** r = u (کاربر) یا a (دستیار)؛ referred = این پاسخ به تیم پشتیبانی ارجاع شده است. */
class SupportMsg(val mine: Boolean, val text: String, val referred: Boolean = false, val human: Boolean = false)

class SupportData(val msgs: List<SupportMsg>, val remaining: Int, val limit: Int)

internal fun parseSupport(j: JSONObject): SupportData {
    val arr = j.optJSONArray("msgs")
    val msgs = if (arr == null) emptyList() else (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        val t = o.optString("t")
        if (t.isEmpty()) null else SupportMsg(o.optString("r") == "u", t, o.optInt("f") == 1, o.optString("r") == "m")
    }
    return SupportData(msgs, j.optInt("remaining", 10), j.optInt("limit", 10))
}

/** وضعیت چت پشتیبانی؛ در ViewModel نگه داشته می‌شود تا با چرخش صفحه از بین نرود. */
class SupportChat {
    var open by mutableStateOf(false)
    var msgs by mutableStateOf<List<SupportMsg>>(emptyList())
    var remaining by mutableIntStateOf(SUPPORT_DAILY_LIMIT)
    var limit by mutableIntStateOf(SUPPORT_DAILY_LIMIT)
    var loaded by mutableStateOf(false)
    var loadFailed by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var draft by mutableStateOf("")

    fun reset() {
        open = false; msgs = emptyList(); remaining = SUPPORT_DAILY_LIMIT; limit = SUPPORT_DAILY_LIMIT
        loaded = false; loadFailed = false; busy = false; error = null; draft = ""
    }

    fun apply(d: SupportData) {
        msgs = d.msgs; remaining = d.remaining; limit = d.limit
    }
}

const val SUPPORT_DAILY_LIMIT = 10
private const val SUPPORT_MAX_TEXT = 600
private const val GREETING = "سلام 👋 من دستیار هوشمند پاورپوینت‌ساز هستم. درباره‌ی قیمت و اعتبار، ساخت ارائه، مشکل‌های فنی یا حتی نکته‌های طراحی و ارائه‌ی سخنرانی بپرس."
private val CHIPS = listOf(
    "قیمت پلن‌ها چقدره؟",
    "اعتبار رایگان چطور می‌گیرم؟",
    "برای ارائه‌ی ۱۰ دقیقه‌ای چند اسلاید بسازم؟",
    "خروجی ارائه چه فرمت‌هایی دارد؟",
)

// ------------------------------------------------------------------ منطق (روی ViewModel)

fun AppViewModel.openSupport() {
    support.open = true
    loadSupport()
}

fun AppViewModel.closeSupport() {
    support.open = false
}

fun AppViewModel.loadSupport() {
    val s = support
    s.loadFailed = false
    viewModelScope.launch {
        try {
            s.apply(Api.supportHistory())
            s.loaded = true
        } catch (e: ApiException) {
            if (e.status == 401) { s.reset(); refresh() } // نشست تمام شده؛ به صفحه‌ی ورود می‌رود
            else if (!s.loaded) s.loadFailed = true
        }
    }
}

fun AppViewModel.sendSupport(raw: String) {
    val s = support
    val text = raw.trim()
    if (text.isEmpty() || s.busy || s.remaining <= 0) return
    val before = s.msgs
    s.busy = true
    s.error = null
    s.draft = ""
    s.msgs = before + SupportMsg(true, text)
    viewModelScope.launch {
        try {
            s.apply(Api.supportSend(text))
        } catch (e: ApiException) {
            // پیام نرفت: از فهرست برمی‌گردد و متن به جعبه‌ی نوشتن برمی‌گردد تا دوباره تایپ نشود
            s.msgs = before
            if (s.draft.isEmpty()) s.draft = text
            if (e.status == 401) { s.reset(); refresh(); return@launch }
            s.error = e.message ?: "ارسال نشد؛ دوباره امتحان کن."
            if (e.status == 429) { // سقف روزانه/ضداسپم: عدد «پیام باقی‌مانده» را با سرور هماهنگ کن
                try { s.apply(Api.supportHistory()) } catch (_: ApiException) {}
            }
        } finally {
            s.busy = false
        }
    }
}

// ------------------------------------------------------------------ رابط


private val URL_RE = Regex("https?://[^\\s)»«،؛]+")

/** آدرس‌های داخل پاسخ را قابل‌لمس می‌کند (باز شدن در مرورگر). نقطه/ویرگول آخر آدرس جزو لینک نیست. */
@Composable
private fun linkified(text: String, linkColor: Color) = remember(text, linkColor) {
    buildAnnotatedString {
        var last = 0
        for (m in URL_RE.findAll(text)) {
            val url = m.value.trimEnd('.', ',', ':', '!', '؟', '?')
            append(text.substring(last, m.range.first))
            withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)))) { append(url) }
            last = m.range.first + url.length
        }
        append(text.substring(last))
    }
}

@Composable
fun SupportDialog(vm: AppViewModel) {
    val s = vm.support
    val cs = MaterialTheme.colorScheme
    Dialog(
        onDismissRequest = { vm.closeSupport() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            Column(Modifier.fillMaxSize().background(cs.background).systemBarsPadding().imePadding()) {
                SupportHeader { vm.closeSupport() }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    when {
                        !s.loaded && s.loadFailed -> Column(
                            Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text("اتصال برقرار نشد. اینترنت خود را بررسی کنید.", textAlign = TextAlign.Center, color = cs.onSurfaceVariant)
                            TextButton(onClick = { vm.loadSupport() }) { Text("تلاش دوباره") }
                        }
                        !s.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                        else -> SupportMessages(vm)
                    }
                }
                SupportInput(vm)
            }
        }
    }
}

@Composable
private fun SupportHeader(onClose: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().background(LocalExtra.current.brand).padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconButton(onClick = onClose) { AppIcon(AppIcons.Close, tint = Color.White, description = "بستن پشتیبانی") }
        Column(Modifier.weight(1f)) {
            Text("پشتیبانی پاورپوینت‌ساز", style = MaterialTheme.typography.titleMedium, color = Color.White)
            Text("دستیار هوشمند · پاسخ فوری", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.92f))
        }
        Box(Modifier.size(40.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.22f)), contentAlignment = Alignment.Center) {
            AppIcon(AppIcons.Chat, tint = Color.White, size = 22.dp)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SupportMessages(vm: AppViewModel) {
    val s = vm.support
    val cs = MaterialTheme.colorScheme
    val state = rememberLazyListState()
    // ردیف‌ها: [سلام] + پیام‌ها + [در حال نوشتن] + [خطا]؛ بعد از هر تغییر به آخر لیست می‌رود
    val extra = (if (s.busy) 1 else 0) + (if (s.error != null) 1 else 0)
    val total = 1 + s.msgs.size + extra
    LaunchedEffect(total, s.busy) { state.animateScrollToItem(total - 1) }
    LazyColumn(
        state = state, modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "hello") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SupportBubble(SupportMsg(false, GREETING))
                if (s.msgs.isEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        CHIPS.forEach { c ->
                            Surface(
                                shape = RoundedCornerShape(50), color = cs.surface, border = BorderStroke(1.dp, cs.outlineVariant),
                                modifier = Modifier.clip(RoundedCornerShape(50)).clickable(enabled = !s.busy && s.remaining > 0) { vm.sendSupport(c) },
                            ) {
                                Text(c, style = MaterialTheme.typography.labelLarge, color = cs.primary, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp))
                            }
                        }
                    }
                }
            }
        }
        itemsIndexed(s.msgs) { _, m -> SupportBubble(m) }
        if (s.busy) item(key = "typing") { SupportTyping() }
        s.error?.let { e ->
            item(key = "error") {
                Surface(shape = RoundedCornerShape(14.dp), color = cs.errorContainer, modifier = Modifier.fillMaxWidth()) {
                    Text(e, color = cs.onErrorContainer, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center, modifier = Modifier.padding(10.dp))
                }
            }
        }
    }
}

@Composable
private fun SupportBubble(m: SupportMsg) {
    val cs = MaterialTheme.colorScheme
    val mine = m.mine
    // مثل سایت: پیام کاربر سمت شروع (راست)، پاسخ دستیار سمت پایان (چپ)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.Start else Arrangement.End) {
        val shape = RoundedCornerShape(16.dp, 16.dp, if (mine) 4.dp else 16.dp, if (mine) 16.dp else 4.dp)
        val mod = Modifier.widthIn(max = 320.dp).clip(shape).let {
            if (mine) it.background(LocalExtra.current.brand) else it.background(cs.surface)
        }
        Column(mod.padding(horizontal = 13.dp, vertical = 9.dp)) {
            if (m.human) Text("👨‍💼 پشتیبان انسانی", style = MaterialTheme.typography.labelMedium, color = LocalExtra.current.success, modifier = Modifier.padding(bottom = 4.dp))
            SelectionContainer {
                Text(
                    if (mine) androidx.compose.ui.text.AnnotatedString(m.text) else linkified(m.text, cs.primary),
                    style = MaterialTheme.typography.bodyMedium.copy(lineHeight = MaterialTheme.typography.bodyMedium.fontSize * 1.8f),
                    color = if (mine) Color.White else cs.onSurface,
                )
            }
            if (m.referred) {
                HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(top = 8.dp, bottom = 6.dp))
                Text("✅ ارجاع شد؛ تیم پشتیبانی بررسی می‌کند", style = MaterialTheme.typography.labelMedium, color = LocalExtra.current.success)
            }
        }
    }
}

@Composable
private fun SupportTyping() {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Row(
            Modifier.clip(RoundedCornerShape(16.dp, 16.dp, 16.dp, 4.dp)).background(cs.surface).padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(3) { Box(Modifier.size(6.dp).clip(CircleShape).background(cs.onSurfaceVariant.copy(alpha = 0.5f))) }
        }
    }
}

@Composable
private fun SupportInput(vm: AppViewModel) {
    val s = vm.support
    val cs = MaterialTheme.colorScheme
    val out = s.remaining <= 0
    Column(Modifier.fillMaxWidth().background(cs.surface)) {
        HorizontalDivider(color = cs.outlineVariant)
        Row(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = s.draft,
                onValueChange = { if (it.length <= SUPPORT_MAX_TEXT) s.draft = it },
                modifier = Modifier.weight(1f),
                enabled = !out && s.loaded,
                maxLines = 4,
                shape = RoundedCornerShape(16.dp),
                placeholder = { Text(if (out) "سقف پیام امروز تمام شد؛ فردا دوباره بپرس" else "پیامت را بنویس…", style = MaterialTheme.typography.bodyMedium) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { vm.sendSupport(s.draft) }),
            )
            val canSend = s.draft.isNotBlank() && !s.busy && !out && s.loaded
            IconButton(
                onClick = { vm.sendSupport(s.draft) }, enabled = canSend,
                modifier = Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(if (canSend) cs.primary else cs.onSurface.copy(alpha = 0.12f)),
            ) {
                // آیکن ارسال به راست اشاره می‌کند؛ در صفحه‌ی راست‌به‌چپ برعکس می‌شود
                AppIcon(AppIcons.Send, tint = if (canSend) cs.onPrimary else cs.onSurface.copy(alpha = 0.38f), description = "ارسال", modifier = Modifier.graphicsLayer { scaleX = -1f })
            }
        }
        if (out) Text(
            "سهمیه‌ی پیام امروز تمام شد (از نیمه‌شب به وقت ایران دوباره پر می‌شود).",
            style = MaterialTheme.typography.labelSmall, color = cs.onSurfaceVariant,
            modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 8.dp),
        )
    }
}
