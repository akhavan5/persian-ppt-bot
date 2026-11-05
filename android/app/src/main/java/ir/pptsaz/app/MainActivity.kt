package ir.pptsaz.app

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.core.app.NotificationManagerCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** ذخیره‌ی فایل با انتخاب مقصد توسط کاربر؛ ورودی: (نوع فایل، نام پیشنهادی). */
private class CreateDocWithMime : ActivityResultContract<Pair<String, String>, Uri?>() {
    override fun createIntent(context: Context, input: Pair<String, String>): Intent =
        Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(input.first)
            .putExtra(Intent.EXTRA_TITLE, input.second)

    override fun parseResult(resultCode: Int, intent: Intent?): Uri? =
        if (resultCode == Activity.RESULT_OK) intent?.data else null
}

class MainActivity : ComponentActivity() {
    companion object {
        /** اکشن‌های میان‌بر (res/xml/shortcuts.xml) */
        const val ACTION_NEW_DECK = "ir.pptsaz.app.action.NEW_DECK"
        const val ACTION_FILES = "ir.pptsaz.app.action.FILES"
    }

    private val vm: AppViewModel by viewModels()
    private lateinit var billing: BazaarBilling

    // خواندن خودکار کد پیامکی؛ باید در ساخت Activity ثبت شود
    private val sms = SmsConsent(this) { code -> vm.onSmsCode(code) }

    private var notifHintShown = false
    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (!ok && !notifHintShown) {
            notifHintShown = true
            vm.notifHint()
        }
    }

    private var pendingSave: Saved? = null
    private val saveAs = registerForActivityResult(CreateDocWithMime()) { dest ->
        val src = pendingSave
        pendingSave = null
        if (dest != null && src != null) {
            lifecycleScope.launch {
                try {
                    withContext(Dispatchers.IO) { Storage.copyTo(this@MainActivity, src.uri, dest) }
                    vm.toast("ذخیره شد ✓")
                } catch (e: Exception) {
                    vm.toast("ذخیره‌ی فایل انجام نشد")
                }
            }
        }
    }

    /**
     * اگر اعلان‌ها خاموش‌اند: در اندروید ۱۳+ فقط یک بار مجوز را می‌پرسد (درست بعد از اولین ساخت)؛
     * بعد از آن (و در نسخه‌های قدیمی‌تر) یک بار در هر اجرا راهنمایی با دکمه‌ی «فعال‌سازی» نشان می‌دهد.
     */
    private fun askNotifications() {
        if (NotificationManagerCompat.from(this).areNotificationsEnabled()) return
        val p = getSharedPreferences("prefs", MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= 33 && !p.getBoolean("asked_notif", false)) {
            p.edit().putBoolean("asked_notif", true).apply()
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        if (!notifHintShown) {
            notifHintShown = true
            vm.notifHint()
        }
    }

    private fun openNotificationSettings() {
        val i = if (Build.VERSION.SDK_INT >= 26) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
        }
        try { startActivity(i) } catch (_: Exception) {}
    }

    private fun openFile(f: Saved): Boolean = try {
        startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(f.uri, f.mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    /** pkg != null: مستقیم به همان برنامه (تلگرام، ایتا، واتساپ …) می‌فرستد؛ اگر نصب نبود یا قبول نکرد، فهرست سیستم باز می‌شود. */
    private fun shareFile(f: Saved, pkg: String? = null, caption: String = "") {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = f.mime
            putExtra(Intent.EXTRA_STREAM, f.uri)
            if (caption.isNotBlank()) putExtra(Intent.EXTRA_TEXT, caption)
            clipData = ClipData.newRawUri(f.name, f.uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (pkg != null) {
            try {
                startActivity(Intent(send).setPackage(pkg))
                return
            } catch (_: ActivityNotFoundException) {
                // برنامه‌ی انتخابی فایل را نمی‌پذیرد؛ به فهرست سیستم برمی‌گردیم
            }
        }
        try { startActivity(Intent.createChooser(send, "اشتراک‌گذاری")) } catch (e: ActivityNotFoundException) { vm.toast("برنامه‌ای برای اشتراک‌گذاری پیدا نشد") }
    }

    @Suppress("DEPRECATION")
    private fun streamUri(i: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else i.getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun streamUris(i: Intent): List<Uri> =
        (if (Build.VERSION.SDK_INT >= 33) i.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else i.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM))
            ?.filterNotNull().orEmpty()

    /**
     * لینک برنامه: https://pptsaz.ir/open?topic=<موضوع>&tab=files|settings|account
     * موضوع فقط در فرم «ساخت» گذاشته می‌شود و شروع ساخت با خود کاربر است. مسیرهای دیگر (مثلاً گالری عمومی) را بعداً همین‌جا اضافه کن.
     */
    private fun handleWebLink(d: Uri) {
        if (d.path?.trimEnd('/') != "/open") return
        val tab = when (d.getQueryParameter("tab")) {
            "files" -> 1
            "settings" -> 2
            "account" -> 3
            else -> 0
        }
        vm.openFromLink(d.getQueryParameter("topic"), tab)
    }

    /** صفحه‌ی ثبت امتیاز و نظر همین اپ در فروشگاه (بازار یا مایکت)؛ اگر فروشگاه نصب نبود false. */
    private fun openStoreRating(): Boolean = try {
        startActivity(StoreRating.intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    /** اشتراک‌گذاری از برنامه‌های دیگر، باز شدن از روی اعلان (tab / job_action) و دکمه‌های اعلان. */
    private fun handleIntent(i: Intent?) {
        if (i == null) return
        // اعلان تبلیغاتی با لینک: https را در مرورگر باز می‌کند
        i.getStringExtra("push_url")?.let { u ->
            i.removeExtra("push_url")
            if (u.startsWith("https://")) vm.openUrl(u)
        }
        // یادآور محلی با موضوع نمونه: فقط اگر فرم خالی است (پیش‌نویس کاربر پاک نشود)
        i.getStringExtra("rem_topic")?.let { t ->
            i.removeExtra("rem_topic")
            if (vm.form.topic.isBlank()) vm.form.topic = t
        }
        val tab = i.getIntExtra("tab", -1)
        if (tab in 0..3) {
            vm.setTab(tab)
            i.removeExtra("tab")
        }

        // --- اعلان «ارائه آماده شد»: باز کردن کارت همان ارائه، یا دکمه‌های «دانلود» / «پیش‌نمایش» روی اعلان
        val jobAction = i.getStringExtra("job_action")
        if (jobAction != null) {
            val id = i.getStringExtra("job_id").orEmpty()
            val nid = i.getIntExtra("nid", 0)
            if (nid != 0) NotificationManagerCompat.from(this).cancel(nid)
            if (id.isNotEmpty()) {
                vm.setTab(0)
                vm.showJob(id)
                when (jobAction) {
                    "download" -> vm.download(id)
                    "preview" -> vm.openViewer(Viewer.Preview(id))
                }
            }
            i.removeExtra("job_action")
        }

        when (i.action) {
            // میان‌برهای نگه‌داشتن آیکن
            ACTION_NEW_DECK -> {
                vm.setTab(0)
                i.action = null
            }
            ACTION_FILES -> {
                vm.setTab(1)
                i.action = null
            }
            // «ساخت ارائه با پاورپوینت‌ساز» از منوی انتخاب متن؛ مثل اشتراک‌گذاری متن به منبع اضافه می‌شود (لینک → خواندن صفحه)
            Intent.ACTION_PROCESS_TEXT -> {
                val text = i.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.trim().orEmpty()
                if (text.isNotEmpty()) vm.onShare(Share.TextShare(text))
                i.action = null
            }
            // بازگشت از ورود گوگل در مرورگر: pptsaz://login?c=<کد>  |  لینک برنامه (App Link): https://pptsaz.ir/open?...
            Intent.ACTION_VIEW -> {
                val d = i.data
                if (d != null && d.scheme == "pptsaz" && d.host == "login") vm.googleReturn(d.getQueryParameter("c"), d.getQueryParameter("e"))
                else if (d != null && d.scheme == "https" && d.host == "pptsaz.ir") handleWebLink(d)
                i.action = null
            }
            Intent.ACTION_SEND -> {
                val uri = streamUri(i)
                val text = i.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim().orEmpty()
                when {
                    uri != null -> vm.onShare(Share.FileShare(listOf(uri))) // PDF، عکس، Word یا فایل متنی
                    text.isNotEmpty() -> vm.onShare(Share.TextShare(text))
                }
                i.action = null // با چرخش صفحه دوباره پردازش نشود
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val uris = streamUris(i)
                if (uris.isNotEmpty()) vm.onShare(Share.FileShare(uris))
                i.action = null
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        AppForeground.count++
        Reminders.onOpen(this)
    }

    override fun onStop() {
        AppForeground.count = (AppForeground.count - 1).coerceAtLeast(0)
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // اسپلش سیستم فقط یک پس‌زمینه‌ی ساده است (بدون آیکن) و بلافاصله به LoadingScreen می‌رسد؛ فقط یک اسپلش دیده می‌شود
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleIntent(intent)
        billing = BazaarBilling(this) { ok -> vm.setBazaarReady(ok) }
        billing.connect()
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                AppTheme {
                    val st by vm.state.collectAsState()
                    val ctx = LocalContext.current
                    val snack = remember { SnackbarHostState() }
                    val scope = rememberCoroutineScope()
                    // فایل ذخیره‌شده در حافظه‌ی اختصاصی اپ (اندروید ۷–۹): پرسیدن «باز کردن» یا «ذخیره در گوشی»
                    var saveDialog by remember { mutableStateOf<Saved?>(null) }

                    fun say(msg: String) {
                        scope.launch {
                            snack.currentSnackbarData?.dismiss()
                            snack.showSnackbar(msg, duration = SnackbarDuration.Long)
                        }
                    }

                    /** پیام همراه با یک دکمه؛ اگر کاربر دکمه را زد onAction اجرا می‌شود. */
                    fun sayAction(msg: String, label: String, onAction: () -> Unit) {
                        scope.launch {
                            snack.currentSnackbarData?.dismiss()
                            val r = snack.showSnackbar(msg, actionLabel = label, duration = SnackbarDuration.Long)
                            if (r == SnackbarResult.ActionPerformed) onAction()
                        }
                    }

                    LaunchedEffect(Unit) {
                        vm.events.collect { e ->
                            when (e) {
                                is Event.Toast -> say(e.msg)
                                Event.AskNotify -> askNotifications()
                                Event.NotifHint -> sayAction(
                                    "اعلان‌ها خاموش است؛ برای خبردار شدن از آماده‌شدن ارائه، فعالشان کنید.", "فعال‌سازی",
                                ) { openNotificationSettings() }
                                Event.BillingReconnect -> {
                                    billing.disconnect()
                                    billing.connect()
                                }
                                is Event.BazaarBuy -> billing.unconsumed { list ->
                                    val owned = list.filter { it.first.startsWith("plan_") }
                                    if (owned.isNotEmpty()) {
                                        // پرداخت قبلی هنوز تایید/مصرف نشده؛ اول همان فعال می‌شود (بازار اجازه‌ی خرید دوباره‌ی محصول مصرف‌نشده را نمی‌دهد)
                                        say("خرید قبلی شما هنوز فعال نشده بود؛ در حال فعال‌سازی…")
                                        owned.forEach { (sku, token) ->
                                            vm.bazaarClaim(sku, token) { ok -> if (ok) billing.consume(token) }
                                        }
                                    } else {
                                        startPurchase(e.sku) { m -> say(m) }
                                    }
                                }
                                is Event.NativeUpdate -> StoreUpdate.check(this@MainActivity, e.manual, e.url,
                                    say = { say(it) }, needUpdate = { vm.showUpdateDialog() }, openUrl = { vm.openUrl(it) })
                                is Event.StartUpdate -> StoreUpdate.install(this@MainActivity, e.url) { vm.openUrl(it) }
                                is Event.OpenUrl -> try {
                                    CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(e.url))
                                } catch (ex: ActivityNotFoundException) {
                                    say("مرورگری برای باز کردن لینک پیدا نشد")
                                }
                                is Event.FileReady -> {
                                    val f = e.saved
                                    when {
                                        e.share -> shareFile(f, e.pkg, e.caption)
                                        // فایل دیگر خودکار باز نمی‌شود؛ کاربر با دکمه‌ی «باز کردن» تصمیم می‌گیرد
                                        f.isPublic -> sayAction("ذخیره شد: " + f.name, "باز کردن") {
                                            if (!openFile(f)) say("برنامه‌ای برای باز کردن این فایل نصب نیست؛ فایل در پوشه‌ی دانلودها ذخیره شده است.")
                                        }
                                        else -> saveDialog = f
                                    }
                                }
                            }
                        }
                    }

                    // خواندن خودکار کد پیامکی وقتی کد ارسال شد (با هر «ارسال مجدد» دوباره شروع می‌شود)
                    LaunchedEffect(st.otpSent, st.otpTick) {
                        if (st.otpSent) sms.start() else sms.stop()
                    }

                    // خریدهای پرداخت‌شده ولی تایید/مصرف‌نشده (قطع اینترنت، بسته‌شدن اپ، خطای سرور…) را تا وقتی مانده‌اند هر ۴۵ ثانیه دوباره
                    // به سرور می‌فرستد؛ با هر بازگشت به اپ یا خطای خرید هم از نو شروع می‌شود. تایید تکراری روی سرور بی‌خطر است.
                    LaunchedEffect(st.bazaarReady, st.screen, st.billingTick) {
                        if (!st.bazaarReady || st.screen != Screen.Main) return@LaunchedEffect
                        var rounds = 0
                        var left = true
                        while (left && rounds < 20) {
                            val got = CompletableDeferred<Boolean>()
                            billing.unconsumed { list ->
                                val mine = list.filter { it.first.startsWith("plan_") }
                                mine.forEach { (sku, token) ->
                                    vm.bazaarClaim(sku, token, silent = true) { ok -> if (ok) billing.consume(token) }
                                }
                                got.complete(mine.isNotEmpty())
                            }
                            left = withTimeoutOrNull(20_000) { got.await() } ?: false
                            rounds++
                            if (left) delay(45_000)
                        }
                    }

                    saveDialog?.let { f ->
                        AlertDialog(
                            onDismissRequest = { saveDialog = null },
                            title = { Text("فایل آماده است") },
                            text = {
                                Text("«" + f.name + "» در حافظه‌ی اختصاصی اپ ذخیره شد. برای اینکه در پوشه‌های گوشی (مثلاً Downloads) هم پیدا شود، «ذخیره در گوشی» را بزنید.")
                            },
                            confirmButton = {
                                TextButton(onClick = {
                                    saveDialog = null
                                    pendingSave = f
                                    try { saveAs.launch(f.mime to f.name) } catch (ex: ActivityNotFoundException) { say("ذخیره در گوشی ممکن نشد") }
                                }) { Text("ذخیره در گوشی") }
                            },
                            dismissButton = {
                                TextButton(onClick = {
                                    saveDialog = null
                                    if (!openFile(f)) say("برنامه‌ای برای باز کردن این فایل نصب نیست؛ می‌توانید «ذخیره در گوشی» را بزنید.")
                                }) { Text("باز کردن") }
                            },
                        )
                    }

                    // درخواست امتیاز: بعد از اولین دانلود (یا دیدن فایل داخل اپ وقتی دانلودی نبوده)، حداکثر ۱۰ بار با فاصله‌ی ۷ روز؛ هم‌زمان با پنجره‌ی دیگری یا نمایشگر باز نشان داده نمی‌شود
                    if (st.rateAsk && saveDialog == null && !st.updateDialog && st.viewer == null) {
                        AlertDialog(
                            onDismissRequest = { vm.rateLater() },
                            title = { Text("نظرتان درباره‌ی پاورپوینت‌ساز؟") },
                            text = { Text("اگر این اپ به کارتان آمده، ثبت امتیاز و نظر در " + Store.NAME_FA + " چند ثانیه بیشتر وقت نمی‌گیرد و کمک بزرگی به ماست.") },
                            confirmButton = {
                                TextButton(onClick = {
                                    vm.rateDone()
                                    if (!openStoreRating()) vm.openUrl(StoreRating.WEB_URL)
                                }) { Text("ثبت نظر") }
                            },
                            dismissButton = { TextButton(onClick = { vm.rateLater() }) { Text("بعداً") } },
                        )
                    }

                    Root(st, vm, snack)
                }
            }
        }
    }

    override fun onDestroy() {
        sms.stop()
        billing.disconnect()
        super.onDestroy()
    }

    /** شروع خرید در فروشگاه؛ خطاها نشان داده می‌شوند و بررسی خریدهای تاییدنشده را دوباره راه می‌اندازند. */
    private fun startPurchase(sku: String, say: (String) -> Unit) {
        billing.purchase(
            sku = sku,
            onPurchase = { s, token -> vm.bazaarClaim(s, token) { ok -> if (ok) billing.consume(token) } },
            onError = {
                if (it.isNotEmpty()) {
                    say(it)
                    vm.recoverPurchases()
                }
            },
        )
    }

    override fun onResume() {
        super.onResume()
        vm.onResume()
    }
}
