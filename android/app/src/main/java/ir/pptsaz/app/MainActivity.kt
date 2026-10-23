package ir.pptsaz.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.platform.LocalLayoutDirection

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                AppTheme {
                    val st by vm.state.collectAsState()
                    val ctx = LocalContext.current
                    LaunchedEffect(Unit) {
                        vm.events.collect { e ->
                            when (e) {
                                is Event.Toast -> Toast.makeText(ctx, e.msg, Toast.LENGTH_LONG).show()
                                is Event.OpenUrl -> try {
                                    CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(e.url))
                                } catch (ex: ActivityNotFoundException) {
                                    Toast.makeText(ctx, "مرورگری برای باز کردن لینک پیدا نشد", Toast.LENGTH_LONG).show()
                                }
                                is Event.OpenFile -> {
                                    Toast.makeText(ctx, "ذخیره شد: " + e.name, Toast.LENGTH_LONG).show()
                                    try {
                                        val view = Intent(Intent.ACTION_VIEW).apply {
                                            setDataAndType(e.uri, e.mime)
                                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                                        }
                                        ctx.startActivity(view)
                                    } catch (ex: ActivityNotFoundException) {
                                        Toast.makeText(ctx, "برنامه‌ای برای باز کردن این فایل نصب نیست؛ فایل در پوشه‌ی دانلودها ذخیره شده است.", Toast.LENGTH_LONG).show()
                                    }
                                }
                            }
                        }
                    }
                    Root(st, vm)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.onResume()
    }
}
