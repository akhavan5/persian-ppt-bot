@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class, ExperimentalComposeUiApi::class)

package ir.pptsaz.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.speech.RecognizerIntent
import android.graphics.Bitmap
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.core.content.FileProvider
import java.io.File
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.foundation.layout.consumeWindowInsets
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.ui.platform.LocalConfiguration
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
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.material3.LocalTextStyle
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
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
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.font.FontWeight
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
    val wide = LocalConfiguration.current.screenWidthDp >= 600 // تبلت/فولدبل: به‌جای نوار پایین، ریل کناری
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize()) {
            Crossfade(targetState = st.screen, animationSpec = tween(250), label = "root") { s ->
                when (s) {
                    Screen.Loading -> LoadingScreen()
                    Screen.Error -> CenteredColumn(520.dp) { ErrorScreen(st, vm) }
                    Screen.Login -> CenteredColumn(520.dp) { LoginScreen(st, vm) }
                    Screen.Main -> MainScreen(st, vm)
                }
            }
            val cfg = st.config
            val forced = cfg != null && cfg.minVersion > BuildConfig.VERSION_CODE
            LaunchedEffect(cfg?.latestVersion) { vm.maybeAskUpdate() }
            if (forced) {
                UpdateRequiredScreen(cfg!!.updateUrl) { vm.openUrl(it) }
            } else if (st.updateDialog && cfg != null) {
                AlertDialog(
                    onDismissRequest = { vm.dismissUpdate() },
                    title = { Text("نسخه‌ی جدید موجود است") },
                    text = { Text("نسخه‌ی تازه‌ی پاورپوینت‌ساز منتشر شده است. برای استفاده از امکانات و اصلاحات جدید، اپ را به‌روزرسانی کنید.") },
                    confirmButton = { TextButton(onClick = { vm.dismissUpdate(); vm.startUpdate(cfg.updateUrl) }) { Text("به‌روزرسانی") } },
                    dismissButton = { TextButton(onClick = { vm.dismissUpdate() }) { Text("بعداً") } },
                )
            }
            SnackbarHost(
                hostState = snack,
                modifier = Modifier.align(Alignment.BottomCenter)
                    .padding(bottom = if (st.screen == Screen.Main && !wide) 84.dp else 0.dp)
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .imePadding(),
            ) { data -> Snackbar(data, modifier = Modifier.padding(12.dp), shape = RoundedCornerShape(16.dp)) }
        }
    }
}

/** روی صفحه‌ی بزرگ محتوا را وسط و با حداکثر عرض نگه می‌دارد؛ روی گوشی هیچ تغییری نمی‌دهد. */
@Composable
private fun CenteredColumn(maxWidth: androidx.compose.ui.unit.Dp, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = maxWidth).fillMaxSize()) { content() }
    }
}

@Composable
private fun UpdateRequiredScreen(url: String, open: (String) -> Unit) {
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LogoBadge()
        Spacer(Modifier.height(24.dp))
        Text("به‌روزرسانی لازم است", style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            "این نسخه‌ی اپ دیگر پشتیبانی نمی‌شود. برای ادامه، آخرین نسخه را نصب کنید.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        GradientButton("به‌روزرسانی", { open(url) }, Modifier.fillMaxWidth())
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
    var ident by rememberSaveable { mutableStateOf("") } // موبایل یا ایمیل (مثل وب در یک کادر)
    var code by rememberSaveable { mutableStateOf("") }
    var left by rememberSaveable { mutableStateOf(0) } // ثانیه‌های مانده تا امکان «ارسال دوباره‌ی کد»
    val otpOn = st.config?.otp != false
    val emailOn = st.config?.emailOtp == true
    val anyOn = otpOn || emailOn
    val isEmail = '@' in ident
    // موبایل فقط اگر ورود پیامکی روشن است و ایمیل فقط اگر ورود ایمیلی روشن است معتبر شمرده می‌شود
    val norm = normalizeLoginId(ident)?.takeIf { if (isEmail) emailOn else otpOn }
    // با هر ارسال کد، شمارش معکوس از اول شروع می‌شود
    LaunchedEffect(st.otpSent, st.otpTick) {
        if (st.otpSent) {
            left = 60
            while (left > 0) {
                delay(1000)
                left--
            }
        }
    }
    // کد از پیامک خوانده شد (SMS User Consent): در کادر می‌نشیند و ورود خودکار انجام می‌شود
    LaunchedEffect(st.smsCode) {
        val c = st.smsCode
        if (c != null) {
            code = c
            vm.consumeSmsCode()
            if (norm != null && !isEmail && !st.busy) vm.verifyOtp(norm, c)
        }
    }
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
                Modifier.fillMaxWidth().statusBarsPadding().padding(start = 28.dp, end = 28.dp, top = 20.dp, bottom = 36.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.size(60.dp).clip(RoundedCornerShape(20.dp)).background(Color.White), contentAlignment = Alignment.Center) {
                    AppIcon(AppIcons.Slides, tint = Color(0xFF2563EB), size = 32.dp)
                }
                Spacer(Modifier.height(12.dp))
                Text("پاورپوینت‌ساز", style = MaterialTheme.typography.headlineMedium, color = Color.White)
                Spacer(Modifier.height(6.dp))
                Text(
                    "ارائه‌ی حرفه‌ای با هوش مصنوعی، در چند دقیقه",
                    style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.88f), textAlign = TextAlign.Center,
                )
            }
        }

        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 22.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val googleId = st.config?.googleClientId.orEmpty()
            if (!anyOn && googleId.isEmpty()) {
                SurfaceCard(color = cs.errorContainer, borderColor = null) {
                    Text(
                        "ورود با پیامک فعلاً در دسترس نیست. لطفاً از سایت pptsaz.ir استفاده کنید.",
                        color = cs.onErrorContainer, modifier = Modifier.padding(16.dp),
                    )
                }
            } else if (anyOn) {
                val fieldStyle: TextStyle = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center, textDirection = TextDirection.Ltr)
                AnimatedContent(targetState = st.otpSent, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(120)) }, label = "otp") { sent ->
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        if (!sent) {
                            Text("ورود یا ثبت‌نام", style = MaterialTheme.typography.titleLarge)
                            Text(
                                when {
                                    otpOn && emailOn -> "شماره‌ی موبایل یا ایمیل خود را وارد کنید تا کد تأیید برایتان ارسال شود."
                                    emailOn -> "ایمیل خود را وارد کنید تا کد تأیید برایتان ارسال شود."
                                    else -> "شماره‌ی موبایل خود را وارد کنید تا کد تأیید برایتان پیامک شود."
                                },
                                color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium,
                            )
                            val badId = if (isEmail) ident.substringAfter('@').contains('.') && norm == null else ident.length >= 10 && norm == null
                            OutlinedTextField(
                                value = ident,
                                onValueChange = {
                                    ident = if (emailOn) it.filter { c -> !c.isWhitespace() }.take(254)
                                    else it.filter { c -> c.isDigit() || c == '+' }.take(14)
                                },
                                placeholder = {
                                    Text(
                                        when {
                                            otpOn && emailOn -> "09123456789  یا  name@example.com"
                                            emailOn -> "name@example.com"
                                            else -> "09123456789"
                                        },
                                        Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                                        style = if (otpOn && emailOn) MaterialTheme.typography.bodyMedium else LocalTextStyle.current,
                                    )
                                },
                                textStyle = fieldStyle,
                                singleLine = true,
                                enabled = !st.busy,
                                isError = badId,
                                supportingText = {
                                    if (badId) Text(if (isEmail) "ایمیل معتبر نیست؛ مثل name@example.com" else "شماره‌ی موبایل معتبر نیست؛ مثل 09123456789")
                                },
                                shape = RoundedCornerShape(18.dp),
                                keyboardOptions = KeyboardOptions(keyboardType = if (emailOn) KeyboardType.Email else KeyboardType.Phone, imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { if (norm != null) vm.sendOtp(norm) }),
                                modifier = Modifier.fillMaxWidth().semantics { contentType = if (isEmail) ContentType.EmailAddress else ContentType.PhoneNumber },
                            )
                            GradientButton("ارسال کد تأیید", { norm?.let { vm.sendOtp(it) } }, Modifier.fillMaxWidth(), enabled = norm != null, loading = st.busy)
                        } else {
                            Text("کد تأیید را وارد کنید", style = MaterialTheme.typography.titleLarge)
                            Text(if (isEmail) "کد به ایمیل " + (norm ?: ident) + " ارسال شد." else "کد به شماره‌ی " + (norm ?: ident).faStr() + " ارسال شد.", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                            OutlinedTextField(
                                value = code,
                                onValueChange = { code = it.filter { c -> c.isDigit() }.take(8) },
                                placeholder = { Text("• • • • • •", Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
                                textStyle = fieldStyle.copy(letterSpacing = 8.sp),
                                singleLine = true,
                                shape = RoundedCornerShape(18.dp),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { if (code.length >= 4 && !st.busy) vm.verifyOtp(ident, code) }),
                                modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.SmsOtpCode },
                            )
                            GradientButton("ورود", { vm.verifyOtp(ident, code) }, Modifier.fillMaxWidth(), enabled = code.length >= 4, loading = st.busy)
                            TextButton(
                                onClick = { vm.sendOtp(norm ?: ident) }, enabled = left == 0 && !st.busy,
                                modifier = Modifier.align(Alignment.CenterHorizontally),
                            ) {
                                AppIcon(AppIcons.Refresh, size = 18.dp)
                                Spacer(Modifier.width(6.dp))
                                Text(if (left > 0) "ارسال دوباره‌ی کد تا " + left.fa() + " ثانیه‌ی دیگر" else "ارسال دوباره‌ی کد")
                            }
                            TextButton(onClick = { vm.editMobile() }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                                AppIcon(AppIcons.Edit, size = 18.dp)
                                Spacer(Modifier.width(6.dp))
                                Text(if (isEmail) "ویرایش ایمیل" else "ویرایش شماره")
                            }
                        }
                    }
                }
            }

            if (googleId.isNotEmpty() && !(anyOn && st.otpSent)) {
                val ctx = LocalContext.current
                val scope = rememberCoroutineScope()
                if (anyOn) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        HorizontalDivider(Modifier.weight(1f))
                        Text("یا", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        HorizontalDivider(Modifier.weight(1f))
                    }
                } else {
                    Text("ورود یا ثبت‌نام", style = MaterialTheme.typography.titleLarge)
                }
                OutlinedButton(
                    onClick = { scope.launch { vm.googleResult(GoogleAuth.idToken(ctx, googleId)) } },
                    enabled = !st.busy,
                    shape = RoundedCornerShape(18.dp),
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) { Text("ورود با گوگل (جیمیل)", style = MaterialTheme.typography.titleSmall) }
            }

            if (!(anyOn && st.otpSent)) {
                val linkColor = cs.primary
                Text(
                    buildAnnotatedString {
                        append("با ادامه، ")
                        withLink(
                            LinkAnnotation.Clickable(
                                tag = "privacy",
                                styles = TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)),
                            ) { vm.openUrl(Api.BASE + "/privacy") },
                        ) { append("شرایط استفاده و حریم خصوصی") }
                        append(" را می‌پذیرم.")
                    },
                    style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

// ================================================================== قاب اصلی

/** وضعیت فرم «ساخت»؛ در AppViewModel نگه داشته می‌شود تا با عوض‌کردن تب و چرخش صفحه پاک نشود (و متن بلند وارد Bundle نشود). */
@Stable
class CreateForm(topic: String = "", source: String = "", handout: Boolean = false, poster: String = "wide", audio: Boolean = false, podcast: Boolean = false) {
    var topic by mutableStateOf(topic)
    var source by mutableStateOf(source)
    var handout by mutableStateOf(handout)
    var poster by mutableStateOf(poster)
    var audio by mutableStateOf(audio)
    var podcast by mutableStateOf(podcast)

    /** برگشت به حالت اولِ فرم (مقادیر پیش‌فرض همان‌هایی است که Draft.load برای پیش‌نویس خالی می‌دهد). */
    fun reset() {
        topic = ""
        source = ""
        handout = false
        poster = "wide"
        audio = false
        podcast = false
    }
}

@Composable
private fun VerticalDividerLine() {
    Box(Modifier.fillMaxHeight().width(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
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
    val ctx = LocalContext.current
    val form = vm.form
    // ذخیره‌ی خودکار پیش‌نویس روی گوشی (با ۰٫۷ ثانیه تاخیر تا با هر حرف نوشته نشود)
    LaunchedEffect(form) {
        snapshotFlow { listOf<Any>(form.topic, form.source, form.handout, form.poster, form.audio, form.podcast) }.collectLatest {
            delay(700)
            Draft.save(ctx, form)
        }
    }
    val cs = MaterialTheme.colorScheme
    // Back در تب‌های «فایل‌ها/تنظیمات/حساب» اول به تب «ساخت» برمی‌گردد و فقط از آنجا از اپ خارج می‌شود
    BackHandler(enabled = st.tab != 0 && st.viewer == null) { vm.setTab(0) }
    val wide = LocalConfiguration.current.screenWidthDp >= 600
    val navColors = NavigationBarItemDefaults.colors(
        selectedIconColor = cs.onPrimaryContainer,
        selectedTextColor = cs.primary,
        indicatorColor = cs.primaryContainer,
        unselectedIconColor = cs.onSurfaceVariant,
        unselectedTextColor = cs.onSurfaceVariant,
    )
    val railColors = NavigationRailItemDefaults.colors(
        selectedIconColor = cs.onPrimaryContainer,
        selectedTextColor = cs.primary,
        indicatorColor = cs.primaryContainer,
        unselectedIconColor = cs.onSurfaceVariant,
        unselectedTextColor = cs.onSurfaceVariant,
    )
    Scaffold(
        containerColor = cs.background,
        bottomBar = {
            if (!wide) {
                Column {
                    HorizontalDivider(color = cs.outlineVariant)
                    NavigationBar(containerColor = cs.surface, tonalElevation = 0.dp) {
                        NAV.forEachIndexed { i, item ->
                            NavigationBarItem(
                                selected = st.tab == i,
                                onClick = { vm.setTab(i) },
                                icon = { AppIcon(item.icon, size = 24.dp) },
                                label = { Text(item.label, style = MaterialTheme.typography.labelMedium) },
                                colors = navColors,
                            )
                        }
                    }
                }
            }
        },
    ) { pad ->
        Row(Modifier.padding(pad).consumeWindowInsets(pad).imePadding().fillMaxSize()) {
            if (wide) {
                NavigationRail(containerColor = cs.surface) {
                    Spacer(Modifier.height(8.dp))
                    NAV.forEachIndexed { i, item ->
                        NavigationRailItem(
                            selected = st.tab == i,
                            onClick = { vm.setTab(i) },
                            icon = { AppIcon(item.icon, size = 24.dp) },
                            label = { Text(item.label, style = MaterialTheme.typography.labelMedium) },
                            colors = railColors,
                        )
                    }
                }
                VerticalDividerLine()
            }
            // روی صفحه‌ی بزرگ عرض محتوا محدود و وسط‌چین می‌شود تا فرم‌ها کشیده نشوند
            Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
                Box(Modifier.widthIn(max = 720.dp).fillMaxSize()) {
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
        }
    }
    when (val v = st.viewer) {
        is Viewer.Poster -> PosterDialog(v.id, vm)
        is Viewer.Preview -> PreviewDialog(v.id, vm)
        null -> {}
    }
}

// ================================================================== ساخت

/** هزینه‌ی اضافه‌ی جزوه یا پوستر؛ نویسه‌ی LRM باعث می‌شود علامت + در متن راست‌به‌چپ درست کنار عدد بنشیند. */
private const val EXTRA_CREDIT = "\u200E+۱ اعتبار"

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
    val ctx = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) vm.importFiles(uris)
    }
    // عکس مستقیم از دوربین (برای کتاب/جزوه)؛ بدون مجوز CAMERA چون برنامه‌ی دوربین سیستم عکس را می‌گیرد
    var camUri by rememberSaveable { mutableStateOf<Uri?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val u = camUri
        camUri = null
        if (ok && u != null) vm.importFiles(listOf(u))
    }
    fun takePhoto() {
        try {
            val dir = File(ctx.cacheDir, "camera").apply { mkdirs() }
            val now = System.currentTimeMillis()
            dir.listFiles()?.forEach { if (now - it.lastModified() > 3_600_000L) it.delete() } // عکس‌های قدیمی پاک شوند
            val u = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", File(dir, "scan-$now.jpg"))
            camUri = u
            camera.launch(u)
        } catch (e: Exception) {
            vm.toast("باز کردن دوربین ممکن نشد")
        }
    }
    LaunchedEffect(st.extractedText) {
        val t = st.extractedText
        if (t != null) {
            form.source = if (form.source.isBlank()) t else form.source.trimEnd() + "\n\n" + t
            sourceOpen = true
            vm.consumeExtracted()
        }
    }
    // متن کوتاهِ پیاده‌شده‌ی ویس/فایل صوتی: اگر موضوع خالی است همان موضوع می‌شود، وگرنه به منبع اضافه می‌شود
    LaunchedEffect(st.extractedTopic) {
        val t = st.extractedTopic
        if (t != null) {
            if (form.topic.isBlank()) form.topic = t
            else {
                form.source = if (form.source.isBlank()) t else form.source.trimEnd() + "\n\n" + t
                sourceOpen = true
            }
            vm.consumeExtractedTopic()
        }
    }
    // ورودی صوتی موضوع: پنجره‌ی تشخیص گفتار خودِ سیستم (RecognizerIntent) باز می‌شود؛ چون ضبط را سیستم انجام می‌دهد، مجوز RECORD_AUDIO لازم نیست
    val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK) {
            val said = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim().orEmpty()
            if (said.isNotEmpty()) form.topic = if (form.topic.isBlank()) said else form.topic.trimEnd() + " " + said
        }
    }
    fun speakTopic() {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fa-IR")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "fa-IR")
            putExtra(RecognizerIntent.EXTRA_PROMPT, "موضوع ارائه را بگویید…")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try {
            voice.launch(i)
        } catch (e: ActivityNotFoundException) {
            vm.toast("تشخیص گفتار روی این گوشی نصب نیست؛ از میکروفونِ صفحه‌کلید استفاده کنید")
        } catch (e: Exception) {
            vm.toast("باز کردن تشخیص گفتار ممکن نشد")
        }
    }
    val job = st.job
    val running = job != null && !job.done && !job.failed
    val s = me.settings
    val firstName = me.name.trim().split(" ").firstOrNull().orEmpty()

    // با شروع ساخت، صفحه به بالا می‌رود تا کارت «در حال ساخت» دیده شود
    val scroll = rememberScrollState()
    LaunchedEffect(job?.id) { if (job != null) scroll.animateScrollTo(0) }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(bottom = 112.dp)) {
            ScreenHeader(
                title = if (firstName.isBlank()) "سلام 👋" else "سلام $firstName 👋",
                subtitle = "امروز چه ارائه‌ای بسازیم؟",
                trailing = { CreditPill(me) { vm.setTab(3) } },
            )
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (job != null) JobCard(job, vm, st.config?.pdf == true, st.files.firstOrNull { it.id == job.id }?.extras.orEmpty(), st.extraJobs)

                // موضوع
                SurfaceCard {
                    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            IconTile(AppIcons.Sparkles, LocalExtra.current.brand, 36.dp)
                            Text("موضوع ارائه", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            IconButton(onClick = { speakTopic() }, enabled = !running) {
                                AppIcon(AppIcons.Mic, tint = if (running) cs.onSurfaceVariant else cs.primary, description = "گفتن موضوع با صدا")
                            }
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
                            Text("ارائه را بر پایه‌ی متن، PDF، Word، عکس یا لینک بسازید", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
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
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                SoftButton(
                                    "افزودن فایل",
                                    {
                                        val types = arrayOf("application/pdf", "image/*", DocReader.DOCX_MIME, DocReader.PPTX_MIME, DocReader.XLSX_MIME, "text/*", "application/json", "application/octet-stream")
                                        picker.launch(if (cfg.voice) types + "audio/*" else types)
                                    },
                                    Modifier.weight(1f), enabled = !running && st.extractBusy == null, icon = AppIcons.Attach,
                                )
                                SoftButton(
                                    "دوربین", { takePhoto() },
                                    Modifier.weight(1f), enabled = !running && st.extractBusy == null, icon = AppIcons.Camera,
                                )
                            }
                            Text(
                                "PDF، عکس، Word، PowerPoint، Excel، HTML یا متن (txt, csv, json)" + (if (cfg.voice) " یا فایل صوتی (ویس)" else "") + "؛ چند فایل را می‌توانید با هم انتخاب کنید.",
                                style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
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
                            Text("اسلاید حاوی تصویر باشد؟", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            Text(if (s.images) "بله" else "خیر", style = MaterialTheme.typography.titleSmall, color = cs.primary)
                        }
                        Segmented(
                            options = listOf(true, false), selected = s.images, label = { if (it) "بله" else "خیر" },
                            onSelect = { v -> vm.setSetting("images", v) },
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
                        checked = form.handout, badge = EXTRA_CREDIT, onChange = { form.handout = it },
                    )
                    if (cfg.poster) {
                        HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(horizontal = 16.dp))
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("پوستر (تصویر خلاصه‌ی ارائه)", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                Pill(EXTRA_CREDIT, cs.secondaryContainer, cs.onSecondaryContainer)
                            }
                            Segmented(
                                options = listOf("", "wide", "tall"), selected = form.poster,
                                label = { when (it) { "wide" -> "افقی"; "tall" -> "عمودی"; else -> "بدون پوستر" } },
                                onSelect = { form.poster = it },
                            )
                        }
                    }
                    // اسلاید صوتی و پادکست (فقط وقتی سرور فعالشان کرده)؛ پیش‌فرض خاموش، هرکدام ۱ اعتبار جدا
                    if (cfg.audio) {
                        HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(horizontal = 16.dp))
                        ToggleRow(
                            title = "اسلاید صوتی", subtitle = "صدای گوینده داخل هر اسلاید", icon = AppIcons.Slides,
                            checked = form.audio, badge = EXTRA_CREDIT, onChange = { form.audio = it },
                        )
                        HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(horizontal = 16.dp))
                        ToggleRow(
                            title = "پادکست", subtitle = "گفت‌وگوی دونفره درباره‌ی موضوع ارائه", icon = AppIcons.Mic,
                            checked = form.podcast, badge = EXTRA_CREDIT, onChange = { form.podcast = it },
                        )
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
                onClick = { vm.generate(form.topic, s.slides, form.handout, form.source, (if (cfg.poster) form.poster.ifEmpty { null } else null), s.images, cfg.audio && form.audio, cfg.audio && form.podcast) },
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

/**
 * دکمه‌های «ساخت جداگانه» زیر ارائه: فقط همراه‌هایی که هنوز برای همین ارائه ساخته نشده‌اند (kinds از فهرست فایل‌های سرور می‌آید)؛
 * هر کدام ۱ اعتبار جدا. همراه‌هایی که الان در حال ساخت‌اند به‌جای دکمه، پیام وضعیت دارند.
 */
@Composable
private fun ExtraButtons(deckId: String, title: String, kinds: List<String>, jobs: Map<String, ExtraProg>, vm: AppViewModel, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val pending = EXTRA_KINDS.filter { "$deckId|$it" in jobs }
    val show = EXTRA_KINDS.filter { it in kinds && it !in pending }
    if (show.isEmpty() && pending.isEmpty()) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        pending.forEach { k ->
            val name = when (k) { "poster" -> "🖼 پوستر"; "handout" -> "📝 جزوه"; "audio" -> "🔊 اسلاید صوتی"; else -> "🎙 پادکست" }
            val jp = jobs["$deckId|$k"] ?: ExtraProg("")
            // اسلاید صوتی و پادکست درصد واقعی دارند (نوار)؛ پوستر و جزوه فقط پیام متنی
            if (k == "audio" || k == "podcast") ExtraProgressRow(name, jp.msg, jp.pct)
            else Text("$name: ${jp.msg}", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        if (show.isNotEmpty()) {
            Text("ساخت جداگانه برای همین ارائه (هر مورد ۱ اعتبار):", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                show.forEach { k ->
                    when (k) {
                        "audio" -> SoftButton("اسلاید صوتی", { vm.makeExtra(deckId, title, "audio") }, icon = AppIcons.Slides)
                        "podcast" -> SoftButton("پادکست", { vm.makeExtra(deckId, title, "podcast") }, icon = AppIcons.Mic)
                        "handout" -> SoftButton("جزوه (Word)", { vm.makeExtra(deckId, title, "handout") }, icon = AppIcons.Doc)
                        "poster" -> {
                            SoftButton("پوستر افقی", { vm.makeExtra(deckId, title, "poster", "wide") }, icon = AppIcons.Image)
                            SoftButton("پوستر عمودی", { vm.makeExtra(deckId, title, "poster", "tall") }, icon = AppIcons.Image)
                        }
                        else -> {}
                    }
                }
            }
        }
    }
}

/**
 * ردیف پیشرفت اسلاید صوتی / پادکست: عنوان + درصد، نوار، و پیام وضعیت سرور (مثلاً «در حال ساخت صدا… اسلاید ۳ از ۱۰»).
 * pct < 0 یعنی هنوز در صف: نوار نامعین. همین درصد در اعلان پیشرفت (Notifier) هم نشان داده می‌شود.
 */
@Composable
private fun ExtraProgressRow(title: String, msg: String, pct: Int, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(title, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            if (pct >= 0) Text(pct.fa() + "٪", style = MaterialTheme.typography.labelLarge, color = cs.primary, fontWeight = FontWeight.Bold)
        }
        if (pct < 0) LinearProgressIndicator(Modifier.fillMaxWidth().clip(CircleShape))
        else {
            val shown by animateFloatAsState(pct / 100f, tween(600), label = "extraProgress")
            LinearProgressIndicator(progress = { shown }, modifier = Modifier.fillMaxWidth().clip(CircleShape))
        }
        Text(msg.ifBlank { "در صف است…" }, color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
}

/** زمان‌سنج ساخت («⏱ ۱:۰۵») که هر ثانیه به‌روز می‌شود؛ startedAt بر پایه‌ی SystemClock.elapsedRealtime() است. */
@Composable
private fun JobElapsed(startedAt: Long) {
    val now by produceState(android.os.SystemClock.elapsedRealtime(), startedAt) {
        while (true) { value = android.os.SystemClock.elapsedRealtime(); delay(1000) }
    }
    val t = ((now - startedAt) / 1000).coerceAtLeast(0)
    Text("⏱ " + (t / 60).toInt().fa() + ":" + (t % 60).toInt().toString().padStart(2, '0').faStr(), style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.85f))
}

@Composable
private fun JobCard(job: JobState, vm: AppViewModel, pdf: Boolean = false, extras: List<String> = emptyList(), extraJobs: Map<String, ExtraProg> = emptyMap()) {
    val cs = MaterialTheme.colorScheme
    val ex = LocalExtra.current
    when {
        job.failed -> SurfaceCard(color = cs.errorContainer, borderColor = null) {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AppIcon(AppIcons.Warning, tint = cs.error)
                Text(job.message, color = cs.onErrorContainer, modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.dismissJob() }) { AppIcon(AppIcons.Close, tint = cs.onErrorContainer, size = 20.dp, description = "بستن پیام") }
            }
        }
        job.done -> SurfaceCard {
            var shareOpen by remember(job.id) { mutableStateOf(false) }
            if (shareOpen) {
                ShareDialog(canPdf = pdf, onDismiss = { shareOpen = false }) { pkg, asPdf ->
                    shareOpen = false
                    val cap = shareCaption(job.title)
                    if (asPdf) vm.downloadPdf(job.id, share = true, pkg = pkg, caption = cap) else vm.download(job.id, share = true, pkg = pkg, caption = cap)
                }
            }
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(ex.successBg), contentAlignment = Alignment.Center) {
                        AppIcon(AppIcons.Check, tint = ex.success, size = 22.dp)
                    }
                    Column(Modifier.weight(1f)) {
                        Text("ارائه آماده شد", style = MaterialTheme.typography.labelMedium, color = ex.success)
                        Text(job.title.ifEmpty { "ارائه‌ی شما" }, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = { vm.dismissJob() }) { AppIcon(AppIcons.Close, tint = cs.onSurfaceVariant, size = 20.dp, description = "بستن") }
                }
                GradientButton("دانلود ارائه (PPTX)", { vm.download(job.id) }, Modifier.fillMaxWidth(), icon = AppIcons.Download)
                SoftButton("ارسال در تلگرام، ایتا، واتساپ…", { shareOpen = true }, Modifier.fillMaxWidth(), icon = AppIcons.Share)
                SoftButton("پیش‌نمایش اسلایدها", { vm.openViewer(Viewer.Preview(job.id)) }, Modifier.fillMaxWidth(), icon = AppIcons.Eye)
                if (pdf) SoftButton("دانلود نسخه‌ی PDF", { vm.downloadPdf(job.id) }, Modifier.fillMaxWidth(), icon = AppIcons.Doc)
                job.handoutId?.let { hid -> SoftButton("دانلود جزوه (Word)", { vm.download(hid) }, Modifier.fillMaxWidth(), icon = AppIcons.Doc) }
                job.posterId?.let { pid -> SoftButton("نمایش پوستر", { vm.openViewer(Viewer.Poster(pid)) }, Modifier.fillMaxWidth(), icon = AppIcons.Image) }
                if (job.posterFailed) Text("ساخت پوستر ناموفق بود؛ ارائه‌ی شما سالم است.", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                // اسلاید صوتی و پادکست: چند دقیقه بعد از ارائه آماده می‌شوند؛ تا آن موقع پیام «در حال ساخت»، بعد دکمه‌های دانلود
                if (job.audioWaiting) ExtraProgressRow("🔊 اسلاید صوتی", job.audioMsg.ifBlank { "در حال ساخت است (چند دقیقه)…" }, job.audioPct)
                job.audioIds.forEachIndexed { i, aid ->
                    SoftButton(if (i == 0) "دانلود اسلاید صوتی" else "دانلود بخش " + (i + 1).fa(), { vm.download(aid) }, Modifier.fillMaxWidth(), icon = AppIcons.Slides)
                }
                if (job.audioFailed) Text("ساخت اسلاید صوتی ناموفق بود؛ اعتبارش برگشت.", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                if (job.podcastWaiting) ExtraProgressRow("🎙 پادکست", job.podcastMsg.ifBlank { "در حال ساخت است (چند دقیقه)…" }, job.podcastPct)
                if (job.audioWaiting || job.podcastWaiting) Text("می‌توانید اپ را ببندید؛ آماده شد با اعلان خبرتان می‌کنیم.", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                job.podcastIds.forEachIndexed { i, pid ->
                    PodcastPlayerCard(pid, job.title.ifEmpty { "پادکست" } + (if (job.podcastIds.size > 1) " — قسمت " + (i + 1).fa() else ""))
                    SoftButton(if (i == 0) "دانلود پادکست" else "دانلود پادکست — قسمت " + (i + 1).fa(), { vm.download(pid) }, Modifier.fillMaxWidth(), icon = AppIcons.Mic)
                }
                if (job.podcastFailed) Text("ساخت پادکست ناموفق بود؛ اعتبارش برگشت.", color = cs.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                // همراه‌هایی که همراه ارائه نخواسته بودید (یا ساخته نشدند): با دکمه جدا بسازید؛ بعد از ساخت، دکمه‌ی همان نوع می‌رود
                ExtraButtons(job.id, job.title, extras, extraJobs, vm)
            }
        }
        else -> Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(ex.brand).padding(18.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("در حال ساخت ارائه…", style = MaterialTheme.typography.titleMedium, color = Color.White, modifier = Modifier.weight(1f))
                    if (job.startedAt > 0L) JobElapsed(job.startedAt)
                }
                // نوار مرحله‌ای: ۱ سرفصل‌ها ← ۲ محتوا ← ۳ فایل (مرحله ۰ = هنوز در صف: نوار نامعلوم)
                val step = job.step.coerceIn(0, 3)
                val target = listOf(0f, 0.15f, 0.45f, 0.80f)[step] + if (job.extra) 0.12f else 0f
                val shown by animateFloatAsState(target, tween(600), label = "jobProgress")
                if (step == 0) LinearProgressIndicator(Modifier.fillMaxWidth().clip(CircleShape), color = Color.White, trackColor = Color.White.copy(alpha = 0.3f))
                else LinearProgressIndicator(progress = { shown }, modifier = Modifier.fillMaxWidth().clip(CircleShape), color = Color.White, trackColor = Color.White.copy(alpha = 0.3f))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    listOf("۱ · سرفصل‌ها", "۲ · محتوا", "۳ · فایل").forEachIndexed { i, t ->
                        val on = step == i + 1
                        Text(t, style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = if (on) 1f else 0.6f), fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
                    }
                }
                Text(job.message, color = Color.White.copy(alpha = 0.95f), style = MaterialTheme.typography.bodyMedium)
                Text("می‌توانید اپ را ببندید؛ وقتی ارائه آماده شد با اعلان خبرتان می‌کنیم.", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall)
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
            title = "فایل‌های من", subtitle = "ارائه‌های ۲۴ ساعت اخیر و نسخه‌های روی گوشی",
            trailing = {
                IconButton(onClick = { vm.loadFiles() }, enabled = !st.filesLoading) {
                    if (st.filesLoading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else AppIcon(AppIcons.Refresh, tint = cs.onSurfaceVariant, description = "تازه‌سازی فهرست")
                }
            },
        )
        if (st.filesError && st.files.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp)
                    .background(cs.errorContainer, RoundedCornerShape(14.dp)).padding(start = 14.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("اتصال برقرار نشد؛ فهرست ذخیره‌شده را می‌بینید.", Modifier.weight(1f), color = cs.onErrorContainer, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { vm.loadFiles() }, enabled = !st.filesLoading) { Text("تلاش دوباره") }
            }
        }
        // فایل‌هایی که از سرور پاک شده‌اند (بعد از ۲۴ ساعت) ولی نسخه‌ی محلی‌شان روی گوشی مانده
        val localIds = st.localFiles.map { it.id }.toSet()
        val localOnly = st.localFiles.filter { lf -> st.files.none { it.id == lf.id } }
        val nothing = st.files.isEmpty() && localOnly.isEmpty()
        when {
            st.filesLoading && nothing ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            nothing && st.filesError ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(
                        AppIcons.Warning, "اتصال برقرار نشد",
                        "اینترنت خود را بررسی کنید و دوباره تلاش کنید.",
                        "تلاش دوباره", { vm.loadFiles() },
                    )
                }
            nothing ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(
                        AppIcons.Folder, "هنوز فایلی نساخته‌اید",
                        "ارائه‌هایی که می‌سازید تا ۲۴ ساعت اینجا می‌مانند و می‌توانید دانلودشان کنید.",
                        "ساخت اولین ارائه", { vm.setTab(0) },
                    )
                }
            else -> PullToRefreshBox(
                isRefreshing = st.filesLoading, onRefresh = { vm.loadFiles() }, modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize(),
                ) {
                    items(st.files, key = { it.id }) { f -> FileRow(f, vm, f.id in localIds, st.config?.pdf == true, st.extraJobs) }
                    if (localOnly.isNotEmpty()) {
                        item(key = "local-header") {
                            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                SectionTitle("ذخیره‌شده روی گوشی")
                                Text(
                                    "این فایل‌ها از سرور پاک شده‌اند ولی نسخه‌ی آن‌ها روی همین گوشی مانده است.",
                                    style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp),
                                )
                            }
                        }
                        items(localOnly, key = { "local-" + it.id }) { lf -> LocalFileRow(lf, vm) }
                    }
                }
            }
        }
    }
}

@Composable
private fun FileRow(f: FileItem, vm: AppViewModel, onPhone: Boolean = false, pdf: Boolean = false, extraJobs: Map<String, ExtraProg> = emptyMap()) {
    val cs = MaterialTheme.colorScheme
    var showPlayer by remember(f.id) { mutableStateOf(false) }
    var shareOpen by remember(f.id) { mutableStateOf(false) }
    val (icon, brush) = when {
        f.poster -> AppIcons.Image to Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFFEC4899)))
        f.handout -> AppIcons.Doc to Brush.linearGradient(listOf(Color(0xFFF59E0B), Color(0xFFF97316)))
        f.audio == "podcast" -> AppIcons.Mic to Brush.linearGradient(listOf(Color(0xFF0EA5E9), Color(0xFF6366F1)))
        f.audio == "slides" -> AppIcons.Slides to Brush.linearGradient(listOf(Color(0xFF14B8A6), Color(0xFF0EA5E9)))
        else -> AppIcons.Slides to LocalExtra.current.brand
    }
    val kind = when {
        f.poster -> "پوستر"
        f.handout -> "جزوه‌ی Word"
        f.audio == "podcast" -> "پادکست"
        f.audio == "slides" -> if (f.slides > 0) "اسلاید صوتی • " + f.slides.fa() + " اسلاید" else "صدای یک اسلاید"
        else -> f.slides.fa() + " اسلاید"
    }
    SurfaceCard {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconTile(icon, brush, 46.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(f.title.ifBlank { "بدون عنوان" }, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOf(kind, fmtDate(f.t), if (onPhone) "روی گوشی ✓" else "").filter { it.isNotEmpty() }.joinToString(" • "),
                    style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                )
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End)) {
            if (f.poster) {
                IconButton(onClick = { vm.openViewer(Viewer.Poster(f.id)) }) { AppIcon(AppIcons.Eye, tint = cs.onSurfaceVariant, description = "نمایش پوستر") }
            } else if (!f.handout && f.audio.isEmpty()) {
                IconButton(onClick = { vm.openViewer(Viewer.Preview(f.id)) }) { AppIcon(AppIcons.Eye, tint = cs.onSurfaceVariant, description = "پیش‌نمایش اسلایدها") }
            }
            if (pdf && !f.poster && !f.handout && f.audio.isEmpty()) {
                TextButton(onClick = { vm.downloadPdf(f.id) }, contentPadding = PaddingValues(horizontal = 8.dp)) { Text("PDF") }
            }
            if (f.audio == "podcast") {
                IconButton(onClick = { showPlayer = !showPlayer }) { AppIcon(if (showPlayer) AppIcons.Close else PLAY_ICON, tint = cs.primary, description = if (showPlayer) "بستن پلیر" else "پخش پادکست") }
            }
            IconButton(onClick = { shareOpen = true }) { AppIcon(AppIcons.Share, tint = cs.onSurfaceVariant, description = "ارسال") }
            FilledTonalIconButton(onClick = { vm.download(f.id) }) { AppIcon(AppIcons.Download, size = 22.dp, description = "دانلود") }
        }
        }
        if (f.audio == "podcast" && showPlayer) {
            PodcastPlayerCard(f.id, f.title, Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp), autoStart = true)
        }
        // فقط زیر خودِ ارائه (نه پوستر/جزوه/صدا)؛ همراه‌های ساخته‌شده یا در حال ساخت دکمه ندارند
        if (!f.poster && !f.handout && f.audio.isEmpty()) {
            ExtraButtons(f.id, f.title, f.extras, extraJobs, vm, Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp))
        }
    }
    if (shareOpen) {
        ShareDialog(
            canPdf = pdf && !f.poster && !f.handout && f.audio.isEmpty(),
            onDismiss = { shareOpen = false },
        ) { pkg, asPdf ->
            shareOpen = false
            val cap = shareCaption(f.title)
            if (asPdf) vm.downloadPdf(f.id, share = true, pkg = pkg, caption = cap) else vm.download(f.id, share = true, pkg = pkg, caption = cap)
        }
    }
}

/** ردیف فایلی که فقط نسخه‌ی محلی‌اش مانده (پیش‌نمایش نیاز به سرور دارد، پس نیست). */
@Composable
private fun LocalFileRow(f: LocalFile, vm: AppViewModel) {
    val cs = MaterialTheme.colorScheme
    var confirm by remember { mutableStateOf(false) }
    var shareOpen by remember(f.id) { mutableStateOf(false) }
    var showPlayer by remember(f.id) { mutableStateOf(false) }
    val (icon, brush) = when (f.kind) {
        "poster" -> AppIcons.Image to Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFFEC4899)))
        "handout" -> AppIcons.Doc to Brush.linearGradient(listOf(Color(0xFFF59E0B), Color(0xFFF97316)))
        "podcast" -> AppIcons.Mic to Brush.linearGradient(listOf(Color(0xFF0EA5E9), Color(0xFF6366F1)))
        "audio" -> AppIcons.Slides to Brush.linearGradient(listOf(Color(0xFF14B8A6), Color(0xFF0EA5E9)))
        else -> AppIcons.Slides to LocalExtra.current.brand
    }
    val kind = when (f.kind) {
        "poster" -> "پوستر"
        "handout" -> "جزوه‌ی Word"
        "podcast" -> "پادکست"
        "audio" -> "اسلاید صوتی"
        else -> if (f.slides > 0) f.slides.fa() + " اسلاید" else "ارائه"
    }
    SurfaceCard {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconTile(icon, brush, 46.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(f.title.ifBlank { f.name.ifBlank { "بدون عنوان" } }, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOf(kind, fmtDate(f.t)).filter { it.isNotEmpty() }.joinToString(" • "),
                    style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                )
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End)) {
            if (f.kind == "podcast") {
                IconButton(onClick = { showPlayer = !showPlayer }) { AppIcon(if (showPlayer) AppIcons.Close else PLAY_ICON, tint = cs.primary, description = if (showPlayer) "بستن پلیر" else "پخش پادکست") }
            }
            IconButton(onClick = { confirm = true }) { AppIcon(AppIcons.Delete, tint = cs.onSurfaceVariant, description = "حذف از گوشی") }
            IconButton(onClick = { shareOpen = true }) { AppIcon(AppIcons.Share, tint = cs.onSurfaceVariant, description = "ارسال") }
            FilledTonalIconButton(onClick = { vm.download(f.id) }) { AppIcon(AppIcons.Download, size = 22.dp, description = "ذخیره در دانلودها") }
        }
        }
        if (f.kind == "podcast" && showPlayer) {
            PodcastPlayerCard(f.id, f.title.ifBlank { f.name }, Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp), autoStart = true)
        }
    }
    if (shareOpen) {
        ShareDialog(canPdf = false, onDismiss = { shareOpen = false }) { pkg, _ ->
            shareOpen = false
            vm.download(f.id, share = true, pkg = pkg, caption = shareCaption(f.title))
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("حذف از گوشی؟") },
            text = { Text("این فایل از سرور هم پاک شده است؛ بعد از حذف دیگر راهی برای بازگرداندنش نیست.") },
            confirmButton = { TextButton(onClick = { confirm = false; vm.deleteLocal(f.id) }) { Text("حذف") } },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("انصراف") } },
        )
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
                HorizontalDivider(color = cs.outlineVariant, modifier = Modifier.padding(horizontal = 16.dp))
                if (Push.configured) ToggleRow("اعلان‌های اخبار و تخفیف", "اطلاعیه‌ی قابلیت‌های تازه و تخفیف‌ها؛ اعلان «ارائه آماده شد» همیشه روشن می‌ماند", null, st.promo) { vm.setPromo(it) }
                ToggleRow("ذخیره‌ی خودکار روی گوشی", "بعد از ساخت، یک نسخه روی گوشی می‌ماند تا بعد از ۲۴ ساعت هم در دسترس باشد", null, st.autoSave) { vm.setAutoSave(it) }
            }

        }
    }
}

@Composable
private fun ThemeSwatch(o: Opt, selected: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Column(
        Modifier.width(68.dp).clip(RoundedCornerShape(16.dp)).selectable(selected = selected, role = androidx.compose.ui.semantics.Role.RadioButton, onClick = onClick).padding(vertical = 6.dp),
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
    var contactDialog by rememberSaveable { mutableStateOf("") } // "" | "mobile" | "email"
    if (contactDialog.isNotEmpty()) ContactDialog(contactDialog, vm) { contactDialog = "" }
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
                        IconButton(onClick = { nameDialog = true }) { AppIcon(AppIcons.Edit, tint = Color.White, size = 22.dp, description = "ویرایش نام") }
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

            if (cfg != null && cfg.dailyFree > 0 && !me.unlimited && me.planId == null) {
                SurfaceCard(color = ex.warnBg, borderColor = null) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("🎁", fontSize = 22.sp)
                        Text("هر روز " + cfg.dailyFree.fa() + " اعتبار رایگان هدیه می‌گیرید.", color = ex.warn, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            if (me.giftMissing.isNotEmpty()) {
                // ثبت موبایل/ایمیل داخل خود اپ؛ هدیه‌ی هر مورد جدا و یک‌بار است و حساب در همه‌ی پلتفرم‌ها یکی می‌ماند
                SurfaceCard(color = if (me.giftAvailable) ex.warnBg else MaterialTheme.colorScheme.surface, borderColor = null) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (me.giftAvailable && me.giftCredits > 0) {
                            Text(
                                "🎁 با ثبت و تأیید هر مورد، " + me.giftCredits.fa() + " اعتبار هدیه می‌گیرید (برای هر مورد یک‌بار).",
                                color = ex.warn, style = MaterialTheme.typography.bodyMedium,
                            )
                            if (me.giftNote.isNotEmpty()) Text(me.giftNote, color = ex.warn, style = MaterialTheme.typography.bodySmall)
                        } else {
                            Text("اطلاعات تماس", style = MaterialTheme.typography.titleSmall)
                        }
                        if ("mobile" in me.giftMissing && me.mobile.isEmpty()) {
                            OutlinedButton(onClick = { contactDialog = "mobile" }, Modifier.fillMaxWidth()) { Text("📱 ثبت شماره‌ی موبایل") }
                        }
                        if ("email" in me.giftMissing && me.email.isEmpty()) {
                            OutlinedButton(onClick = { contactDialog = "email" }, Modifier.fillMaxWidth()) { Text("✉️ ثبت ایمیل") }
                        }
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
                                { vm.buy(p.id) },
                                Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
                Text(
                    "پرداخت امن از طریق " + Store.NAME_FA + " انجام می‌شود.",
                    style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp),
                )
            }

            ContactCard(vm)

            SoftButton("بررسی به‌روزرسانی (نسخه‌ی " + BuildConfig.VERSION_NAME + ")", { vm.checkUpdate() }, Modifier.fillMaxWidth(), icon = AppIcons.Refresh)
            TextButton(onClick = { vm.openUrl(Api.BASE + "/privacy") }, modifier = Modifier.fillMaxWidth()) { Text("شرایط استفاده و حریم خصوصی") }
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

/** ثبت موبایل (کد پیامکی) یا ایمیل (کد ایمیلی) در پروفایل: ۱) مقدار ← ارسال کد ۲) کد ← تایید. kind: "mobile" | "email" */
@Composable
fun ContactDialog(kind: String, vm: AppViewModel, onClose: () -> Unit) {
    val isMobile = kind == "mobile"
    var value by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var sent by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        shape = RoundedCornerShape(28.dp),
        title = { Text(if (isMobile) "ثبت شماره‌ی موبایل" else "ثبت ایمیل") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = value, onValueChange = { value = it.take(if (isMobile) 16 else 254) }, singleLine = true, enabled = !sent && !busy,
                    shape = RoundedCornerShape(16.dp),
                    placeholder = { Text(if (isMobile) "09123456789" else "name@example.com") },
                    keyboardOptions = KeyboardOptions(keyboardType = if (isMobile) KeyboardType.Phone else KeyboardType.Email),
                )
                if (sent) {
                    Text(if (isMobile) "کد ۶ رقمی پیامک شد؛ آن را وارد کنید." else "کد ۶ رقمی به ایمیلتان فرستاده شد؛ آن را وارد کنید.", style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(
                        value = code, onValueChange = { code = normDigits(it).filter { c -> c.isDigit() }.take(6) }, singleLine = true, enabled = !busy,
                        shape = RoundedCornerShape(16.dp), placeholder = { Text("کد ۶ رقمی") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                    TextButton(onClick = { sent = false; code = "" }, enabled = !busy) { Text(if (isMobile) "تغییر شماره / ارسال دوباره" else "تغییر ایمیل / ارسال دوباره") }
                }
            }
        },
        confirmButton = {
            GradientButton(
                if (sent) "تأیید" else "ارسال کد",
                {
                    busy = true
                    if (!sent) vm.sendContactCode(kind, value) { ok -> busy = false; if (ok) sent = true }
                    else vm.verifyContact(kind, value, code) { ok -> busy = false; if (ok) onClose() }
                },
                Modifier.width(130.dp).height(48.dp), enabled = if (sent) code.length == 6 else value.trim().length >= 5, loading = busy,
            )
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text("انصراف") } },
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

/**
 * پیش‌نمایش اسلایدها را خود سرور به‌صورت صفحه‌ی HTML می‌سازد؛ همین صفحه داخل یک WebView نمایش داده می‌شود.
 * (اندپوینت /img/{n} فقط عکس داخل هر اسلاید را می‌دهد، نه تصویر کل اسلاید؛ پس نمایش بومی نیازمند اندپوینت جدید در سرور است.)
 * سخت‌گیری‌ها: نشانگر بارگذاری، صفحه‌ی خطا با «تلاش دوباره»، فقط دامنه‌ی خود سایت داخل WebView باز می‌شود
 * (لینک‌های بیرونی در برنامه‌ی بیرونی)، و دسترسی به فایل‌های گوشی بسته است.
 */
@Composable
fun PreviewDialog(id: String, vm: AppViewModel) {
    val url = remember(id) {
        Api.syncCookiesToWebView()
        Api.previewUrl(id)
    }
    val ctx = LocalContext.current
    val cs = MaterialTheme.colorScheme
    var web by remember { mutableStateOf<WebView?>(null) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    val ownHost = remember { Uri.parse(Api.BASE).host.orEmpty() }
    Dialog(onDismissRequest = { vm.closeViewer() }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(cs.background).systemBarsPadding()) {
            Row(
                Modifier.fillMaxWidth().background(cs.surface).padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { vm.closeViewer() }) { AppIcon(AppIcons.Close, tint = cs.onSurface, description = "بستن پیش‌نمایش") }
                Text("پیش‌نمایش اسلایدها", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                TextButton(
                    enabled = !loading && !failed,
                    onClick = {
                        web?.let { w ->
                            val pm = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
                            pm.print("presentation", w.createPrintDocumentAdapter("presentation"), PrintAttributes.Builder().build())
                        }
                    },
                ) {
                    AppIcon(AppIcons.Download, size = 18.dp)
                    Spacer(Modifier.width(6.dp))
                    Text("ذخیره PDF")
                }
            }
            HorizontalDivider(color = cs.outlineVariant)
            Box(Modifier.fillMaxSize()) {
                AndroidView(
                    factory = { c ->
                        WebView(c).apply {
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.allowFileAccess = false // در اندروید ۷–۱۰ پیش‌فرض true است
                            settings.allowContentAccess = false
                            settings.setSupportMultipleWindows(false)
                            webViewClient = object : WebViewClient() {
                                override fun onPageStarted(view: WebView?, u: String?, favicon: Bitmap?) {
                                    loading = true
                                    failed = false
                                }

                                override fun onPageFinished(view: WebView?, u: String?) {
                                    loading = false
                                }

                                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                                    if (request?.isForMainFrame == true) {
                                        failed = true
                                        loading = false
                                    }
                                }

                                override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
                                    if (request?.isForMainFrame == true && (errorResponse?.statusCode ?: 0) >= 400) {
                                        failed = true
                                        loading = false
                                    }
                                }

                                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                    val target = request?.url ?: return true
                                    val scheme = target.scheme.orEmpty()
                                    if (scheme == "https" && target.host == ownHost) return false
                                    // لینک بیرونی داخل خود پیش‌نمایش (و کوکی نشست) باز نمی‌شود؛ فقط http/https/mailto به برنامه‌ی بیرونی داده می‌شود
                                    // (schemeهای دیگر مثل intent: یا file: هرگز اجرا نمی‌شوند)
                                    if (scheme == "https" || scheme == "http" || scheme == "mailto") {
                                        try {
                                            ctx.startActivity(Intent(Intent.ACTION_VIEW, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                                        } catch (_: Exception) {
                                        }
                                    }
                                    return true
                                }
                            }
                            loadUrl(url)
                        }.also { web = it }
                    },
                    onRelease = { it.destroy() },
                    modifier = Modifier.fillMaxSize(),
                )
                if (loading && !failed) {
                    LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
                }
                if (failed) {
                    Box(Modifier.fillMaxSize().background(cs.background), contentAlignment = Alignment.Center) {
                        EmptyState(
                            AppIcons.Warning, "پیش‌نمایش باز نشد",
                            "اینترنت خود را بررسی کنید. اگر ارائه بیش از ۲۴ ساعت پیش ساخته شده، دیگر در سرور نیست.",
                            "تلاش دوباره",
                            {
                                failed = false
                                loading = true
                                Api.syncCookiesToWebView()
                                web?.loadUrl(url)
                            },
                        )
                    }
                }
            }
        }
    }
}
