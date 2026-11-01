package ir.pptsaz.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal enum class Phase { Idle, Loading, Ready, Error }

internal val SPEEDS = floatArrayOf(1f, 1.25f, 1.5f, 2f, 0.75f)

/**
 * موتور پخش پادکست (یک نمونه برای کل برنامه). MediaPlayer و MediaSession اینجا زندگی می‌کنند، نه داخل Composable،
 * پس با رفتن به صفحه‌ی دیگر، خاموش شدن صفحه یا بستن اپ، پخش ادامه پیدا می‌کند.
 * - MediaSession: دکمه‌های صفحه‌ی قفل، پنل رسانه‌ی سیستم، هدفون سیمی و بلوتوث (پخش/توقف، بعدی/قبلی = ۱۵ ثانیه جلو/عقب).
 * - PodcastService: سرویس پیش‌زمینه‌ی mediaPlayback تا سیستم پردازش اپ را هنگام پخش نبندد.
 * همه‌ی تابع‌ها باید روی نخ اصلی صدا زده شوند (Composable، callbackهای MediaSession و فوکوس صدا همه روی نخ اصلی‌اند).
 */
internal object PodcastEngine {
    private const val SEEK_MS = 15_000
    const val CHANNEL = "podcast_playback"
    const val NOTIF_ID = 7301
    const val ACT_PLAY = "ir.pptsaz.app.podcast.PLAY"
    const val ACT_PAUSE = "ir.pptsaz.app.podcast.PAUSE"
    const val ACT_REW = "ir.pptsaz.app.podcast.REW"
    const val ACT_FWD = "ir.pptsaz.app.podcast.FWD"
    const val ACT_STOP = "ir.pptsaz.app.podcast.STOP"

    // وضعیتی که صفحه‌ها (Compose) می‌بینند
    var currentId by mutableStateOf<String?>(null); private set
    var title by mutableStateOf(""); private set
    var phase by mutableStateOf(Phase.Idle); private set
    var playing by mutableStateOf(false); private set
    var dur by mutableIntStateOf(0); private set
    var pos by mutableIntStateOf(0); private set
    var speedIdx by mutableIntStateOf(0); private set
    var error by mutableStateOf(""); private set

    private lateinit var app: Context
    private var mp: MediaPlayer? = null
    private var session: MediaSession? = null
    private var loadJob: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var focusReq: AudioFocusRequest? = null
    private var resumeOnGain = false
    private var noisyRegistered = false

    private val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    /* ───────────── بارگذاری و پخش ───────────── */

    fun load(ctx: Context, id: String, title: String, play: Boolean) {
        app = ctx.applicationContext
        if (currentId == id && (phase == Phase.Ready || phase == Phase.Loading)) {
            // همان پادکست؛ از اول شروع نمی‌کنیم (برگشتن به صفحه نباید پخش را ری‌استارت کند)
            if (play && phase == Phase.Ready && !playing) play()
            return
        }
        releasePlayer()
        loadJob?.cancel()
        currentId = id
        this.title = title.ifBlank { "پادکست" }
        phase = Phase.Loading
        error = ""
        playing = false
        pos = 0
        dur = 0
        publishSession()
        loadJob = scope.launch {
            try {
                val f = PodcastAudio.file(app, id)
                // ساخت پلیر قابل‌لغو نیست؛ اگر وسطش لغو شد، بعد از پایان آزادش می‌کنیم تا نشت نکند
                val m = withContext(Dispatchers.IO + NonCancellable) {
                    MediaPlayer().apply {
                        try {
                            setAudioAttributes(attrs)
                            setDataSource(f.absolutePath)
                            prepare()
                        } catch (e: Exception) {
                            release()
                            throw e
                        }
                    }
                }
                if (!isActive || currentId != id) { runCatching { m.release() }; return@launch }
                m.setOnCompletionListener {
                    playing = false
                    pos = dur
                    abandonFocus()
                    unregisterNoisy()
                    publishSession()
                }
                m.setOnErrorListener { _, _, _ ->
                    fail("پخش ممکن نشد؛ فایل را دانلود کنید.")
                    true
                }
                mp = m
                dur = m.duration.coerceAtLeast(0)
                pos = 0
                phase = Phase.Ready
                ensureSession()
                publishSession()
                if (play) play()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                fail(e.message ?: "دریافت پادکست انجام نشد.")
            } catch (e: Exception) {
                fail("پخش ممکن نشد؛ فایل را دانلود کنید.")
            }
        }
    }

    private fun fail(msg: String) {
        playing = false
        phase = Phase.Error
        error = msg
        runCatching { mp?.release() }
        mp = null
        abandonFocus()
        unregisterNoisy()
        publishSession()
    }

    fun play() {
        val m = mp ?: return
        if (phase != Phase.Ready) return
        if (!requestFocus()) return
        resumeOnGain = false
        if (dur > 0 && position() >= dur - 300) { m.seekTo(0); pos = 0 }
        applySpeed(m)
        m.setVolume(1f, 1f)
        m.start()
        playing = true
        registerNoisy()
        publishSession()
    }

    fun pause(abandon: Boolean = true) {
        val m = mp ?: return
        if (playing) {
            runCatching { m.pause() }
            pos = position()
            playing = false
        }
        unregisterNoisy()
        if (abandon) { abandonFocus(); resumeOnGain = false }
        publishSession()
    }

    fun toggle() { if (playing) pause() else play() }

    /** توقف کامل: پلیر و سشن آزاد می‌شوند و اعلان و سرویس برداشته می‌شوند. */
    fun stop() {
        loadJob?.cancel()
        releasePlayer()
        session?.let { runCatching { it.isActive = false; it.release() } }
        session = null
        currentId = null
        phase = Phase.Idle
        playing = false
        pos = 0
        dur = 0
        error = ""
        val svc = PodcastService.instance
        if (svc != null) svc.shutdown()
        else if (this::app.isInitialized) app.getSystemService(NotificationManager::class.java)?.cancel(NOTIF_ID)
    }

    fun seekTo(ms: Int) {
        val m = mp ?: return
        val to = ms.coerceIn(0, dur.coerceAtLeast(0))
        runCatching { m.seekTo(to) }
        pos = to
        publishSession()
    }

    fun seekBy(delta: Int) { if (mp != null) seekTo(position() + delta) }

    fun cycleSpeed() {
        speedIdx = (speedIdx + 1) % SPEEDS.size
        if (playing) mp?.let { applySpeed(it) }
        publishSession()
    }

    fun position(): Int = runCatching { mp?.currentPosition ?: 0 }.getOrDefault(0)

    // MediaPlayer روی بعضی نسخه‌ها با setPlaybackParams در حالت توقف خودش شروع به پخش می‌کند؛ پس فقط هنگام پخش یا درست قبل از start اعمال می‌شود
    private fun applySpeed(m: MediaPlayer) {
        runCatching { m.playbackParams = m.playbackParams.setSpeed(SPEEDS[speedIdx]) }
    }

    private fun releasePlayer() {
        runCatching { mp?.release() }
        mp = null
        playing = false
        abandonFocus()
        unregisterNoisy()
    }

    /** از دکمه‌های اعلان (PodcastActionReceiver). */
    fun handle(action: String?) {
        when (action) {
            ACT_PLAY -> play()
            ACT_PAUSE -> pause()
            ACT_REW -> seekBy(-SEEK_MS)
            ACT_FWD -> seekBy(SEEK_MS)
            ACT_STOP -> stop()
        }
    }

    /* ───────────── فوکوس صدا و هدفون ───────────── */

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> { resumeOnGain = false; pause() }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { resumeOnGain = playing; pause(abandon = false) }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> mp?.setVolume(0.25f, 0.25f)
            AudioManager.AUDIOFOCUS_GAIN -> {
                mp?.setVolume(1f, 1f)
                if (resumeOnGain) { resumeOnGain = false; play() }
            }
        }
    }

    private fun requestFocus(): Boolean {
        val am = app.getSystemService(AudioManager::class.java) ?: return true
        val r = if (Build.VERSION.SDK_INT >= 26) {
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            focusReq = req
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
        return r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonFocus() {
        if (!this::app.isInitialized) return
        val am = app.getSystemService(AudioManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= 26) {
            focusReq?.let { am.abandonAudioFocusRequest(it) }
            focusReq = null
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(focusListener)
        }
    }

    // درآوردن هدفون سیمی / قطع بلوتوث: پخش نباید از بلندگوی گوشی ادامه پیدا کند
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) { pause() }
    }

    private fun registerNoisy() {
        if (noisyRegistered) return
        runCatching { app.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)); noisyRegistered = true }
    }

    private fun unregisterNoisy() {
        if (!noisyRegistered) return
        runCatching { app.unregisterReceiver(noisy) }
        noisyRegistered = false
    }

    /* ───────────── MediaSession ───────────── */

    @Suppress("DEPRECATION")
    private fun ensureSession() {
        if (session != null) return
        val s = MediaSession(app, "PptSazPodcast")
        // روی اندروید ≤ ۷ بدون این پرچم‌ها دکمه‌های هدفون به سشن نمی‌رسد
        s.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
        s.setCallback(object : MediaSession.Callback() {
            override fun onPlay() = play()
            override fun onPause() = pause()
            override fun onStop() = stop()
            override fun onSeekTo(pos: Long) = seekTo(pos.toInt())
            override fun onFastForward() = seekBy(SEEK_MS)
            override fun onRewind() = seekBy(-SEEK_MS)
            override fun onSkipToNext() = seekBy(SEEK_MS)
            override fun onSkipToPrevious() = seekBy(-SEEK_MS)
        }, Handler(Looper.getMainLooper()))
        s.setSessionActivity(openAppIntent(app))
        session = s
    }

    /** وضعیت فعلی را به سشن (صفحه‌ی قفل، هدفون) و اعلان می‌رساند. */
    private fun publishSession() {
        val s = session
        if (s != null) {
            s.setMetadata(
                MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title.ifBlank { "پادکست" })
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, "پاورپوینت‌ساز")
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, dur.toLong())
                    .build(),
            )
            val state = when {
                phase == Phase.Loading -> PlaybackState.STATE_BUFFERING
                phase == Phase.Error -> PlaybackState.STATE_ERROR
                playing -> PlaybackState.STATE_PLAYING
                else -> PlaybackState.STATE_PAUSED
            }
            val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                PlaybackState.ACTION_STOP or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_FAST_FORWARD or
                PlaybackState.ACTION_REWIND or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS
            val b = PlaybackState.Builder()
                .setActions(actions)
                .setState(state, (if (playing) position() else pos).toLong(), if (playing) SPEEDS[speedIdx] else 0f, SystemClock.elapsedRealtime())
            if (phase == Phase.Error) b.setErrorMessage(error)
            s.setPlaybackState(b.build())
            s.isActive = phase == Phase.Ready || phase == Phase.Loading
        }
        syncNotification()
    }

    /* ───────────── اعلان و سرویس پیش‌زمینه ───────────── */

    private fun syncNotification() {
        if (!this::app.isInitialized) return
        val svc = PodcastService.instance
        when {
            playing -> if (svc == null) {
                runCatching { ContextCompat.startForegroundService(app, Intent(app, PodcastService::class.java)) }
            } else svc.promote(buildNotification(app))
            svc != null -> svc.demote(buildNotification(app))
        }
    }

    private fun openAppIntent(ctx: Context): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP }
        return PendingIntent.getActivity(ctx, 7300, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun action(ctx: Context, act: String, code: Int): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, 7310 + code,
            Intent(ctx, PodcastActionReceiver::class.java).setAction(act),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "پخش پادکست", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "کنترل پخش پادکست روی صفحه‌ی قفل و نوار اعلان"; setShowBadge(false) },
            )
        }
    }

    @Suppress("DEPRECATION")
    fun buildNotification(ctx: Context): Notification {
        ensureChannel(ctx)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, CHANNEL) else Notification.Builder(ctx)
        fun act(icon: Int, label: String, a: String, code: Int) =
            Notification.Action.Builder(Icon.createWithResource(ctx, icon), label, action(ctx, a, code)).build()
        b.setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title.ifBlank { "پادکست" })
            .setContentText(if (phase == Phase.Loading) "در حال آماده‌سازی…" else "پاورپوینت‌ساز")
            .setContentIntent(openAppIntent(ctx))
            .setDeleteIntent(action(ctx, ACT_STOP, 4)) // کنار زدن اعلان (فقط در حالت توقف ممکن است) = پایان
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC) // روی صفحه‌ی قفل هم نمایش داده شود
            .addAction(act(android.R.drawable.ic_media_rew, "۱۵ ثانیه عقب", ACT_REW, 0))
            .addAction(
                if (playing) act(android.R.drawable.ic_media_pause, "توقف", ACT_PAUSE, 1)
                else act(android.R.drawable.ic_media_play, "پخش", ACT_PLAY, 2),
            )
            .addAction(act(android.R.drawable.ic_media_ff, "۱۵ ثانیه جلو", ACT_FWD, 3))
        val style = Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2)
        session?.let { style.setMediaSession(it.sessionToken) }
        b.setStyle(style)
        return b.build()
    }
}

/** سرویس پیش‌زمینه‌ی mediaPlayback؛ فقط عمر پردازش و اعلان را نگه می‌دارد، خود پخش در PodcastEngine است. */
class PodcastService : Service() {
    companion object {
        @Volatile internal var instance: PodcastService? = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        instance = this
        // بعد از startForegroundService باید فوراً startForeground صدا زده شود، وگرنه برنامه بسته می‌شود
        promote(PodcastEngine.buildNotification(this))
        if (PodcastEngine.currentId == null) shutdown() else if (!PodcastEngine.playing) demote(PodcastEngine.buildNotification(this))
        return START_NOT_STICKY
    }

    internal fun promote(n: Notification) {
        if (Build.VERSION.SDK_INT >= 29) startForeground(PodcastEngine.NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(PodcastEngine.NOTIF_ID, n)
    }

    /** توقف موقت: از حالت پیش‌زمینه درمی‌آید ولی اعلان می‌ماند تا کاربر دوباره پخش کند یا کنارش بزند. */
    internal fun demote(n: Notification) {
        stopForeground(STOP_FOREGROUND_DETACH)
        getSystemService(NotificationManager::class.java)?.notify(PodcastEngine.NOTIF_ID, n)
    }

    internal fun shutdown() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // کاربر اپ را از لیست اخیر پاک کرد: اگر چیزی پخش نمی‌شود، همه‌چیز را ببند
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!PodcastEngine.playing) PodcastEngine.stop()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }
}

/** دکمه‌های اعلان رسانه‌ای. اگر پردازش بعد از بسته شدن دوباره ساخته شده و چیزی برای کنترل نیست، اعلان قدیمی را پاک می‌کند. */
class PodcastActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (PodcastEngine.currentId == null) {
            context.getSystemService(NotificationManager::class.java)?.cancel(PodcastEngine.NOTIF_ID)
            return
        }
        PodcastEngine.handle(intent.action)
    }
}
