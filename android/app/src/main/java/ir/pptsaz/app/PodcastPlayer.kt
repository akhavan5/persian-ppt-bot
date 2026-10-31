package ir.pptsaz.app

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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

private enum class Phase { Idle, Loading, Ready, Error }

private val SPEEDS = floatArrayOf(1f, 1.25f, 1.5f, 2f, 0.75f)

private class PlayerHolder { var mp: MediaPlayer? = null }

/**
 * پلیر پادکست داخل اپ: پخش/توقف، ۱۵ ثانیه جلو و عقب، نوار زمان (قابل کشیدن) و سرعت پخش.
 * دریافت فایل فقط با زدن «پخش» (یا autoStart) شروع می‌شود تا اینترنت الکی مصرف نشود. با خروج از صفحه پخش‌کننده آزاد می‌شود.
 */
@Composable
fun PodcastPlayerCard(id: String, title: String, modifier: Modifier = Modifier, autoStart: Boolean = false) {
    val ctx = LocalContext.current.applicationContext
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val holder = remember(id) { PlayerHolder() }
    var phase by remember(id) { mutableStateOf(Phase.Idle) }
    var playing by remember(id) { mutableStateOf(false) }
    var pos by remember(id) { mutableIntStateOf(0) }
    var dur by remember(id) { mutableIntStateOf(0) }
    var speedIdx by remember(id) { mutableIntStateOf(0) }
    var drag by remember(id) { mutableFloatStateOf(-1f) }
    var error by remember(id) { mutableStateOf("") }

    DisposableEffect(id) {
        onDispose {
            holder.mp?.let { runCatching { it.release() } }
            holder.mp = null
        }
    }

    // MediaPlayer روی بعضی نسخه‌ها با setPlaybackParams در حالت توقف خودش شروع به پخش می‌کند؛ پس فقط هنگام پخش یا درست قبل از start اعمال می‌شود
    fun applySpeed(mp: MediaPlayer) {
        runCatching { mp.playbackParams = mp.playbackParams.setSpeed(SPEEDS[speedIdx]) }
    }

    fun start(mp: MediaPlayer) {
        applySpeed(mp)
        mp.start()
        playing = true
    }

    fun loadAndMaybePlay(thenPlay: Boolean) {
        if (phase == Phase.Loading) return
        phase = Phase.Loading
        error = ""
        scope.launch {
            try {
                val f = PodcastAudio.file(ctx, id)
                val mp = withContext(Dispatchers.IO) {
                    MediaPlayer().apply {
                        try {
                            setAudioAttributes(
                                AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_MEDIA)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build(),
                            )
                            setDataSource(f.absolutePath)
                            this.prepare()
                        } catch (e: Exception) {
                            release()
                            throw e
                        }
                    }
                }
                mp.setOnCompletionListener {
                    playing = false
                    pos = dur
                }
                mp.setOnErrorListener { _, _, _ ->
                    playing = false
                    phase = Phase.Error
                    error = "پخش ممکن نشد؛ فایل را دانلود کنید."
                    true
                }
                holder.mp?.let { runCatching { it.release() } }
                holder.mp = mp
                dur = mp.duration.coerceAtLeast(0)
                pos = 0
                phase = Phase.Ready
                if (thenPlay) start(mp)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                phase = Phase.Error
                error = e.message ?: "دریافت پادکست انجام نشد."
            } catch (e: Exception) {
                phase = Phase.Error
                error = "پخش ممکن نشد؛ فایل را دانلود کنید."
            }
        }
    }

    fun toggle() {
        val mp = holder.mp
        when {
            phase == Phase.Loading -> Unit
            mp == null -> loadAndMaybePlay(thenPlay = true)
            playing -> { mp.pause(); playing = false }
            else -> {
                // بعد از پایان پادکست دوباره از اول
                if (dur > 0 && mp.currentPosition >= dur - 300) { mp.seekTo(0); pos = 0 }
                start(mp)
            }
        }
    }

    fun seekBy(deltaMs: Int) {
        val mp = holder.mp ?: return
        val to = (mp.currentPosition + deltaMs).coerceIn(0, dur.coerceAtLeast(0))
        mp.seekTo(to)
        pos = to
    }

    LaunchedEffect(id) { if (autoStart) loadAndMaybePlay(thenPlay = true) }
    LaunchedEffect(playing) {
        while (playing) {
            val mp = holder.mp
            if (mp != null && drag < 0f) pos = runCatching { mp.currentPosition }.getOrDefault(pos)
            delay(250)
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
                TextButton(onClick = { seekBy(-15_000) }, enabled = phase == Phase.Ready, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp)) { Text("⟲ ۱۵") }
                Slider(
                    value = if (drag >= 0f) drag else pos.toFloat().coerceAtMost(dur.toFloat().coerceAtLeast(1f)),
                    onValueChange = { drag = it },
                    onValueChangeFinished = {
                        val to = drag.toInt().coerceIn(0, dur.coerceAtLeast(0))
                        holder.mp?.seekTo(to)
                        pos = to
                        drag = -1f
                    },
                    valueRange = 0f..dur.toFloat().coerceAtLeast(1f),
                    enabled = phase == Phase.Ready,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { seekBy(15_000) }, enabled = phase == Phase.Ready, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp)) { Text("۱۵ ⟳") }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    fmt(if (drag >= 0f) drag.toInt() else pos) + " / " + fmt(dur),
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                    modifier = Modifier.padding(start = 6.dp),
                )
                TextButton(
                    onClick = {
                        speedIdx = (speedIdx + 1) % SPEEDS.size
                        if (playing) holder.mp?.let { applySpeed(it) }
                    },
                    enabled = phase != Phase.Loading,
                ) { Text(SPEEDS[speedIdx].toString().removeSuffix(".0").replace(".", "٫").faStr() + "×") }
            }
        }
        if (error.isNotEmpty()) {
            Text(error, style = MaterialTheme.typography.bodySmall, color = cs.error, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}
