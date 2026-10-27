package ir.pptsaz.app

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** آخرین وضعیت حساب برای ویجت (فقط تعداد اعتبار؛ نام و شماره‌ی موبایل هرگز اینجا ذخیره نمی‌شود). */
data class WidgetState(val loggedIn: Boolean, val credits: Int, val unlimited: Boolean)

/** پل بین اپ و ویجت: ViewModel هر وقت اعتبار عوض شد push می‌زند و ویجت‌های روی صفحه تازه می‌شوند. */
object WidgetSync {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("widget", Context.MODE_PRIVATE)

    /** v = (اعتبار، نامحدود؟) یا null وقتی کاربر وارد نشده است. */
    fun push(ctx: Context, v: Pair<Int, Boolean>?) {
        val app = ctx.applicationContext
        prefs(app).edit()
            .putBoolean("in", v != null)
            .putInt("credits", v?.first ?: 0)
            .putBoolean("unlimited", v?.second ?: false)
            .apply()
        scope.launch {
            try { PptWidget().updateAll(app) } catch (_: Exception) { /* ویجتی روی صفحه نیست یا سیستم مشغول است */ }
        }
    }

    fun read(ctx: Context): WidgetState {
        val p = prefs(ctx)
        return WidgetState(p.getBoolean("in", false), p.getInt("credits", 0), p.getBoolean("unlimited", false))
    }
}

private val Brand = Color(0xFF2563EB)
private val OnBrand = Color.White
private val OnBrandSoft = Color(0xFFDBEAFE)

class PptWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val s = WidgetSync.read(context)
        provideContent { WidgetContent(context, s) }
    }
}

@Composable
private fun WidgetContent(ctx: Context, s: WidgetState) {
    // کل ویجت اپ را باز می‌کند؛ دکمه‌ی سفید همان میان‌بر «ارائه‌ی جدید» است
    val openApp = actionStartActivity(Intent(ctx, MainActivity::class.java))
    val newDeck = actionStartActivity(Intent(ctx, MainActivity::class.java).setAction(MainActivity.ACTION_NEW_DECK))
    val line = when {
        !s.loggedIn -> "برای دیدن اعتبار وارد شوید"
        s.unlimited -> "اعتبار: نامحدود"
        else -> "اعتبار باقی‌مانده: " + s.credits.fa()
    }
    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(ColorProvider(Brand))
            .cornerRadius(20.dp)
            .padding(14.dp)
            .clickable(openApp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "پاورپوینت‌ساز",
            style = TextStyle(color = ColorProvider(OnBrand), fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
        )
        Spacer(GlanceModifier.height(4.dp))
        Text(
            line,
            style = TextStyle(color = ColorProvider(OnBrandSoft), fontSize = 12.sp, textAlign = TextAlign.Center),
        )
        Spacer(GlanceModifier.height(10.dp))
        Box(
            modifier = GlanceModifier
                .fillMaxWidth()
                .background(ColorProvider(OnBrand))
                .cornerRadius(14.dp)
                .padding(vertical = 9.dp)
                .clickable(newDeck),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "ساخت ارائه‌ی جدید",
                style = TextStyle(color = ColorProvider(Brand), fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
            )
        }
    }
}

class PptWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = PptWidget()
}
