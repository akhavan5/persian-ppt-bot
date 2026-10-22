@file:OptIn(ExperimentalMaterial3Api::class)

package ir.pptsaz.app

import androidx.compose.foundation.background
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
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("پاورپوینت‌ساز", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Brand)
        Spacer(Modifier.height(8.dp))
        Text("با شماره‌ی موبایل وارد شوید", color = Color(0xFF64748B))
        Spacer(Modifier.height(24.dp))

        if (st.config?.otp == false) {
            Text("ورود با پیامک فعلاً در دسترس نیست. لطفاً از سایت pptsaz.ir استفاده کنید.", color = MaterialTheme.colorScheme.error)
            return@Column
        }

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
                listOf("ساخت" to "✨", "فایل‌ها" to "📁", "حساب" to "👤").forEachIndexed { i, (label, icon) ->
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
                else -> AccountTab(st, me, vm)
            }
        }
    }
}

// ------------------------------------------------------------------ ساخت

@Composable
fun CreateTab(st: UiState, me: Me, vm: AppViewModel) {
    val cfg = st.config ?: return
    var topic by rememberSaveable { mutableStateOf("") }
    var source by rememberSaveable { mutableStateOf("") }
    var handout by rememberSaveable { mutableStateOf(false) }
    var slides by rememberSaveable { mutableStateOf(me.settings.slides.coerceAtMost(me.maxSlides)) }
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
                    selected = slides == n,
                    onClick = {
                        if (locked) vm.toast("برای بیش از " + me.maxSlides.fa() + " اسلاید به اشتراک نیاز دارید")
                        else slides = n
                    },
                    label = { Text((if (locked) "🔒 " else "") + n.fa()) },
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("ساخت جزوه‌ی Word هم همراه ارائه", modifier = Modifier.weight(1f))
            Switch(checked = handout, onCheckedChange = { handout = it })
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

        Button(
            onClick = { vm.generate(topic, slides, handout, source) },
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
            Text("فایل‌های شما", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
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
                            Button(onClick = { vm.download(f.id) }) { Text("دانلود") }
                        }
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ حساب

@Composable
fun AccountTab(st: UiState, me: Me, vm: AppViewModel) {
    val cfg = st.config
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(me.name.ifBlank { "کاربر" }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (me.mobile.isNotEmpty()) Text(me.mobile, color = Color(0xFF64748B))
                Text(if (me.unlimited) "اعتبار: نامحدود" else "اعتبار باقی‌مانده: " + me.credits.fa())
                me.planId?.let { id ->
                    val name = me.plans.firstOrNull { it.id == id }?.name ?: id
                    Text("اشتراک فعال: $name")
                }
            }
        }

        // خرید اشتراک
        if (me.plans.isNotEmpty()) {
            Text("اشتراک‌ها", fontWeight = FontWeight.Bold)
            me.plans.forEach { p ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name, fontWeight = FontWeight.Bold)
                            Text(p.price.fa() + " هزار تومان • " + p.credits.fa() + " اعتبار • تا " + p.maxSlides.fa() + " اسلاید", color = Color(0xFF64748B))
                        }
                        if (cfg?.payEnabled == true) {
                            Button(onClick = { vm.buy(p.id) }) { Text("خرید") }
                        }
                    }
                }
            }
            if (cfg?.payEnabled != true) {
                TextButton(onClick = { vm.openSite() }) { Text("خرید از سایت pptsaz.ir") }
            } else {
                Text("پرداخت در مرورگر انجام می‌شود و بعد از آن به اپ برمی‌گردید.", color = Color(0xFF64748B))
            }
        }

        // تنظیمات پیش‌فرض ساخت
        if (cfg != null) {
            Text("قالب", fontWeight = FontWeight.Bold)
            ChipRow(cfg.templates, me.settings.template) { vm.setSetting("template", it) }
            Text("رنگ‌بندی", fontWeight = FontWeight.Bold)
            ChipRow(cfg.themes, me.settings.theme) { vm.setSetting("theme", it) }
            Text("لحن", fontWeight = FontWeight.Bold)
            ChipRow(cfg.tones, me.settings.tone) { vm.setSetting("tone", it) }
            Text("فونت", fontWeight = FontWeight.Bold)
            ChipRow(cfg.fonts.map { Opt(it, it) }, me.settings.font) { vm.setSetting("font", it) }
        }

        if (me.support.isNotEmpty()) Text("پشتیبانی: " + me.support, color = Color(0xFF64748B))
        OutlinedButton(onClick = { vm.logout() }, modifier = Modifier.fillMaxWidth()) { Text("خروج از حساب") }
        Spacer(Modifier.height(8.dp))
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
