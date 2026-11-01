package ir.pptsaz.app

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File

/**
 * منبع فایل صوتی پادکست برای پلیر: اول کش پخش، بعد نسخه‌ی محلی کتابخانه (LocalFiles)، در آخر دریافت از سرور (با کوکی نشست).
 * MediaPlayer برای جلو/عقب‌کردن به فایل روی دیسک نیاز دارد؛ پس WAV در cacheDir/podcast نگه داشته می‌شود (سیستم هر وقت حافظه کم شد پاکش می‌کند).
 */
object PodcastAudio {
    private const val KEEP = 6

    private fun dir(ctx: Context) = File(ctx.cacheDir, "podcast").apply { mkdirs() }

    suspend fun file(ctx: Context, id: String): File = withContext(Dispatchers.IO) {
        val safe = id.replace(Regex("[^A-Za-z0-9_-]"), "_").take(80)
        val f = File(dir(ctx), "$safe.wav")
        if (f.exists() && f.length() > 44) {
            f.setLastModified(System.currentTimeMillis())
            return@withContext f
        }
        val bytes = LocalFiles.read(ctx, id)?.bytes ?: Api.fetchFile(id, maxRetries = 20).bytes
        val tmp = File(f.parentFile, "$safe.part")
        tmp.writeBytes(bytes)
        if (f.exists()) f.delete()
        if (!tmp.renameTo(f)) {
            tmp.delete()
            throw java.io.IOException("rename failed")
        }
        // فقط چند پادکستِ اخیر در کش بماند
        dir(ctx).listFiles { x -> x.extension == "wav" }?.sortedByDescending { it.lastModified() }?.drop(KEEP)?.forEach { it.delete() }
        f
    }
}

internal val PLAY_ICON: ImageVector by lazy { glyph("play", "M8,5v14l11,-7z") }
private val PAUSE_ICON: ImageVector by lazy { glyph("pause", "M6,19h4V5H6v14zM14,5v14h4V5h-4z") }

private fun glyph(name: String, path: String): ImageVector =
    ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .addPath(pathData = PathParser().parsePathString(path).toNodes(), fill = SolidColor(Color.Black))
        .build()

private fun fmt(ms: Int): String {
    val s = (ms.coerceAtLeast(0)) / 1000
    val sec = s % 60
    return (s / 60).fa() + ":" + (if (sec < 10) "۰" else "") + sec.fa()
}

/**
 * پلیر پادکست داخل اپ؛ فقط نمایش و کنترل است و پخش در PodcastEngine (با MediaSession و سرویس پیش‌زمینه) انجام می‌شود.
 * پخش/توقف، ۱۵ ثانیه جلو و عقب، نوار زمان (قابل کشیدن) و سرعت پخش. با خروج از صفحه پخش قطع نمی‌شود و از اعلان / صفحه‌ی قفل / هدفون کنترل می‌شود.
 * دریافت فایل فقط با زدن «پخش» (یا autoStart) شروع می‌شود تا اینترنت الکی مصرف نشود.
 */
@Composable
fun PodcastPlayerCard(id: String, title: String, modifier: Modifier = Modifier, autoStart: Boolean = false) {
    val ctx = LocalContext.current.applicationContext
    val cs = MaterialTheme.colorScheme
    // موتور یکی است؛ فقط وقتی همین پادکست در آن بارگذاری شده وضعیتش را نشان می‌دهیم
    val mine = PodcastEngine.currentId == id
    val phase = if (mine) PodcastEngine.phase else Phase.Idle
    val playing = mine && PodcastEngine.playing
    val dur = if (mine) PodcastEngine.dur else 0
    val error = if (mine) PodcastEngine.error else ""
    var live by remember(id) { mutableIntStateOf(0) }
    var drag by remember(id) { mutableFloatStateOf(-1f) }
    val pos = if (playing) live else if (mine) PodcastEngine.pos else 0

    LaunchedEffect(id) { if (autoStart) PodcastEngine.load(ctx, id, title, play = true) }
    LaunchedEffect(id, playing) {
        while (playing) {
            if (drag < 0f) live = PodcastEngine.position()
            delay(250)
        }
    }

    fun toggle() {
        when {
            phase == Phase.Loading -> Unit
            !mine || phase == Phase.Idle || phase == Phase.Error -> PodcastEngine.load(ctx, id, title, play = true)
            else -> PodcastEngine.toggle()
        }
    }

    Column(
        modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            "🎙 " + title.ifBlank { "پادکست" },
            style = MaterialTheme.typography.labelLarge,
            color = cs.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        // نوار زمان و دکمه‌ها همیشه چپ‌به‌راست‌اند (مثل همه‌ی پخش‌کننده‌ها)، حتی در رابط راست‌به‌چپ
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                FilledIconButton(onClick = { toggle() }, enabled = phase != Phase.Loading, modifier = Modifier.size(48.dp)) {
                    if (phase == Phase.Loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = cs.onPrimary)
                    else AppIcon(if (playing) PAUSE_ICON else PLAY_ICON, size = 26.dp, description = if (playing) "توقف پادکست" else "پخش پادکست")
                }
                TextButton(onClick = { PodcastEngine.seekBy(-15_000) }, enabled = phase == Phase.Ready, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp)) { Text("⟲ ۱۵") }
                Slider(
                    value = if (drag >= 0f) drag else pos.toFloat().coerceAtMost(dur.toFloat().coerceAtLeast(1f)),
                    onValueChange = { drag = it },
                    onValueChangeFinished = {
                        val to = drag.toInt().coerceIn(0, dur.coerceAtLeast(0))
                        PodcastEngine.seekTo(to)
                        live = to
                        drag = -1f
                    },
                    valueRange = 0f..dur.toFloat().coerceAtLeast(1f),
                    enabled = phase == Phase.Ready,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { PodcastEngine.seekBy(15_000) }, enabled = phase == Phase.Ready, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp)) { Text("۱۵ ⟳") }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    fmt(if (drag >= 0f) drag.toInt() else pos) + " / " + fmt(dur),
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                    modifier = Modifier.padding(start = 6.dp),
                )
                TextButton(
                    onClick = { PodcastEngine.cycleSpeed() },
                    enabled = phase != Phase.Loading,
                ) { Text(SPEEDS[PodcastEngine.speedIdx].toString().removeSuffix(".0").replace(".", "٫").faStr() + "×") }
            }
        }
        if (error.isNotEmpty()) {
            Text(error, style = MaterialTheme.typography.bodySmall, color = cs.error, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}
