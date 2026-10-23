@file:OptIn(ExperimentalMaterial3Api::class)

package ir.pptsaz.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import android.content.Context
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import androidx.compose.ui.platform.LocalContext
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

private val Brand = Color(0xFF2563EB)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Brand,
            onPrimary = Color.White,
            secondary = Color(0xFF06B6D4),
            background = Color(0xFFF8FAFF),
            surface = Color.White,
            surfaceVariant = Color(0xFFEAF0FF),
        ),
        content = content,
    )
}

@Composable
fun Root(st: UiState, vm: AppViewModel) {
    when (st.screen) {
        Screen.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        Screen.Error -> Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("اتصال برقرار نشد", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(st.error ?: "اینترنت خود را بررسی کنید.")
            Spacer(Modifier.height(16.dp))
            Button(onClick = { vm.refresh() }) { Text("تلاش دوباره") }
        }
        Screen.Login -> LoginScreen(st, vm)
        Screen.Main -> MainScreen(st, vm)
    }
}

// ------------------------------------------------------------------ ورود

@Composable
fun LoginScreen(st: UiState, vm: AppViewModel) {
    var mobile by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    val otpOn = st.config?.otp != false
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("پاورپوینت‌ساز", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Brand)
        Spacer(Modifier.height(8.dp))
        Text("با شماره‌ی موبایل وارد شوید", color = Color(0xFF64748B))
        Spacer(Modifier.height(24.dp))

        if (otpOn) {
            OutlinedTextField(
                value = mobile,
                onValueChange = { mobile = it.filter { c -> c.isDigit() }.take(11) },
                label = { Text("شماره‌ی موبایل") },
                placeholder = { Text("09123456789") },
                singleLine = true,
                enabled = !st.otpSent && !st.busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))

            if (st.otpSent) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.filter { c -> c.isDigit() }.take(8) },
                    label = { Text("کد تأیید") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { vm.verifyOtp(mobile, code) },
                    enabled = !st.busy && code.length >= 4,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("ورود") }
                TextButton(onClick = { vm.editMobile() }) { Text("ویرایش شماره") }
            } else {
                Button(
                    onClick = { vm.sendOtp(mobile) },
                    enabled = !st.busy && mobile.length >= 10,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("ارسال کد تأیید") }
            }
        } else {
            Text("ورود با پیامک فعلاً در دسترس نیست. لطفاً از سایت pptsaz.ir استفاده کنید.", color = MaterialTheme.colorScheme.error)
        }

        if (st.busy) {
            Spacer(Modifier.height(16.dp))
            CircularProgressIndicator()
        }
    }
}

// ------------------------------------------------------------------ صفحه‌ی اصلی

@Composable
fun MainScreen(st: UiState, vm: AppViewModel) {
    val me = st.me ?: return
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("پاورپوینت‌ساز", fontWeight = FontWeight.Bold) },
                actions = {
                    Text(
                        if (me.unlimited) "اعتبار نامحدود" else "اعتبار: " + me.credits.fa(),
                        modifier = Modifier.padding(end = 16.dp),
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Brand,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White,
                ),
            )
        },
        bottomBar = {
            NavigationBar {
                listOf("ساخت" to "✨", "فایل‌ها" to "📁", "تنظیمات" to "⚙️", "حساب" to "👤").forEachIndexed { i, (label, icon) ->
                    NavigationBarItem(
                        selected = st.tab == i,
                        onClick = { vm.setTab(i) },
                        icon = { Text(icon) },
                        label = { Text(label) },
                    )
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (st.tab) {
                0 -> CreateTab(st, me, vm)
                1 -> FilesTab(st, vm)
                2 -> SettingsTab(st, me, vm)
                else -> AccountTab(st, me, vm)
            }
        }
    }
    when (val v = st.viewer) {
        is Viewer.Poster -> PosterDialog(v.id, vm)
        is Viewer.Preview -> PreviewDialog(v.id, vm)
        null -> {}
    }
}

// ------------------------------------------------------------------ ساخت

@Composable
fun CreateTab(st: UiState, me: Me, vm: AppViewModel) {
    val cfg = st.config ?: return
    var topic by rememberSaveable { mutableStateOf("") }
    var source by rememberSaveable { mutableStateOf("") }
    var handout by rememberSaveable { mutableStateOf(false) }
    var poster by rememberSaveable { mutableStateOf("") }
    var link by rememberSaveable { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.importFile(uri)
    }
    LaunchedEffect(st.extractedText) {
        val t = st.extractedText
        if (t != null) {
            source = if (source.isBlank()) t else source.trimEnd() + "\n\n" + t
            vm.consumeExtracted()
        }
    }
    val job = st.job
    val running = job != null && !job.done && !job.failed

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("موضوع ارائه", fontWeight = FontWeight.Bold)
        OutlinedTextField(
            value = topic,
            onValueChange = { topic = it },
            placeholder = { Text("مثلاً: تأثیر هوش مصنوعی بر آموزش") },
            minLines = 2,
            enabled = !running,
            modifier = Modifier.fillMaxWidth(),
        )

        Text("تعداد اسلاید", fontWeight = FontWeight.Bold)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(cfg.slideChoices) { n ->
                val locked = n > me.maxSlides
                FilterChip(
                    selected = me.settings.slides == n,
                    onClick = {
                        if (locked) vm.toast("برای بیش از " + me.maxSlides.fa() + " اسلاید به اشتراک نیاز دارید")
                        else vm.setSetting("slides", n)
                    },
                    label = { Text((if (locked) "🔒 " else "") + n.fa()) },
                )
            }
        }

        Text("تعداد تصویر", fontWeight = FontWeight.Bold)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items((0..6).toList()) { n ->
                val locked = n > me.maxImages
                FilterChip(
                    selected = me.settings.imageCount == n,
                    onClick = {
                        if (locked) vm.toast("ساخت " + n.fa() + " تصویر در هر ارائه فقط با پلن‌های پولی ممکن است")
                        else vm.setSetting("imageCount", n)
                    },
                    label = { Text((if (locked) "🔒 " else "") + (if (n == 0) "بدون تصویر" else n.fa())) },
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("ساخت جزوه‌ی Word هم همراه ارائه", modifier = Modifier.weight(1f))
            Switch(checked = handout, onCheckedChange = { handout = it })
        }

        if (cfg.poster) {
            Text("پوستر (تصویر خلاصه‌ی ارائه)", fontWeight = FontWeight.Bold)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf("" to "بدون پوستر", "wide" to "افقی", "tall" to "عمودی")) { (key, label) ->
                    FilterChip(selected = poster == key, onClick = { poster = key }, label = { Text(label) })
                }
            }
        }

        OutlinedTextField(
            value = source,
            onValueChange = { source = it },
            label = { Text("متن منبع (اختیاری)") },
            placeholder = { Text("متن یا یادداشت‌هایی که می‌خواهید ارائه بر پایه‌ی آن‌ها ساخته شود") },
            minLines = 3,
            enabled = !running,
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedButton(
            onClick = { picker.launch(arrayOf("application/pdf", "image/png", "image/jpeg")) },
            enabled = !running && st.extractBusy == null,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("📎 افزودن منبع از PDF یا عکس") }

        if (cfg.link) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = link,
                    onValueChange = { link = it },
                    label = { Text("آدرس یک صفحه‌ی وب") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = { vm.importLink(link); link = "" },
                    enabled = link.isNotBlank() && st.extractBusy == null && !running,
                ) { Text("افزودن") }
            }
        }

        if (st.extractBusy != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                Text(st.extractBusy, color = Color(0xFF64748B))
            }
        }

        Button(
            onClick = { vm.generate(topic, me.settings.slides, handout, source, poster.ifEmpty { null }, me.settings.imageCount) },
            enabled = !running && !st.busy,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("ساخت ارائه") }

        if (job != null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    when {
                        job.failed -> {
                            Text(job.message, color = MaterialTheme.colorScheme.error)
                            TextButton(onClick = { vm.dismissJob() }) { Text("بستن") }
                        }
                        job.done -> {
                            Text("✅ " + job.title.ifEmpty { "ارائه آماده شد" }, fontWeight = FontWeight.Bold)
                            Button(onClick = { vm.download(job.id) }, modifier = Modifier.fillMaxWidth()) {
                                Text("دانلود ارائه (PPTX)")
                            }
                            job.handoutId?.let { hid ->
                                OutlinedButton(onClick = { vm.download(hid) }, modifier = Modifier.fillMaxWidth()) {
                                    Text("دانلود جزوه (Word)")
                                }
                            }
                            job.posterId?.let { pid ->
                                OutlinedButton(onClick = { vm.openViewer(Viewer.Poster(pid)) }, modifier = Modifier.fillMaxWidth()) {
                                    Text("نمایش پوستر")
                                }
                            }
                            if (job.posterFailed) Text("ساخت پوستر ناموفق بود؛ ارائه‌ی شما سالم است.", color = Color(0xFF64748B))
                            OutlinedButton(onClick = { vm.openViewer(Viewer.Preview(job.id)) }, modifier = Modifier.fillMaxWidth()) {
                                Text("پیش‌نمایش اسلایدها")
                            }
                            TextButton(onClick = { vm.dismissJob() }) { Text("بستن") }
                        }
                        else -> {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                            Text(job.message)
                            Text("می‌توانید از اپ خارج شوید؛ ساخت ادامه پیدا می‌کند.", color = Color(0xFF64748B))
                        }
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ فایل‌ها

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
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("فایل‌های ۲۴ ساعت اخیر", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = { vm.loadFiles() }, enabled = !st.filesLoading) { Text("به‌روزرسانی") }
        }
        if (st.filesLoading && st.files.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else if (st.files.isEmpty()) {
            Text("هنوز فایلی نساخته‌اید.", color = Color(0xFF64748B), modifier = Modifier.padding(top = 24.dp))
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxSize()) {
                items(st.files) { f ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(f.title.ifBlank { "بدون عنوان" }, fontWeight = FontWeight.Bold, maxLines = 2)
                                val kind = when {
                                    f.poster -> "پوستر"
                                    f.handout -> "جزوه‌ی Word"
                                    else -> f.slides.fa() + " اسلاید"
                                }
                                Text(listOf(kind, fmtDate(f.t)).filter { it.isNotEmpty() }.joinToString(" • "), color = Color(0xFF64748B))
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (f.poster) {
                                    OutlinedButton(onClick = { vm.openViewer(Viewer.Poster(f.id)) }) { Text("نمایش") }
                                } else if (!f.handout) {
                                    OutlinedButton(onClick = { vm.openViewer(Viewer.Preview(f.id)) }) { Text("پیش‌نمایش") }
                                }
                                Button(onClick = { vm.download(f.id) }) { Text("دانلود") }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ تنظیمات

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
    val canExtra = me.unlimited || me.planId != null
    val gray = Color(0xFF64748B)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("تنظیمات ظاهر و محتوا", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

        Text("قالب", fontWeight = FontWeight.Bold)
        ChipRow(cfg.templates, s.template) { vm.setSetting("template", it) }
        cfg.templates.firstOrNull { it.key == s.template }?.hint?.takeIf { it.isNotEmpty() }?.let { Text(it, color = gray) }

        Text("تم رنگی", fontWeight = FontWeight.Bold)
        ChipRow(cfg.themes, s.theme) { vm.setSetting("theme", it) }

        Text("لحن", fontWeight = FontWeight.Bold)
        ChipRow(cfg.tones, s.tone) { vm.setSetting("tone", it) }

        Text("فونت", fontWeight = FontWeight.Bold)
        ChipRow(cfg.fonts.map { Opt(it, it) }, s.font) { vm.setSetting("font", it) }
        Text("فونت Vazirmatn باید روی دستگاه نمایش‌دهنده نصب باشد؛ Tahoma و Arial همه‌جا کار می‌کنند.", color = gray)

        Text("حالت ساخت", fontWeight = FontWeight.Bold)
        ChipRow(MODES.map { Opt(it.first, it.second) }, s.mode) { vm.setSetting("mode", it) }
        MODES.firstOrNull { it.first == s.mode }?.let { Text(it.third, color = gray) }

        SwitchRow("ارقام فارسی", s.digits) { vm.setSetting("digits", it) }
        SwitchRow("اسلاید منابع", s.sources) { vm.setSetting("sources", it) }
        SwitchRow("اسلاید پرسش‌های پایانی", s.questions) { vm.setSetting("questions", it) }

        if (cfg.models.isNotEmpty()) {
            Text("مدل هوش مصنوعی", fontWeight = FontWeight.Bold)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(cfg.models) { m ->
                    FilterChip(
                        selected = s.model == m.id,
                        onClick = { vm.setSetting("model", m.id) },
                        label = { Text((if (!m.free && !canExtra) "🔒 " else "") + m.name) },
                    )
                }
            }
            if (!canExtra && cfg.models.any { !it.free }) {
                Text("مدل‌های قفل‌دار فقط با اشتراک فعال قابل استفاده‌اند.", color = gray)
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

// ------------------------------------------------------------------ حساب

@Composable
fun AccountTab(st: UiState, me: Me, vm: AppViewModel) {
    val cfg = st.config
    val gray = Color(0xFF64748B)
    var nameDialog by rememberSaveable { mutableStateOf(false) }
    if (nameDialog) NameDialog(me.name, vm) { nameDialog = false }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(me.name.ifBlank { "کاربر" }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (me.email.isNotEmpty()) Text(me.email, color = gray)
                if (me.mobile.isNotEmpty()) Text(me.mobile, color = gray)
                TextButton(onClick = { nameDialog = true }) { Text("ویرایش نام") }
                if (me.unlimited) {
                    Text("اعتبار: نامحدود")
                } else {
                    Text("اعتبار باقی‌مانده: " + me.credits.fa())
                    if (me.planCredits > 0 || me.bonus > 0) {
                        Text("پلن: " + me.planCredits.fa() + " • هدیه: " + me.bonus.fa(), color = gray)
                    }
                }
                val planName = me.planId?.let { id -> me.plans.firstOrNull { it.id == id }?.name ?: id }
                if (planName != null) {
                    val until = if (me.planExp > 0) " تا " + fmtDate(me.planExp) else ""
                    Text("👑 پلن $planName$until")
                } else {
                    Text("پلن رایگان")
                }
            }
        }
        if (cfg != null && cfg.dailyFree > 0 && !me.unlimited) {
            Text("🎁 هر روز " + cfg.dailyFree.fa() + " اعتبار رایگان هدیه می‌گیری.", color = gray)
        }

        if (me.plans.isNotEmpty()) {
            Text("اشتراک‌ها", fontWeight = FontWeight.Bold)
            me.plans.forEach { p ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name, fontWeight = FontWeight.Bold)
                            Text(
                                p.price.fa() + " هزار تومان • " + p.credits.fa() + " اعتبار • تا " + p.maxSlides.fa() +
                                    " اسلاید • تا " + p.maxImages.fa() + " تصویر • " + p.days.fa() + " روز",
                                color = gray,
                            )
                        }
                        Button(onClick = {
                            when {
                                cfg?.payEnabled == true -> vm.buy(p.id)
                                p.url.isNotEmpty() -> vm.openUrl(p.url)
                                else -> vm.openSite()
                            }
                        }) { Text("خرید") }
                    }
                }
            }
            Text(
                if (cfg?.payEnabled == true) "پرداخت در مرورگر انجام می‌شود و بعد از آن به اپ برمی‌گردید."
                else "پرداخت از طریق ربات تلگرام انجام می‌شود.",
                color = gray,
            )
        }

        TelegramCard(me, vm)

        if (me.support.isNotEmpty()) Text("پشتیبانی: " + me.support, color = gray)
        OutlinedButton(onClick = { vm.logout() }, modifier = Modifier.fillMaxWidth()) { Text("خروج از حساب") }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun TelegramCard(me: Me, vm: AppViewModel) {
    var tg by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var sent by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("اتصال تلگرام", fontWeight = FontWeight.Bold)
            if (me.telegram.isNotEmpty()) {
                Text("✅ وصل است (" + me.telegram + ")")
            } else {
                Text(
                    "برای استفاده‌ی مشترک از اعتبار در ربات، آیدی عددی تلگرام خود را وارد کنید. در ربات @pptsaz_bot دستور /id را بزنید و عدد را کپی کنید.",
                    color = Color(0xFF64748B),
                )
                OutlinedTextField(
                    value = tg,
                    onValueChange = { tg = it.filter { c -> c.isDigit() }.take(16) },
                    singleLine = true,
                    enabled = !sent,
                    label = { Text("آیدی عددی تلگرام") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (!sent) {
                    Button(
                        enabled = !busy && tg.length >= 5,
                        onClick = {
                            busy = true
                            vm.telegramSend(tg) { codeSent ->
                                busy = false
                                if (codeSent) sent = true
                            }
                        },
                    ) { Text("ارسال کد") }
                } else {
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it.filter { c -> c.isDigit() }.take(8) },
                        singleLine = true,
                        label = { Text("کد ۶ رقمی تلگرام") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        enabled = !busy && code.length >= 4,
                        onClick = {
                            busy = true
                            vm.telegramVerify(code) { ok ->
                                busy = false
                                if (ok) {
                                    sent = false
                                    code = ""
                                }
                            }
                        },
                    ) { Text("اتصال") }
                }
            }
        }
    }
}

@Composable
private fun ChipRow(options: List<Opt>, selected: String, onSelect: (String) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(options) { o ->
            FilterChip(
                selected = selected == o.key,
                onClick = { onSelect(o.key) },
                label = { Text(o.name) },
                leadingIcon = if (o.color != null) {
                    { ColorDot(o.color) }
                } else null,
            )
        }
    }
}

@Composable
private fun ColorDot(hex: String) {
    val c = try { Color(android.graphics.Color.parseColor("#$hex")) } catch (e: Exception) { Brand }
    Box(Modifier.size(12.dp).clip(CircleShape).background(c))
}

// ------------------------------------------------------------------ دیالوگ‌ها

@Composable
fun NameDialog(current: String, vm: AppViewModel, onClose: () -> Unit) {
    var name by remember { mutableStateOf(current) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("ویرایش نام") },
        text = {
            OutlinedTextField(value = name, onValueChange = { name = it.take(64) }, singleLine = true, label = { Text("نام") })
        },
        confirmButton = {
            Button(
                enabled = !busy && name.trim().length >= 2,
                onClick = {
                    busy = true
                    vm.updateName(name) { ok ->
                        busy = false
                        if (ok) onClose()
                    }
                },
            ) { Text("ذخیره") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("انصراف") } },
    )
}

@Composable
fun PosterDialog(id: String, vm: AppViewModel) {
    val loaded by produceState(initialValue = Pair<androidx.compose.ui.graphics.ImageBitmap?, Boolean>(null, false), id) {
        value = try {
            Pair(Api.fetchImage(id).asImageBitmap(), true)
        } catch (e: Exception) {
            Pair(null, true)
        }
    }
    val img = loaded.first
    Dialog(onDismissRequest = { vm.closeViewer() }) {
        Card {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                when {
                    !loaded.second -> CircularProgressIndicator()
                    img == null -> Text("نمایش پوستر ممکن نشد. می‌توانید آن را دانلود کنید.")
                    else -> Image(
                        bitmap = img,
                        contentDescription = "پوستر",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 460.dp),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { vm.download(id) }) { Text("دانلود") }
                    TextButton(onClick = { vm.closeViewer() }) { Text("بستن") }
                }
            }
        }
    }
}

/** پیش‌نمایش اسلایدها را خود سرور به‌صورت صفحه‌ی HTML می‌سازد؛ فقط همین صفحه داخل یک WebView کوچک نمایش داده می‌شود. */
@Composable
fun PreviewDialog(id: String, vm: AppViewModel) {
    val url = remember(id) {
        Api.syncCookiesToWebView()
        Api.previewUrl(id)
    }
    val ctx = LocalContext.current
    var web by remember { mutableStateOf<WebView?>(null) }
    Dialog(onDismissRequest = { vm.closeViewer() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Color.White)) {
            Row(Modifier.fillMaxWidth().background(Brand).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("پیش‌نمایش اسلایدها", color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).padding(start = 8.dp))
                TextButton(onClick = {
                    web?.let { w ->
                        val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
                        pm.print("presentation", w.createPrintDocumentAdapter("presentation"), PrintAttributes.Builder().build())
                    }
                }) { Text("ذخیره PDF", color = Color.White) }
                TextButton(onClick = { vm.closeViewer() }) { Text("بستن", color = Color.White) }
            }
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
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
