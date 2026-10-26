package ir.pptsaz.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()
    private lateinit var billing: BazaarBilling
    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** اجازه‌ی اعلان (اندروید ۱۳+) فقط یک بار و درست بعد از اولین ساخت ارائه پرسیده می‌شود. */
    private fun askNotifications() {
        if (Build.VERSION.SDK_INT < 33) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        val p = getSharedPreferences("prefs", MODE_PRIVATE)
        if (p.getBoolean("asked_notif", false)) return
        p.edit().putBoolean("asked_notif", true).apply()
        notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** اشتراک‌گذاری از برنامه‌های دیگر (ACTION_SEND) و باز شدن از روی اعلان (tab). */
    private fun handleIntent(i: Intent?) {
        if (i == null) return
        val tab = i.getIntExtra("tab", -1)
        if (tab in 0..3) {
            vm.setTab(tab)
            i.removeExtra("tab")
        }
        if (i.action == Intent.ACTION_SEND) {
            if (i.type == "text/plain") {
                val t = i.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
                if (t.isNotEmpty()) vm.onShare(Share.TextShare(t))
            } else {
                @Suppress("DEPRECATION")
                val uri = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else i.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                if (uri != null) vm.onShare(Share.FileShare(uri))
            }
            i.action = null // با چرخش صفحه دوباره پردازش نشود
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
    }

    override fun onStop() {
        AppForeground.count = (AppForeground.count - 1).coerceAtLeast(0)
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
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
                    fun say(msg: String) {
                        scope.launch {
                            snack.currentSnackbarData?.dismiss()
                            snack.showSnackbar(msg, duration = SnackbarDuration.Long)
                        }
                    }
                    LaunchedEffect(Unit) {
                        vm.events.collect { e ->
                            when (e) {
                                is Event.Toast -> say(e.msg)
                                Event.AskNotify -> askNotifications()
                                is Event.BazaarBuy -> billing.purchase(
                                    sku = e.sku,
                                    onPurchase = { sku, token ->
                                        vm.bazaarClaim(sku, token) { ok -> if (ok) billing.consume(token) }
                                    },
                                    onError = { if (it.isNotEmpty()) say(it) },
                                )
                                is Event.OpenUrl -> try {
                                    CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(e.url))
                                } catch (ex: ActivityNotFoundException) {
                                    say("مرورگری برای باز کردن لینک پیدا نشد")
                                }
                                is Event.OpenFile -> {
                                    say("ذخیره شد: " + e.name)
                                    try {
                                        val view = Intent(Intent.ACTION_VIEW).apply {
                                            setDataAndType(e.uri, e.mime)
                                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                                        }
                                        ctx.startActivity(view)
                                    } catch (ex: ActivityNotFoundException) {
                                        say("برنامه‌ای برای باز کردن این فایل نصب نیست؛ فایل در پوشه‌ی دانلودها ذخیره شده است.")
                                    }
                                }
                            }
                        }
                    }
                    // خریدهای پرداخت‌شده ولی تایید/مصرف‌نشده (مثلاً قطع شدن اینترنت وسط کار) را دوباره به سرور می‌فرستد
                    LaunchedEffect(st.bazaarReady, st.screen, st.config?.bazaar) {
                        if (st.bazaarReady && st.screen == Screen.Main && st.config?.bazaar == true) {
                            billing.unconsumed { list ->
                                list.filter { it.first.startsWith("plan_") }.forEach { (sku, token) ->
                                    vm.bazaarClaim(sku, token, silent = true) { ok -> if (ok) billing.consume(token) }
                                }
                            }
                        }
                    }
                    Root(st, vm, snack)
                }
            }
        }
    }

    override fun onDestroy() {
        billing.disconnect()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        vm.onResume()
    }
}
