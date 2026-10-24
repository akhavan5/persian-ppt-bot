package ir.pptsaz.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
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
                    Root(st, vm, snack)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.onResume()
    }
}
