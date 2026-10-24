@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package ir.pptsaz.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Snackbar

// ================================================================== ریشه

@Composable
fun Root(st: UiState, vm: AppViewModel, snack: SnackbarHostState) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize()) {
            Crossfade(targetState = st.screen, animationSpec = tween(250), label = "root") { s ->
                when (s) {
                    Screen.Loading -> LoadingScreen()
                    Screen.Error -> ErrorScreen(st, vm)
                    Screen.Login -> LoginScreen(st, vm)
                    Screen.Main -> MainScreen(st, vm)
                }
            }
            SnackbarHost(
                hostState = snack,
                modifier = Modifier.align(Alignment.BottomCenter)
                    .padding(bottom = if (st.screen == Screen.Main) 84.dp else 0.dp)
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .imePadding(),
            ) { data -> Snackbar(data, modifier = Modifier.padding(12.dp), shape = RoundedCornerShape(16.dp)) }
        }
    }
}

@Composable
private fun LogoBadge(size: Int = 88) {
    Box(
        Modifier.size(size.dp).clip(RoundedCornerShape((size * 0.3f).dp)).background(LocalExtra.current.brand),
        contentAlignment = Alignment.Center,
    ) { AppIcon(AppIcons.Slides, tint = Color.White, size = (size * 0.52f).dp) }
}

@Composable
private fun LoadingScreen() {
    val t = rememberInfiniteTransition(label = "pulse")
    val a by t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse), label = "a")
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.alpha(a)) { LogoBadge(96) }
        Spacer(Modifier.height(20.dp))
        Text("پاورپوینت‌ساز", style = MaterialTheme.typography.titleLarge)
        Text("در حال آماده‌سازی…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ErrorScreen(st: UiState, vm: AppViewModel) {
    Column(
        Modifier.fillMaxSize().systemBarsPadding().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(88.dp).clip(CircleShape).background(MaterialTheme.colorScheme.errorContainer), contentAlignment = Alignment.Center) {
            AppIcon(AppIcons.Warning, tint = MaterialTheme.colorScheme.error, size = 40.dp)
        }
        Spacer(Modifier.height(20.dp))
        Text("اتصال برقرار نشد", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(6.dp))
        Text(
            st.error ?: "اینترنت خود را بررسی کنید.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        GradientButton("تلاش دوباره", { vm.refresh() }, Modifier.fillMaxWidth(), icon = AppIcons.Refresh)
    }
}

// ================================================================== ورود

@Composable
fun LoginScreen(st: UiState, vm: AppViewModel) {
    var mobile by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    val otpOn = st.config?.otp != false
    val cs = MaterialTheme.colorScheme
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding()) {
        // بخش بالایی با گرادیان برند
        Box(
            Modifier.fillMaxWidth()
                .background(LocalExtra.current.brand, RoundedCornerShape(bottomStart = 40.dp, bottomEnd = 40.dp))
                .clip(RoundedCornerShape(bottomStart = 40.dp, bottomEnd = 40.dp)),
        ) {
            Box(Modifier.align(Alignment.TopStart).offset(x = (-50).dp, y = (-30).dp).size(190.dp).background(Color.White.copy(alpha = 0.08f), CircleShape))
            Box(Modifier.align(Alignment.BottomEnd).offset(x = 40.dp, y = 40.dp).size(150.dp).background(Color.White.copy(alpha = 0.08f), CircleShape))
            Column(
                Modifier.fillMaxWidth().statusBarsPadding().padding(start = 28.dp, end = 28.dp, top = 36.dp, bottom = 56.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.size(76.dp).clip(RoundedCornerShape(24.dp)).background(Color.White), contentAlignment = Alignment.Center) {
                    AppIcon(AppIcons.Slides, tint = Color(0xFF2563EB), size = 40.dp)
                }
                Spacer(Modifier.height(18.dp))
                Text("پاورپوینت‌ساز", style = MaterialTheme.typography.headlineMedium, color = Color.White)
                Spacer(Modifier.height(6.dp))
                Text(
                    "ارائه‌ی حرفه‌ای با هوش مصنوعی، در چند دقیقه",
                    style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.88f), textAlign = TextAlign.Center,
                )
            }
        }

        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 28.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (!otpOn) {
                SurfaceCard(color = cs.errorContainer, borderColor = null) {
                    Text(
                        "ورود با پیامک فعلاً در دسترس نیست. لطفاً از سایت pptsaz.ir استفاده کنید.",
                        color = cs.onErrorContainer, modifier = Modifier.padding(16.dp),
                    )
                }
            } else {
                val fieldStyle: TextStyle = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center, textDirection = TextDirection.Ltr)
                AnimatedContent(targetState = st.otpSent, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(120)) }, label = "otp") { sent ->
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        if (!sent) {
                            Text("ورود یا ثبت‌نام", style = MaterialTheme.typography.titleLarge)
                            Text("شماره‌ی موبایل خود را وارد کنید تا کد تأیید برایتان پیامک شود.", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                            OutlinedTextField(
                                value = mobile,
                                onValueChange = { mobile = it.filter { c -> c.isDigit() }.take(11) },
                                placeholder = { Text("09123456789", Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                                textStyle = fieldStyle,
                                singleLine = true,
                                enabled = !st.busy,
                                shape = RoundedCornerShape(18.dp),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            GradientButton("ارسال کد تأیید", { vm.sendOtp(mobile) }, Modifier.fillMaxWidth(), enabled = mobile.length >= 10, loading = st.busy)
                        } else {
                            Text("کد تأیید را وارد کنید", style = MaterialTheme.typography.titleLarge)
                            Text("کد به شماره‌ی " + mobile.faStr() + " ارسال شد.", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                            OutlinedTextField(
                                value = code,
                                onValueChange = { code = it.filter { c -> c.isDigit() }.take(8) },
                                placeholder = { Text("• • • • • •", Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                                textStyle = fieldStyle.copy(letterSpacing = 8.sp),
                                singleLine = true,
                                shape = RoundedCornerShape(18.dp),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            GradientButton("ورود", { vm.verifyOtp(mobile, code) }, Modifier.fillMaxWidth(), enabled = code.length >= 4, loading = st.busy)
                            TextButton(onClick = { vm.editMobile() }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                                AppIcon(AppIcons.Edit, size = 18.dp)
                                Spacer(Modifier.width(6.dp))
                                Text("ویرایش شماره")
                            }
                        }
                    }
                }
            }
        }
    }
}

// ================================================================== قاب اصلی

/** وضعیت فرم «ساخت»؛ بالاتر از تب‌ها نگه داشته می‌شود تا با عوض‌کردن تب پاک نشود. */
@Stable
class CreateForm(topic: String = "", source: String = "", handout: Boolean = true, poster: String = "wide") {
    var topic by mutableStateOf(topic)
    var source by mutableStateOf(source)
    var handout by mutableStateOf(handout)
    var poster by mutableStateOf(poster)

    companion object {
        val Saver = listSaver<CreateForm, Any>(
            save = { listOf(it.topic, it.source, it.handout, it.poster) },
            restore = { CreateForm(it[0] as String, it[1] as String, it[2] as Boolean, it[3] as String) },
        )
    }
}

private data class NavItem(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val NAV = listOf(
    NavItem("ساخت", AppIcons.Sparkles),
    NavItem("فایل‌ها", AppIcons.Folder),
    NavItem("تنظیمات", AppIcons.Tune),
    NavItem("حساب", AppIcons.Person),
)

@Composable
fun MainScreen(st: UiState, vm: AppViewModel) {
    val me = st.me ?: return
    val form = rememberSaveable(saver = CreateForm.Saver) { CreateForm() }
    val cs = MaterialTheme.colorScheme
    Scaffold(
        containerColor = cs.background,
        bottomBar = {
            Column {
                HorizontalDivider(color = cs.outlineVariant)
                NavigationBar(containerColor = cs.surface, tonalElevation = 0.dp) {
                    NAV.forEachIndexed { i, item ->
                        NavigationBarItem(
                            selected = st.tab == i,
                            onClick = { vm.setTab(i) },
                            icon = { AppIcon(item.icon, size = 24.dp) },
                            label = { Text(item.label, style = MaterialTheme.typography.labelMedium) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = cs.onPrimaryContainer,
                                selectedTextColor = cs.primary,
                                indicatorColor = cs.primaryContainer,
                                unselectedIconColor = cs.onSurfaceVariant,
                                unselectedTextColor = cs.onSurfaceVariant,
                            ),
                        )
                    }
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            AnimatedContent(
                targetState = st.tab,
                transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(120)) },
                label = "tabs",
            ) { tab ->
                when (tab) {
                    0 -> CreateTab(st, me, vm, form)
                    1 -> FilesTab(st, vm)
                    2 -> SettingsTab(st, me, vm)
                    else -> AccountTab(st, me, vm)
                }
            }
        }
    }
    when (val v = st.viewer) {
        is Viewer.Poster -> PosterDialog(v.id, vm)
        is Viewer.Preview -> PreviewDialog(v.id, vm)
        null -> {}
    }
}

// ================================================================== ساخت

private val SUGGESTIONS = listOf(
    "تأثیر هوش مصنوعی بر آموزش",
    "اصول مدیریت زمان",
    "برنامه‌ی بازاریابی دیجیتال",
    "تغییرات اقلیمی و راهکارها",
    "معرفی یک استارتاپ",
)

@Composable
fun CreateTab(st: UiState, me: Me, vm: AppViewModel, form: CreateForm) {
    val cfg = st.config ?: return
    val cs = MaterialTheme.colorScheme
    var link by rememberSaveable { mutableStateOf("") }
    var sourceOpen by rememberSaveable { mutableStateOf(form.source.isNotBlank()) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.importFile(uri)
    }
    LaunchedEffect(st.extractedText) {
        val t = st.extractedText
        if (t != null) {
            form.source = if (form.source.isBlank()) t else form.source.trimEnd() + "\n\n" + t
            sourceOpen = true
            vm.consumeExtracted()
        }
    }
    val job = st.job
    val running = job != null && !job.done && !job.failed
    val s = me.settings
    val firstName = me.name.trim().split(" ").firstOrNull().orEmpty()

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 112.dp)) {
            ScreenHeader(
                title = if (firstName.isBlank()) "سلام 👋" else "سلام $firstName 👋",
                subtitle = "امروز چه ارائه‌ای بسازیم؟",
                trailing = { CreditPill(me) { vm.setTab(3) } },
            )
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (job != null) JobCard(job, vm)

                // موضوع
                SurfaceCard {
                    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            IconTile(AppIcons.Sparkles, LocalExtra.current.brand, 36.dp)
                            Text("موضوع ارائه", style = MaterialTheme.typography.titleMedium)
                        }
                        TextField(
                            value = form.topic,
                            onValueChange = { form.topic = it },
                            placeholder = { Text("مثلاً: تأثیر هوش مصنوعی بر آموزش") },
                            minLines = 3, maxLines = 6,
                            enabled = !running,
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                                disabledContainerColor = Color.Transparent,
                                focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                                disabledIndicatorColor = Color.Transparent,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        AnimatedVisibility(form.topic.isBlank() && !running, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("پیشنهادها", style = MaterialTheme.typography.labelMedium, color = cs.onSurfaceVariant)
                                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    items(SUGGESTIONS) { t -> SelectChip(t, false, { form.topic = t }) }
                                }
                            }
                        }
                    }
                }

                // منبع
                SurfaceCard(modifier = Modifier.animateContentSize()) {
                    Row(
                        Modifier.fillMaxWidth().clickable { sourceOpen = !sourceOpen }.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(Modifier.size(36.dp).clip(RoundedCornerShape(12.dp)).background(cs.secondaryContainer), contentAlignment = Alignment.Center) {
                            AppIcon(AppIcons.Attach, tint = cs.onSecondaryContainer, size = 20.dp)
                        }
                        Column(Modifier.weight(1f)) {
                            Text("منبع (اختیاری)", style = MaterialTheme.typography.titleSmall)
                            Text("ارائه را بر پایه‌ی متن، PDF، عکس یا لینک بسازید", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                        }
                        AppIcon(AppIcons.ChevronDown, tint = cs.onSurfaceVariant, modifier = Modifier.rotate(if (sourceOpen) 180f else 0f))
                    }
                    AnimatedVisibility(sourceOpen) {
                        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedTextField(
                                value = form.source, onValueChange = { form.source = it },
                                placeholder = { Text("متن یا یادداشت‌هایی که می‌خواهید ارائه بر پایه‌ی آن‌ها ساخته شود") },
                                minLines = 3, maxLines = 8, enabled = !running, shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            SoftButton(
                                "افزودن از PDF یا عکس", { picker.launch(arrayOf("application/pdf", "image/png", "image/jpeg")) },
                                Modifier.fillMaxWidth(), enabled = !running && st.extractBusy == null, icon = AppIcons.Attach,
                            )
                            if (cfg.link) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedTextField(
                                        value = link, onValueChange = { link = it },
                                        placeholder = { Text("آدرس یک صفحه‌ی وب") },
                                        textStyle = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Ltr),
                                        singleLine = true, shape = RoundedCornerShape(16.dp),
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                                        modifier = Modifier.weight(1f),
                                    )
                                    SoftButton(
                                        "افزودن", { vm.importLink(link); link = "" },
                                        enabled = link.isNotBlank() && st.extractBusy == null && !running, icon = AppIcons.Link,
                                    )
                                }
                            }
                            if (st.extractBusy != null) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                                    Text(st.extractBusy, color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                }

                // تنظیمات سریع
                SurfaceCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (cfg.models.isNotEmpty()) {
                            val canExtra = me.unlimited || me.planId != null
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("مدل هوش مصنوعی", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                val cur = cfg.models.firstOrNull { it.id == s.model }
                                if (cur != null && cur.brand.isNotBlank()) Text(cur.brand, style = MaterialTheme.typography.labelMedium, color = cs.onSurfaceVariant)
                            }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                cfg.models.forEach { m ->
                                    SelectChip(m.name, s.model == m.id, { vm.setSetting("model", m.id) }, locked = !m.free && !canExtra)
                                }
                            }
                            if (!canExtra && cfg.models.any { !it.free }) {
                                Text("مدل‌های قفل‌دار فقط با اشتراک فعال قابل استفاده‌اند.", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                            }
                            HorizontalDivider(color = cs.outlineVariant)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("تعداد اسلاید", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            Text(s.slides.fa(), style = MaterialTheme.typography.titleSmall, color = cs.primary)
                        }
                        Segmented(
                            options = cfg.slideChoices, selected = s.slides, label = { it.fa() },
                            locked = { it > me.maxSlides },
                            onSelect = { n ->
                                if (n > me.maxSlides) vm.toast("برای بیش از " + me.maxSlides.fa() + " اسلاید به اشتراک نیاز دارید")
                                else vm.setSetting("slides", n)
                            },
                        )
                        Spacer(Modifier.height(2.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("تعداد تصویر", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            Text(if (s.imageCount == 0) "بدون تصویر" else s.imageCount.fa(), style = MaterialTheme.typography.titleSmall, color = cs.primary)
                        }
                        Segmented(
                            options = (0..6).toList(), selected = s.imageCount, label = { it.fa() },
                            locked = { it > me.maxImages },
                            onSelect = { n ->
                                if (n > me.maxImages) vm.toast("ساخت " + n.fa() + " تصویر در هر ارائه فقط با پلن‌های پولی ممکن است")
                                else vm.setSetting("imageCount", n)
                            },
                        )
                    }
                }

                // خلاصه‌ی ظاهر
                val tplName = cfg.templates.firstOrNull { it.key == s.template }?.name.orEmpty()
                val theme = cfg.themes.firstOrNull { it.key == s.theme }
                SurfaceCard(onClick = { vm.setTab(2) }) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(36.dp).clip(CircleShape).background(hexColor(theme?.color)))
                        Column(Modifier.weight(1f)) {
                            Text("ظاهر ارائه", style = MaterialTheme.typography.titleSmall)
                            Text(
                                listOf(tplName, theme?.name.orEmpty(), s.font).filter { it.isNotBlank() }.joinToString(" • "),
                                style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Text("تغییر", style = MaterialTheme.typography.labelLarge, color = cs.primary)
                        AppIcon(AppIcons.ChevronLeft, tint = cs.onSurfaceVariant, size = 20.dp)
                    }
                }

                // خروجی‌های اضافه
                SurfaceCard {
                    ToggleRow(
                        title = "جزوه‌ی Word", subtitle = "همراه ارائه ساخته می‌شود", icon = AppIcons.Doc,
                        checked = form.handout, onChange = { form.handout = it },
                    )
                    if (cfg.poster) {
                        HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(horizontal = 16.dp))
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("پوستر (تصویر خلاصه‌ی ارائه)", style = MaterialTheme.typography.titleSmall)
                            Segmented(
                                options = listOf("", "wide", "tall"), selected = form.poster,
                                label = { when (it) { "wide" -> "افقی"; "tall" -> "عمودی"; else -> "بدون پوستر" } },
                                onSelect = { form.poster = it },
                            )
                        }
                    }
                }
            }
        }

        // دکمه‌ی ثابت پایین
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(Brush.verticalGradient(listOf(cs.background.copy(alpha = 0f), cs.background)))
                .padding(start = 20.dp, end = 20.dp, top = 28.dp, bottom = 12.dp),
        ) {
            GradientButton(
                text = if (running) "در حال ساخت…" else "ساخت ارائه",
                onClick = { vm.generate(form.topic, s.slides, form.handout, form.source, (if (cfg.poster) form.poster.ifEmpty { null } else null), s.imageCount) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !running && !st.busy,
                icon = AppIcons.Sparkles,
            )
        }
    }
}

@Composable
private fun CreditPill(me: Me, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.clip(CircleShape).background(cs.primaryContainer).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        AppIcon(AppIcons.Sparkles, tint = cs.primary, size = 16.dp)
        Text(if (me.unlimited) "نامحدود" else me.credits.fa(), style = MaterialTheme.typography.labelLarge, color = cs.onPrimaryContainer)
    }
}

@Composable
private fun JobCard(job: JobState, vm: AppViewModel) {
    val cs = MaterialTheme.colorScheme
    val ex = LocalExtra.current
    when {
        job.failed -> SurfaceCard(color = cs.errorContainer, borderColor = null) {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AppIcon(AppIcons.Warning, tint = cs.error)
                Text(job.message, color = cs.onErrorContainer, modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.dismissJob() }) { AppIcon(AppIcons.Close, tint = cs.onErrorContainer, size = 20.dp) }
            }
        }
        job.done -> SurfaceCard {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(ex.successBg), contentAlignment = Alignment.Center) {
                        AppIcon(AppIcons.Check, tint = ex.success, size = 22.dp)
                    }
                    Column(Modifier.weight(1f)) {
                        Text("ارائه آماده شد", style = MaterialTheme.typography.labelMedium, color = ex.success)
                        Text(job.title.ifEmpty { "ارائه‌ی شما" }, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = { vm.dismissJob() }) { AppIcon(AppIcons.Close, tint = cs.onSurfaceVariant, size = 20.dp) }
                }
                GradientButton("دانلود ارائه (PPTX)", { vm.download(job.id) }, Modifier.fillMaxWidth(), icon = AppIcons.Download)
                SoftButton("پیش‌نمایش اسلایدها", { vm.openViewer(Viewer.Preview(job.id)) }, Modifier.fillMaxWidth(), icon = AppIcons.Eye)
                job.handoutId?.let { hid -> SoftButton("دانلود جزوه (Word)", { vm.download(hid) }, Modifier.fillMaxWidth(), icon = AppIcons.Doc) }
                job.posterId?.let { pid -> SoftButton("نمایش پوستر", { vm.openViewer(Viewer.Poster(pid)) }, Modifier.fillMaxWidth(), icon = AppIcons.Image) }
                if (job.posterFailed) Text("ساخت پوستر ناموفق بود؛ ارائه‌ی شما سالم است.", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
        else -> Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(ex.brand).padding(18.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("در حال ساخت ارائه…", style = MaterialTheme.typography.titleMedium, color = Color.White)
                LinearProgressIndicator(Modifier.fillMaxWidth().clip(CircleShape), color = Color.White, trackColor = Color.White.copy(alpha = 0.3f))
                Text(job.message, color = Color.White.copy(alpha = 0.95f), style = MaterialTheme.typography.bodyMedium)
                Text("می‌توانید از اپ خارج شوید؛ ساخت ادامه پیدا می‌کند.", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

// ================================================================== فایل‌ها

private fun fmtDate(t: Long): String = try {
    val ms = if (t in 1..9_999_999_999L) t * 1000 else t
    val f = android.icu.text.DateFormat.getDateInstance(
        android.icu.text.DateFormat.MEDIUM,
        android.icu.util.ULocale("fa_IR@calendar=persian"),
    )
    f.format(java.util.Date(ms))
} catch (e: Exception) {
    ""
}

@Composable
fun FilesTab(st: UiState, vm: AppViewModel) {
    val cs = MaterialTheme.colorScheme
    Column(Modifier.fillMaxSize()) {
        ScreenHeader(
            title = "فایل‌های من", subtitle = "ارائه‌های ۲۴ ساعت اخیر",
            trailing = {
                IconButton(onClick = { vm.loadFiles() }, enabled = !st.filesLoading) {
                    if (st.filesLoading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else AppIcon(AppIcons.Refresh, tint = cs.onSurfaceVariant)
                }
            },
        )
        when {
            st.filesLoading && st.files.isEmpty() ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            st.files.isEmpty() ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(
                        AppIcons.Folder, "هنوز فایلی نساخته‌اید",
                        "ارائه‌هایی که می‌سازید تا ۲۴ ساعت اینجا می‌مانند و می‌توانید دانلودشان کنید.",
                        "ساخت اولین ارائه", { vm.setTab(0) },
                    )
                }
            else -> LazyColumn(
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize(),
            ) {
                items(st.files) { f -> FileRow(f, vm) }
            }
        }
    }
}

@Composable
private fun FileRow(f: FileItem, vm: AppViewModel) {
    val cs = MaterialTheme.colorScheme
    val (icon, brush) = when {
        f.poster -> AppIcons.Image to Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFFEC4899)))
        f.handout -> AppIcons.Doc to Brush.linearGradient(listOf(Color(0xFFF59E0B), Color(0xFFF97316)))
        else -> AppIcons.Slides to LocalExtra.current.brand
    }
    val kind = when {
        f.poster -> "پوستر"
        f.handout -> "جزوه‌ی Word"
        else -> f.slides.fa() + " اسلاید"
    }
    SurfaceCard {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconTile(icon, brush, 46.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(f.title.ifBlank { "بدون عنوان" }, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOf(kind, fmtDate(f.t)).filter { it.isNotEmpty() }.joinToString(" • "),
                    style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                )
            }
            if (f.poster) {
                IconButton(onClick = { vm.openViewer(Viewer.Poster(f.id)) }) { AppIcon(AppIcons.Eye, tint = cs.onSurfaceVariant) }
            } else if (!f.handout) {
                IconButton(onClick = { vm.openViewer(Viewer.Preview(f.id)) }) { AppIcon(AppIcons.Eye, tint = cs.onSurfaceVariant) }
            }
            FilledTonalIconButton(onClick = { vm.download(f.id) }) { AppIcon(AppIcons.Download, size = 22.dp) }
        }
    }
}

// ================================================================== تنظیمات

private val MODES = listOf(
    Triple("normal", "عادی", "ساختار آزاد، متناسب با موضوع"),
    Triple("student", "دانشجویی", "فهرست، مقدمه، بدنه، نتیجه‌گیری و منابع (حداقل ۸ اسلاید)"),
    Triple("business", "کسب‌وکار", "خلاصه‌ی مدیریتی، مسئله و راه‌حل، جدول و نمودار، برنامه‌ی اجرا و گام‌های بعدی (حداقل ۸ اسلاید)"),
    Triple("teacher", "معلم", "اهداف درس، پرسش آغازین، محتوا، فعالیت کلاسی، جمع‌بندی و پرسش‌های مرور (حداقل ۸ اسلاید)"),
    Triple("thesis", "دفاع پایان‌نامه", "مسئله، اهداف، پیشینه، روش، یافته‌ها، نتیجه‌گیری، پیشنهادها و منابع (حداقل ۱۰ اسلاید)"),
)

@Composable
fun SettingsTab(st: UiState, me: Me, vm: AppViewModel) {
    val cfg = st.config ?: return
    val s = me.settings
    val cs = MaterialTheme.colorScheme
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenHeader("تنظیمات", "ظاهر و محتوای ارائه‌هایتان")
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {

            SectionTitle("قالب")
            cfg.templates.forEach { t ->
                OptionCard(t.name, t.hint.ifBlank { null }, s.template == t.key, { vm.setSetting("template", t.key) })
            }

            SectionTitle("تم رنگی", Modifier.padding(top = 8.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(cfg.themes) { o -> ThemeSwatch(o, s.theme == o.key) { vm.setSetting("theme", o.key) } }
            }

            SectionTitle("فونت", Modifier.padding(top = 8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                cfg.fonts.forEach { f -> SelectChip(f, s.font == f, { vm.setSetting("font", f) }) }
            }
            Text("فونت Vazirmatn باید روی دستگاه نمایش‌دهنده نصب باشد؛ Tahoma و Arial همه‌جا کار می‌کنند.", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)

            SectionTitle("لحن", Modifier.padding(top = 8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                cfg.tones.forEach { o -> SelectChip(o.name, s.tone == o.key, { vm.setSetting("tone", o.key) }) }
            }

            SectionTitle("حالت ساخت", Modifier.padding(top = 8.dp))
            MODES.forEach { (key, name, desc) ->
                OptionCard(name, desc, s.mode == key, { vm.setSetting("mode", key) })
            }

            SectionTitle("گزینه‌ها", Modifier.padding(top = 8.dp))
            SurfaceCard {
                ToggleRow("ارقام فارسی", "نمایش اعداد به‌صورت ۱۲۳", null, s.digits) { vm.setSetting("digits", it) }
                HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(horizontal = 16.dp))
                ToggleRow("اسلاید منابع", "فهرست منابع در پایان ارائه", null, s.sources) { vm.setSetting("sources", it) }
                HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(horizontal = 16.dp))
                ToggleRow("اسلاید پرسش‌های پایانی", "پرسش و پاسخ برای جمع‌بندی", null, s.questions) { vm.setSetting("questions", it) }
            }

        }
    }
}

@Composable
private fun ThemeSwatch(o: Opt, selected: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Column(
        Modifier.width(68.dp).clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(
            Modifier.size(50.dp).clip(CircleShape).border(2.5.dp, if (selected) cs.primary else Color.Transparent, CircleShape).padding(4.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.fillMaxSize().clip(CircleShape).background(hexColor(o.color)), contentAlignment = Alignment.Center) {
                if (selected) AppIcon(AppIcons.Check, tint = Color.White, size = 18.dp)
            }
        }
        Text(o.name, style = MaterialTheme.typography.labelSmall, color = if (selected) cs.primary else cs.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ================================================================== حساب

@Composable
fun AccountTab(st: UiState, me: Me, vm: AppViewModel) {
    val cfg = st.config
    val cs = MaterialTheme.colorScheme
    val ex = LocalExtra.current
    var nameDialog by rememberSaveable { mutableStateOf(false) }
    if (nameDialog) NameDialog(me.name, vm) { nameDialog = false }
    val planName = me.planId?.let { id -> me.plans.firstOrNull { it.id == id }?.name ?: id }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenHeader("حساب من")
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // کارت پروفایل
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(ex.brand)) {
                Box(Modifier.align(Alignment.TopStart).offset(x = (-40).dp, y = (-40).dp).size(150.dp).background(Color.White.copy(alpha = 0.08f), CircleShape))
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Box(Modifier.size(56.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.22f)), contentAlignment = Alignment.Center) {
                            val initial = me.name.trim().firstOrNull()?.toString()
                            if (initial != null) Text(initial, style = MaterialTheme.typography.titleLarge, color = Color.White)
                            else AppIcon(AppIcons.Person, tint = Color.White, size = 28.dp)
                        }
                        Column(Modifier.weight(1f)) {
                            Text(me.name.ifBlank { "کاربر" }, style = MaterialTheme.typography.titleLarge, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            val sub = me.mobile.ifEmpty { me.email }
                            if (sub.isNotEmpty()) Text(sub.faStr(), style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.85f), maxLines = 1)
                        }
                        IconButton(onClick = { nameDialog = true }) { AppIcon(AppIcons.Edit, tint = Color.White, size = 22.dp) }
                    }
                    if (me.unlimited) {
                        StatBox("اعتبار", "نامحدود", Modifier.fillMaxWidth())
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatBox("اعتبار کل", me.credits.fa(), Modifier.weight(1f))
                            StatBox("از پلن", me.planCredits.fa(), Modifier.weight(1f))
                            StatBox("هدیه", me.bonus.fa(), Modifier.weight(1f))
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        AppIcon(AppIcons.Star, tint = Color.White, size = 18.dp)
                        Text(
                            if (planName != null) "پلن $planName" + (if (me.planExp > 0) " تا " + fmtDate(me.planExp) else "") else "پلن رایگان",
                            color = Color.White, style = MaterialTheme.typography.labelLarge,
                        )
                    }
                }
            }

            if (cfg != null && cfg.dailyFree > 0 && !me.unlimited) {
                SurfaceCard(color = ex.warnBg, borderColor = null) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("🎁", fontSize = 22.sp)
                        Text("هر روز " + cfg.dailyFree.fa() + " اعتبار رایگان هدیه می‌گیرید.", color = ex.warn, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            if (me.plans.isNotEmpty()) {
                SectionTitle("اشتراک‌ها", Modifier.padding(top = 4.dp))
                me.plans.forEach { p ->
                    val active = me.planId == p.id
                    SurfaceCard(borderColor = if (active) cs.primary else cs.outlineVariant) {
                        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(p.name, style = MaterialTheme.typography.titleMedium)
                                    if (active) Pill("فعال", ex.successBg, ex.success)
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(p.price.fa(), style = MaterialTheme.typography.headlineSmall, color = cs.primary)
                                    Text("هزار تومان", style = MaterialTheme.typography.labelMedium, color = cs.onSurfaceVariant)
                                }
                            }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf(
                                    p.credits.fa() + " اعتبار", "تا " + p.maxSlides.fa() + " اسلاید",
                                    "تا " + p.maxImages.fa() + " تصویر", p.days.fa() + " روز",
                                ).forEach { feat ->
                                    Row(
                                        Modifier.clip(RoundedCornerShape(10.dp)).background(cs.surfaceVariant).padding(horizontal = 10.dp, vertical = 6.dp),
                                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        AppIcon(AppIcons.Check, tint = ex.success, size = 14.dp)
                                        Text(feat, style = MaterialTheme.typography.labelMedium, color = cs.onSurface)
                                    }
                                }
                            }
                            GradientButton(
                                if (active) "تمدید اشتراک" else "خرید اشتراک",
                                {
                                    when {
                                        cfg?.payEnabled == true -> vm.buy(p.id)
                                        p.url.isNotEmpty() -> vm.openUrl(p.url)
                                        else -> vm.openSite()
                                    }
                                },
                                Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
                Text(
                    if (cfg?.payEnabled == true) "پرداخت در مرورگر انجام می‌شود و بعد از آن به اپ برمی‌گردید."
                    else "پرداخت از طریق ربات تلگرام انجام می‌شود.",
                    style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp),
                )
            }

            ContactCard(vm)

            SoftButton("خروج از حساب", { vm.logout() }, Modifier.fillMaxWidth(), icon = AppIcons.Logout)
            Text(
                "پاورپوینت‌ساز • نسخه‌ی " + BuildConfig.VERSION_NAME.faStr(),
                style = MaterialTheme.typography.labelSmall, color = cs.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun StatBox(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier.clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.16f)).padding(vertical = 12.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(value, style = MaterialTheme.typography.titleLarge, color = Color.White, maxLines = 1)
        Text(label, style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.85f), maxLines = 1)
    }
}

@Composable
private fun ContactCard(vm: AppViewModel) {
    val ctx = LocalContext.current
    val cs = MaterialTheme.colorScheme
    val mail = {
        try {
            ctx.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:info@pptsaz.ir")))
        } catch (e: Exception) {
            vm.toast("برنامه‌ی ایمیل پیدا نشد")
        }
    }
    SectionTitle("تماس با ما", Modifier.padding(top = 4.dp))
    SurfaceCard {
        ContactRow(AppIcons.Globe, Brush.linearGradient(listOf(Color(0xFF2563EB), Color(0xFF06B6D4))), "وب‌سایت", "pptsaz.ir") { vm.openSite() }
        HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(horizontal = 16.dp))
        ContactRow(AppIcons.Send, Brush.linearGradient(listOf(Color(0xFF29B6F6), Color(0xFF0288D1))), "ربات تلگرام", "@pptsaz_bot") { vm.openUrl("https://t.me/pptsaz_bot") }
        HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(horizontal = 16.dp))
        ContactRow(AppIcons.Mail, Brush.linearGradient(listOf(Color(0xFFF59E0B), Color(0xFFF97316))), "پشتیبانی (ایمیل)", "info@pptsaz.ir") { mail() }
    }
}

@Composable
private fun ContactRow(icon: ImageVector, brush: Brush, title: String, value: String, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconTile(icon, brush, 40.dp)
        Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Ltr), color = cs.primary, maxLines = 1)
        AppIcon(AppIcons.ChevronLeft, tint = cs.onSurfaceVariant, size = 20.dp)
    }
}

// ================================================================== دیالوگ‌ها

@Composable
fun NameDialog(current: String, vm: AppViewModel, onClose: () -> Unit) {
    var name by remember { mutableStateOf(current) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onClose,
        shape = RoundedCornerShape(28.dp),
        title = { Text("ویرایش نام") },
        text = {
            OutlinedTextField(
                value = name, onValueChange = { name = it.take(64) }, singleLine = true,
                shape = RoundedCornerShape(16.dp), placeholder = { Text("نام شما") },
            )
        },
        confirmButton = {
            GradientButton(
                "ذخیره",
                {
                    busy = true
                    vm.updateName(name) { ok ->
                        busy = false
                        if (ok) onClose()
                    }
                },
                Modifier.width(120.dp).height(48.dp), enabled = name.trim().length >= 2, loading = busy,
            )
        },
        dismissButton = { TextButton(onClick = onClose) { Text("انصراف") } },
    )
}

@Composable
fun PosterDialog(id: String, vm: AppViewModel) {
    val loaded by produceState(initialValue = Pair<ImageBitmap?, Boolean>(null, false), id) {
        value = try {
            Pair(Api.fetchImage(id).asImageBitmap(), true)
        } catch (e: Exception) {
            Pair(null, true)
        }
    }
    val img = loaded.first
    Dialog(onDismissRequest = { vm.closeViewer() }) {
        Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                when {
                    !loaded.second -> Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    img == null -> Text("نمایش پوستر ممکن نشد. می‌توانید آن را دانلود کنید.", textAlign = TextAlign.Center)
                    else -> Image(
                        bitmap = img, contentDescription = "پوستر", contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 460.dp).clip(RoundedCornerShape(18.dp)),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    GradientButton("دانلود", { vm.download(id) }, Modifier.width(160.dp).height(48.dp), icon = AppIcons.Download)
                    TextButton(onClick = { vm.closeViewer() }) { Text("بستن") }
                }
            }
        }
    }
}

/** پیش‌نمایش اسلایدها را خود سرور به‌صورت صفحه‌ی HTML می‌سازد؛ فقط همین صفحه داخل یک WebView نمایش داده می‌شود. */
@Composable
fun PreviewDialog(id: String, vm: AppViewModel) {
    val url = remember(id) {
        Api.syncCookiesToWebView()
        Api.previewUrl(id)
    }
    val ctx = LocalContext.current
    val cs = MaterialTheme.colorScheme
    var web by remember { mutableStateOf<WebView?>(null) }
    Dialog(onDismissRequest = { vm.closeViewer() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(cs.background)) {
            Row(
                Modifier.fillMaxWidth().background(cs.surface).padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { vm.closeViewer() }) { AppIcon(AppIcons.Close, tint = cs.onSurface) }
                Text("پیش‌نمایش اسلایدها", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = {
                    web?.let { w ->
                        val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
                        pm.print("presentation", w.createPrintDocumentAdapter("presentation"), PrintAttributes.Builder().build())
                    }
                }) {
                    AppIcon(AppIcons.Download, size = 18.dp)
                    Spacer(Modifier.width(6.dp))
                    Text("ذخیره PDF")
                }
            }
            HorizontalDivider(color = cs.outlineVariant)
            AndroidView(
                factory = { c ->
                    WebView(c).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        webViewClient = WebViewClient()
                        loadUrl(url)
                    }.also { web = it }
                },
                onRelease = { it.destroy() },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
