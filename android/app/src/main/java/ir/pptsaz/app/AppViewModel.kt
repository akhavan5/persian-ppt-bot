package ir.pptsaz.app

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.SystemClock
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class Screen { Loading, Error, Login, Main }

/** شماره‌ی مرحله (۱ تا ۳) از پیام وضعیت سرور «۱/۳ — …»؛ ۰ = شماره ندارد. رقم‌های فارسی و عربی هم پذیرفته می‌شوند. */
internal fun jobStepOf(msg: String): Int {
    val latin = msg.map { c -> when (c) { in '۰'..'۹' -> '0' + (c - '۰'); in '٠'..'٩' -> '0' + (c - '٠'); else -> c } }.joinToString("")
    return Regex("([1-3])\\s*/\\s*3").find(latin)?.groupValues?.get(1)?.toInt() ?: 0
}

/** درصد پیشرفت (۰ تا ۱۰۰) که سرور برای اسلاید صوتی و پادکست در فیلد «progress» می‌فرستد؛ نیامده (هنوز در صف) = ‎-۱ (نوار نامعین). */
internal fun jobPctOf(j: org.json.JSONObject): Int =
    if (j.has("progress")) j.optInt("progress", -1).coerceIn(-1, 100) else -1

/** وضعیت یک همراهِ در حال ساخت که با دکمه خواسته شده: متن پیام سرور + درصد (‎-۱ = نامعلوم). */
data class ExtraProg(val msg: String, val pct: Int = -1)

data class JobState(
    val id: String,
    val message: String,
    val done: Boolean = false,
    val failed: Boolean = false,
    val title: String = "",
    val handoutId: String? = null,
    val posterId: String? = null,
    val posterFailed: Boolean = false,
    // نوار پیشرفت مرحله‌ای (مثل Mini App): step = ۰ تا ۳ از متن «۱/۳ — …»؛ extra = پیام‌های پوستر/جزوه بعد از ۳/۳؛ startedAt = SystemClock.elapsedRealtime() شروع ساخت (۰ = کار ازسرگرفته‌شده، بدون زمان‌سنج)
    val step: Int = 0,
    val extra: Boolean = false,
    val startedAt: Long = 0L,
    // اسلاید صوتی و پادکست همراه: چند دقیقه بعد از ارائه در سرور ساخته می‌شوند؛ تا آماده شدن «در حال ساخت» می‌ماند و بعد شناسه‌ی فایل‌ها می‌آید
    val audioWaiting: Boolean = false,
    val podcastWaiting: Boolean = false,
    val audioIds: List<String> = emptyList(),
    val podcastIds: List<String> = emptyList(),
    val audioFailed: Boolean = false,
    val podcastFailed: Boolean = false,
    // پیشرفت زنده‌ی ساخت اسلاید صوتی/پادکست همراه: متن پیام سرور و درصد (‎-۱ = هنوز در صف)
    val audioMsg: String = "",
    val audioPct: Int = -1,
    val podcastMsg: String = "",
    val podcastPct: Int = -1,
)

sealed interface Viewer {
    data class Poster(val id: String) : Viewer
    data class Preview(val id: String) : Viewer
}

data class UiState(
    val screen: Screen = Screen.Loading,
    val config: Config? = null,
    val me: Me? = null,
    val files: List<FileItem> = emptyList(),
    val localFiles: List<LocalFile> = emptyList(), // نسخه‌های ذخیره‌شده روی گوشی (بعد از ۲۴ ساعت سرور هم می‌مانند)
    val promo: Boolean = true, // اعلان‌های اخبار و تخفیف (FCM)
    val autoSave: Boolean = true, // ذخیره‌ی خودکار روی گوشی بعد از ساخت
    val filesLoading: Boolean = false,
    val tab: Int = 0,
    val busy: Boolean = false,
    val otpSent: Boolean = false,
    val error: String? = null,
    val job: JobState? = null,
    /** همراه‌هایی که بعد از ساخت ارائه با دکمه خواسته شده و در حال ساخت‌اند: کلید «<ارائه>|<نوع>» ← پیام وضعیت (دکمه‌ی همان نوع تا پایان کار نشان داده نمی‌شود) */
    val extraJobs: Map<String, ExtraProg> = emptyMap(),
    val extractBusy: String? = null,
    val extractedText: String? = null,
    /** متن کوتاهِ پیاده‌شده‌ی یک ویس/فایل صوتی (تا ۶۰۰ نویسه)؛ اگر موضوع خالی باشد همان موضوع می‌شود، وگرنه به منبع اضافه می‌شود */
    val extractedTopic: String? = null,
    val viewer: Viewer? = null,
    val bazaarReady: Boolean = false,
    val billingTick: Int = 0, // با هر بازگشت به اپ یا خطای خرید یکی زیاد می‌شود تا خریدهای تاییدنشده دوباره بررسی شوند
    val updateDialog: Boolean = false,
    val rateAsk: Boolean = false, // پنجره‌ی «ثبت امتیاز» (RatePrompt)
    val filesError: Boolean = false, // آخرین بارگیری فهرست فایل‌ها به خاطر شبکه ناموفق بود (فهرست ذخیره‌شده نمایش داده می‌شود)
    val smsCode: String? = null, // کدی که از پیامک خوانده شد (SMS User Consent)؛ صفحه‌ی ورود آن را برمی‌دارد
    val otpTick: Int = 0, // با هر ارسال موفق کد یکی زیاد می‌شود (برای شروع دوباره‌ی تایمر و گوش‌دادن به پیامک)
    val invite: InviteInfo? = null, // اطلاعات «دعوت دوستان»؛ همراه حساب پیش‌بارگذاری می‌شود تا کارت دعوت بدون تأخیر نمایش داده شود
)

sealed interface Event {
    data class Toast(val msg: String) : Event
    data class OpenUrl(val url: String) : Event
    /** درخواست بررسی نسخه‌ی جدید از خود فروشگاه (مایکت). url = لینک جایگزین اگر مایکت نصب نبود. */
    /** کاربر «به‌روزرسانی» را زد: نصب درون‌برنامه‌ای (بازار) یا باز کردن صفحه‌ی اپ. */
    data class StartUpdate(val url: String) : Event
    data class NativeUpdate(val url: String, val manual: Boolean) : Event
    /** فایل دانلود شد. share = true یعنی کاربر «اشتراک‌گذاری» را زده است. */
    /** pkg = مقصد مستقیم اشتراک‌گذاری (مثلاً تلگرام)؛ null = فهرست سیستم. caption = متن همراه فایل. */
    data class FileReady(val saved: Saved, val share: Boolean, val pkg: String? = null, val caption: String = "") : Event
    /** اجازه‌ی اعلان داده نشده؛ راهنمایی برای فعال‌سازی نشان بده. */
    data object NotifHint : Event
    data class BazaarBuy(val sku: String) : Event
    data object AskNotify : Event
    /** بار دوم پرسش مجوز اعلان: درست بعد از آماده‌شدن ارائه */
    data object AskNotifyAfterDeck : Event
    /** اتصال به فروشگاه را قطع و دوباره برقرار کن. */
    data object BillingReconnect : Event
}

/** چیزی که برنامه‌ی دیگری از «اشتراک‌گذاری» به اپ فرستاده */
sealed interface Share {
    data class FileShare(val uris: List<Uri>) : Share
    data class TextShare(val text: String) : Share
}

private const val MAX_SOURCE_CHARS = 120_000

/** نوع‌های فایل صوتی که سرور (Deepgram) می‌پذیرد؛ همان فهرست AUDIO_TYPES در src/deepgram.ts */
private val AUDIO_MIMES = setOf(
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/wav", "audio/x-wav", "audio/wave",
    "audio/ogg", "audio/opus", "audio/flac", "audio/x-flac", "audio/aac", "audio/amr",
)

/** حداکثر مدتی که اپ در حالت باز، وضعیت ساخت را (حتی با قطعی اینترنت) پیگیری می‌کند؛ کمی کمتر از JobWatcher پس‌زمینه (≈ ۲۵ دقیقه). */
private const val MAX_WATCH_MS = 20L * 60 * 1000

/** حداقل فاصله‌ی دو بار «تازه‌کردن حساب» هنگام برگشت به اپ (ثانیه‌های کم بین باز و بسته‌شدن‌های پشت‌سرهم درخواست اضافه نمی‌سازد). */
private const val RESUME_REFRESH_MS = 15_000L

/** فاصله‌ی تلاش‌های دوباره‌ی تایید خرید روی سرور (۲، ۴، ۸، ۱۵، ۳۰ ثانیه). */
private val CLAIM_DELAYS_MS = longArrayOf(2_000, 4_000, 8_000, 15_000, 30_000)

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    private val _events = Channel<Event>(Channel.BUFFERED)
    val events = _events.receiveAsFlow()

    private var pollJob: Job? = null

    private var pendingShare: Share? = null

    /**
     * فرم «ساخت» اینجا نگه داشته می‌شود تا با چرخش صفحه و تغییر تنظیمات سیستم بماند و متن منبعِ بلند (تا ۱۲۰ هزار نویسه)
     * وارد Bundle ذخیره‌ی وضعیت Activity نشود؛ برای بسته‌شدن پردازش، همان پیش‌نویس روی گوشی (Draft) است.
     */
    val form: CreateForm = Draft.load(app)

    private var lastMeRefresh = 0L

    /** کاربر برای پرداخت/لینک بیرونی از اپ رفته؛ با برگشتن، بدون توجه به فاصله‌ی زمانی حساب (اعتبار/پلن) تازه می‌شود. */
    private var refreshOnNextResume = false

    // وقتی اینترنت برگشت: صفحه‌ی خطا یا فهرست فایل‌های ناموفق خودکار دوباره امتحان می‌شود
    private val netCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            viewModelScope.launch {
                val s = _state.value
                if (s.screen == Screen.Error) refresh()
                else if (s.screen == Screen.Main && s.filesError) loadFiles()
            }
        }
    }

    init {
        Api.init(app)
        _state.update { it.copy(files = FileCache.load(app), invite = InviteCache.load(app), localFiles = LocalFiles.list(app), autoSave = LocalFiles.autoEnabled(app), promo = Push.promoEnabled(app)) }
        viewModelScope.launch { CrashReporter.sendPending(app) }
        // ویجت صفحه‌ی اصلی: آخرین اعتبار (یا «خارج از حساب» = null) را برای ویجت نگه می‌دارد؛ حالت‌های Loading/Error نادیده گرفته می‌شوند
        viewModelScope.launch {
            _state
                .filter { it.screen == Screen.Main || it.screen == Screen.Login }
                .map { s -> s.me?.takeIf { s.screen == Screen.Main }?.let { it.credits to it.unlimited } }
                .distinctUntilChanged()
                .collect { WidgetSync.push(app, it) }
        }
        try {
            app.getSystemService(ConnectivityManager::class.java)?.registerNetworkCallback(
                NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), netCallback,
            )
        } catch (_: Exception) {
        }
        refresh()
    }

    override fun onCleared() {
        try { getApplication<Application>().getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(netCallback) } catch (_: Exception) {}
        super.onCleared()
    }

    fun toast(msg: String) {
        _events.trySend(Event.Toast(msg))
    }

    fun setTab(i: Int) {
        _state.update { it.copy(tab = i) }
        if (i == 1) loadFiles()
    }

    // ------------------------------------------------------------ شروع و ورود

    fun refresh() {
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
            try {
                val cfg = _state.value.config ?: Api.config()
                val me = Api.me()
                if (me == null) {
                    InviteCache.clear(getApplication())
                    _state.update { it.copy(config = cfg, me = null, invite = null, screen = Screen.Login, error = null) }
                } else {
                    _state.update { it.copy(config = cfg, me = me, screen = Screen.Main, error = null) }
                    lastMeRefresh = SystemClock.elapsedRealtime() // اولین onResume بعد از شروع، درخواست تکراری نمی‌فرستد
                    if (me.dailyFree) toast("🎁 اعتبار رایگان امروزت اضافه شد.")
                    Reminders.onMe(getApplication(), me, cfg.dailyFree > 0)
                    askNotifyIfNeverAsked()
                    loadFiles()
                    refreshInvite()
                    viewModelScope.launch { Push.sync(getApplication()) } // توکن FCM (اگر پیکربندی شده باشد)
                    if (me.activeJob != null && _state.value.job == null) watch(me.activeJob)
                    flushShare()
                }
            } catch (e: ApiException) {
                if (_state.value.screen == Screen.Main) toast(e.message ?: "") else
                    _state.update { it.copy(screen = Screen.Error, error = e.message) }
            }
    }

    /** وقتی کاربر از مرورگر (بعد از پرداخت) برمی‌گردد اعتبار را به‌روز می‌کند. */
    fun onResume(force: Boolean = false) {
        recoverPurchases()
        if (_state.value.screen != Screen.Main) return
        refreshLocal() // کار پس‌زمینه ممکن است وقتی اپ بسته بود فایلی ذخیره کرده باشد
        val now = SystemClock.elapsedRealtime()
        val must = force || refreshOnNextResume
        refreshOnNextResume = false
        if (!must && now - lastMeRefresh < RESUME_REFRESH_MS) return
        lastMeRefresh = now
        viewModelScope.launch {
            try {
                Api.me()?.let { me ->
                    _state.update { it.copy(me = me) }
                    Reminders.onMe(getApplication(), me, (_state.value.config?.dailyFree ?: 0) > 0)
                }
            } catch (e: ApiException) { /* بی‌صدا */ }
        }
        refreshInvite()
    }

    /** id: موبایل یا ایمیل (مثل وب در یک کادر). */
    fun sendOtp(id: String) {
        val m = normalizeLoginId(id)
        if (m == null) {
            toast(if ('@' in id) "ایمیل معتبر نیست؛ مثل name@example.com بنویسید" else "شماره‌ی موبایل معتبر نیست؛ مثل 09123456789 بنویسید")
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                Api.otpSend(m)
                _state.update { it.copy(busy = false, otpSent = true, otpTick = it.otpTick + 1) }
                toast(if ('@' in m) "کد به ایمیلتان فرستاده شد" else "کد تأیید ارسال شد")
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false) }
                toast(e.message ?: "")
            }
        }
    }

    /** کد از پیامک خوانده شد (SMS User Consent). */
    fun onSmsCode(code: String) {
        _state.update { it.copy(smsCode = code) }
    }

    fun consumeSmsCode() {
        _state.update { it.copy(smsCode = null) }
    }

    fun notifHint() {
        _events.trySend(Event.NotifHint)
    }

    /**
     * اندروید ۱۳+: مجوز اعلان تا وقتی پرسیده نشود خاموش است و همه‌ی یادآورهای محلی بی‌صدا رد می‌شوند.
     * مجوز دو بار پرسیده می‌شود: ۱) اول کار، بعد از ورود (برای یادآورهای «اولین ارائه‌ات منتظر توست»)،
     * ۲) بعد از آماده‌شدن ارائه (برای اعلان «ارائه آماده شد»). هر مرحله پرچم جداگانه دارد (asked_notif_start / asked_notif_deck)
     * تا هر کدام فقط یک بار پرسیده شود. اگر کاربر قبلاً مجوز داده باشد هیچ‌کدام پرسیده نمی‌شود.
     */
    private fun askNotifyIfNeverAsked() {
        if (android.os.Build.VERSION.SDK_INT < 33) return
        val app = getApplication<Application>()
        val prefs = app.getSharedPreferences("prefs", Context.MODE_PRIVATE)
        // asked_notif = پرچم قدیمی (یک‌بار) برای کاربرانی که قبل از این نسخه پرسیده شده‌اند
        if (prefs.getBoolean("asked_notif_start", false) || prefs.getBoolean("asked_notif", false)) return
        if (androidx.core.app.NotificationManagerCompat.from(app).areNotificationsEnabled()) return
        _events.trySend(Event.AskNotify)
    }

    /** بار دوم: بعد از آماده‌شدن ارائه، اگر هنوز اعلان‌ها خاموش‌اند. */
    private fun askNotifyAfterDeck() {
        if (androidx.core.app.NotificationManagerCompat.from(getApplication<Application>()).areNotificationsEnabled()) return
        _events.trySend(Event.AskNotifyAfterDeck)
    }

    fun editMobile() {
        _state.update { it.copy(otpSent = false) }
    }

    fun verifyOtp(id: String, code: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                Api.otpVerify(normalizeLoginId(id) ?: normDigits(id), normDigits(code))
                // تا آماده‌شدن صفحه‌ی اصلی روی همان صفحه‌ی کد با حالت «در حال ورود» می‌مانیم؛
                // قبلاً otpSent زودتر false می‌شد و چند ثانیه صفحه‌ی شماره دوباره دیده می‌شد
                load()
                _state.update { it.copy(busy = false, otpSent = false) }
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false) }
                toast(e.message ?: "")
            }
        }
    }

    /** نتیجه‌ی برگه‌ی گوگل از LoginScreen؛ ورود مثل پیامک انجام می‌شود. */
    fun googleResult(r: GoogleResult) {
        when (r) {
            is GoogleResult.Cancelled -> {}
            // ورود داخلی ممکن نیست ⇒ همان ورود گوگل در مرورگر؛ در پایان با pptsaz://login به اپ برمی‌گردد
            is GoogleResult.Unavailable -> {
                toast("ورود با گوگل در مرورگر باز می‌شود…")
                _events.trySend(Event.OpenUrl(Api.BASE + "/api/auth/google?app=1"))
            }
            is GoogleResult.Failed -> toast(r.message)
            is GoogleResult.Token -> viewModelScope.launch {
                _state.update { it.copy(busy = true) }
                try {
                    Api.googleLogin(r.idToken)
                    load()
                    _state.update { it.copy(busy = false, otpSent = false) }
                } catch (e: ApiException) {
                    _state.update { it.copy(busy = false) }
                    toast(e.message ?: "ورود با گوگل ناموفق بود")
                }
            }
        }
    }

    /** بازگشت از مرورگر: pptsaz://login?c=<کد> یا ?e=<خطا> */
    fun googleReturn(code: String?, error: String?) {
        if (code.isNullOrEmpty()) {
            if (!error.isNullOrEmpty()) toast("ورود با گوگل ناموفق بود؛ با پیامک وارد شوید.")
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                Api.googleExchange(code)
                load()
                _state.update { it.copy(busy = false, otpSent = false) }
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false) }
                toast(e.message ?: "ورود با گوگل ناموفق بود")
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            pollJob?.cancel()
            Reminders.onLogout(getApplication())
            Push.sync(getApplication(), remove = true) // دستگاه بعد از خروج اعلان تبلیغاتی نگیرد (قبل از پاک‌شدن نشست)
            Api.logout()
            Draft.clear(getApplication())
            FileCache.clear(getApplication())
            InviteCache.clear(getApplication())
            LocalFiles.clear(getApplication())
            form.reset()
            _state.update { UiState(screen = Screen.Login, config = it.config) }
        }
    }

    // ------------------------------------------------------------ ساخت ارائه

    fun generate(topic: String, slides: Int, handout: Boolean, source: String, poster: String?, images: Boolean, audio: Boolean = false, podcast: Boolean = false, imagesMany: Boolean = false) {
        if (topic.trim().length < 3) {
            toast("موضوع ارائه را بنویسید")
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                val id = Api.generate(topic.trim(), slides, handout, source.trim().take(MAX_SOURCE_CHARS), poster, images, audio, podcast, imagesMany)
                _state.update { it.copy(busy = false) }
                if (id.isEmpty()) toast("شروع ساخت انجام نشد") else {
                    watch(id, fresh = true)
                    JobWatcher.schedule(getApplication(), id) // Worker پیش‌زمینه: حتی اگر اپ بسته شد، پیشرفت و اعلان پایان را پیگیری می‌کند
                }
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false) }
                toast(e.message ?: "")
                if (e.needPlan || e.noCredit) _state.update { it.copy(tab = 3) }
            }
        }
    }

    private fun watch(id: String, fresh: Boolean = false) {
        pollJob?.cancel()
        val jobT0 = if (fresh) SystemClock.elapsedRealtime() else 0L // کار ازسرگرفته‌شده زمان شروع ندارد
        var step = 0
        var extra = false
        _state.update { it.copy(job = JobState(id, "در صف ساخت…", startedAt = jobT0)) }
        pollJob = viewModelScope.launch {
            var fails = 0
            val startedAt = SystemClock.elapsedRealtime()
            while (true) {
                try {
                    val j = Api.job(id)
                    fails = 0
                    when (j.optString("state")) {
                        "done" -> {
                            val h = if (j.optString("handout") == "ok") j.optString("handoutId").ifEmpty { null } else null
                            val posterOk = j.optString("poster") == "ok"
                            // اسلاید صوتی / پادکست: "pending" ⇒ در Workflow جدا در حال ساخت (شناسه‌ی کار جدا)؛ "failed" ⇒ شروع نشد و اعتبارش برگشت
                            val audioJob = if (j.optString("audio") == "pending") j.optString("audioId").ifEmpty { null } else null
                            val podcastJob = if (j.optString("podcast") == "pending") j.optString("podcastId").ifEmpty { null } else null
                            _state.update {
                                it.copy(
                                    job = JobState(
                                        id, "آماده شد", done = true, title = j.optString("title"), handoutId = h,
                                        posterId = if (posterOk) j.optString("posterId").ifEmpty { null } else null,
                                        posterFailed = j.optString("poster") == "failed",
                                        audioWaiting = audioJob != null, podcastWaiting = podcastJob != null,
                                        audioFailed = j.optString("audio") == "failed", podcastFailed = j.optString("podcast") == "failed",
                                    )
                                )
                            }
                            if (audioJob != null) watchAudio(id, "audio", audioJob, j.optString("title"))
                            if (podcastJob != null) watchAudio(id, "podcast", podcastJob, j.optString("title"))
                            loadFiles()
                            val app = getApplication<Application>()
                            Reminders.onDeckDone(app) // یادآورهای فعال‌سازی لغو و یادآور «جزوه/پوستر/پادکست» زمان‌بندی می‌شود
                            onResume(force = true) // اعتبار مصرف‌شده یا برگشت‌خورده فوراً به‌روز شود
                            askNotifyAfterDeck() // مجوز اعلان: بار دوم، بعد از آماده‌شدن ارائه
                            // نسخه‌ی محلی (بی‌صدا): فایل‌ها سمت سرور فقط ۲۴ ساعت می‌مانند
                            val deckTitle = j.optString("title")
                            val deckSlides = j.optInt("slides")
                            val posterSave = if (posterOk) j.optString("posterId").ifEmpty { null } else null
                            viewModelScope.launch {
                                if (LocalFiles.autoSave(app, id, deckTitle, deckSlides, h, posterSave)) refreshLocal()
                            }
                            JobWatcher.cancel(app, id)
                            Notifier.cancelProgress(app, id)
                            if (!AppForeground.on) Notifier.done(app, id, j.optString("title"))
                            return@launch
                        }
                        "error" -> {
                            _state.update { it.copy(job = JobState(id, j.optString("message", "ساخت ناموفق بود"), failed = true)) }
                            val app = getApplication<Application>()
                            JobWatcher.cancel(app, id)
                            Notifier.cancelProgress(app, id)
                            if (!AppForeground.on) Notifier.failed(app, id, j.optString("message"))
                            return@launch
                        }
                        else -> {
                            val msg = j.optString("message", "در حال ساخت…")
                            val st = jobStepOf(msg)
                            if (st > 0) { if (st >= step) step = st }
                            else if (step >= 3 && msg.isNotBlank() && !msg.contains("صف")) extra = true
                            _state.update { it.copy(job = JobState(id, msg, step = step, extra = extra, startedAt = jobT0)) }
                            // اعلان پیشرفت (اعلان سرویس پیش‌زمینه‌ی Worker) را به‌روز نگه می‌داریم
                            Notifier.progress(getApplication<Application>(), id, msg, step, extra)
                        }
                    }
                } catch (e: ApiException) {
                    if (e.status == 404 || e.status == 401) {
                        _state.update { it.copy(job = null) }
                        return@launch
                    }
                    fails++
                    // قطعی اینترنت یا خطای موقت سرور، ساخت را متوقف نمی‌کند (کار در سرور ادامه دارد و اعتبارش کم شده است)؛
                    // پس به‌جای «ناموفق» نشان دادن، با فاصله‌ی بیشتر دوباره می‌پرسیم تا وقتی اینترنت برگردد.
                    if (SystemClock.elapsedRealtime() - startedAt > MAX_WATCH_MS) {
                        _state.update {
                            it.copy(job = JobState(id, "ارتباط با سرور برقرار نشد. ارائه ممکن است ساخته شده باشد؛ چند دقیقه بعد تب «فایل‌ها» را بررسی کنید.", failed = true))
                        }
                        return@launch
                    }
                    if (fails >= 3) _state.update { it.copy(job = JobState(id, "اتصال قطع شد؛ ساخت ادامه دارد و دوباره تلاش می‌کنیم…", step = step, extra = extra, startedAt = jobT0)) }
                }
                delay(if (fails >= 3) 8000 else 3000)
            }
        }
    }

    /** باز شدن اپ از روی اعلان: وضعیت/دکمه‌های همان ارائه را روی کارت صفحه‌ی «ساخت» نشان می‌دهد (حتی بعد از بسته‌شدن اپ). */
    fun showJob(id: String) {
        if (id.isEmpty() || _state.value.job?.id == id) return
        watch(id)
    }

    /** کارت ارائه‌ی deckJobId را (اگر هنوز همان کارت جلوی چشم است) به‌روز می‌کند. */
    private fun updateJob(deckJobId: String, f: (JobState) -> JobState) {
        _state.update { st ->
            val jb = st.job
            if (jb != null && jb.id == deckJobId) st.copy(job = f(jb)) else st
        }
    }

    /**
     * پیگیری اسلاید صوتی (kind = "audio") یا پادکست (kind = "podcast") که چند دقیقه بعد از ارائه در سرور ساخته می‌شود.
     * با آماده‌شدن، دکمه‌ی دانلود روی کارت می‌آید و نسخه‌ی محلی (بی‌صدا) روی گوشی ذخیره می‌شود. اگر کاربر کارت را ببندد،
     * فایل‌ها همچنان در تب «فایل‌ها» می‌آیند. شکست ساخت = اعتبار همان برگشته است.
     */
    private fun watchAudio(deckJobId: String, kind: String, jobId: String, title: String) {
        val app = getApplication<Application>()
        // Worker پیش‌زمینه: اگر اپ بسته شد، اعلان پیشرفت زنده و اعلان «آماده شد» را همان پیگیری می‌کند (شناسه‌ی یکتا ⇒ دوبار ساخته نمی‌شود)
        ExtraWatcher.schedule(app, jobId, deckJobId, kind, title, files = false)
        viewModelScope.launch {
            var fails = 0
            val startedAt = SystemClock.elapsedRealtime()
            val stop = {
                updateJob(deckJobId) { if (kind == "audio") it.copy(audioWaiting = false) else it.copy(podcastWaiting = false) }
                Notifier.cancelExtraProgress(app, jobId)
                ExtraWatcher.cancel(app, jobId)
            }
            while (true) {
                try {
                    val j = Api.job(jobId)
                    fails = 0
                    when (j.optString("state")) {
                        "done" -> {
                            val arr = j.optJSONArray("ids")
                            val ids = if (arr == null) emptyList() else (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotEmpty() }
                            updateJob(deckJobId) {
                                if (kind == "audio") it.copy(audioWaiting = false, audioIds = ids, audioFailed = ids.isEmpty())
                                else it.copy(podcastWaiting = false, podcastIds = ids, podcastFailed = ids.isEmpty())
                            }
                            loadFiles()
                            Notifier.cancelExtraProgress(app, jobId)
                            ExtraWatcher.cancel(app, jobId)
                            if (!AppForeground.on) {
                                if (ids.isNotEmpty()) Notifier.extraDone(app, deckJobId, kind, title, files = false)
                                else Notifier.extraFailed(app, deckJobId, kind, "", files = false)
                            }
                            if (ids.isNotEmpty() && LocalFiles.autoSaveExtra(app, title, ids.map { it to kind })) refreshLocal()
                            return@launch
                        }
                        "error" -> {
                            updateJob(deckJobId) {
                                if (kind == "audio") it.copy(audioWaiting = false, audioFailed = true) else it.copy(podcastWaiting = false, podcastFailed = true)
                            }
                            Notifier.cancelExtraProgress(app, jobId)
                            ExtraWatcher.cancel(app, jobId)
                            if (!AppForeground.on) Notifier.extraFailed(app, deckJobId, kind, j.optString("message"), files = false)
                            toast(j.optString("message").ifEmpty { "ساخت فایل صوتی ناموفق بود؛ اعتبارش برگشت." })
                            onResume(force = true) // اعتبار برگشت‌خورده فوراً به‌روز شود
                            return@launch
                        }
                        else -> {
                            // در حال ساخت: متن و درصد زنده روی کارت و در اعلان
                            val msg = j.optString("message")
                            val pct = jobPctOf(j)
                            updateJob(deckJobId) {
                                if (kind == "audio") it.copy(audioMsg = msg, audioPct = pct) else it.copy(podcastMsg = msg, podcastPct = pct)
                            }
                            Notifier.extraProgress(app, jobId, deckJobId, kind, msg, pct, files = false)
                        }
                    }
                } catch (e: ApiException) {
                    if (e.status == 404 || e.status == 401) { stop(); return@launch }
                    fails++
                    if (SystemClock.elapsedRealtime() - startedAt > MAX_WATCH_MS) { stop(); return@launch }
                }
                delay(if (fails >= 3) 8000 else 3000)
            }
        }
    }

    /**
     * دکمه‌ی «ساخت جداگانه» زیر ارائه (کارت «آماده شد» و تب فایل‌ها): پوستر/جزوه/اسلاید صوتی/پادکستی که همراه ارائه نخواسته بودند.
     * ۱ اعتبار جدا کم می‌شود؛ سرور فقط یک بار برای هر ارائه و هر نوع می‌سازد (دوبار زدن اعتبار اضافه نمی‌گیرد).
     * kind = "poster" | "handout" | "audio" | "podcast"؛ layout فقط برای پوستر ("wide" | "tall").
     */
    fun makeExtra(deckId: String, title: String, kind: String, layout: String? = null) {
        val key = "$deckId|$kind"
        if (_state.value.extraJobs.containsKey(key)) return
        _state.update { it.copy(extraJobs = it.extraJobs + (key to ExtraProg("در صف است…"))) }
        viewModelScope.launch {
            try {
                val jobId = Api.startExtra(deckId, kind, layout)
                if (jobId.isEmpty()) throw ApiException("شروع ساخت انجام نشد.")
                toast("⏳ شروع شد؛ ۱ اعتبار کم شد.")
                onResume(force = true) // اعتبار کم‌شده فوراً به‌روز شود
                loadFiles() // دکمه‌ی همین همراه از فهرست سرور برداشته می‌شود
                watchExtra(deckId, kind, jobId, title)
            } catch (e: ApiException) {
                _state.update { it.copy(extraJobs = it.extraJobs - key) }
                toast(e.message ?: "")
                if (e.noCredit || e.needPlan) _state.update { it.copy(tab = 3) } else if (e.status == 409 || e.status == 410) loadFiles()
            }
        }
    }

    /** پیگیری همراهِ خواسته‌شده با دکمه؛ با آماده‌شدن فایل در فهرست می‌آید، روی گوشی ذخیره می‌شود و اگر کارت همان ارائه باز است، دکمه‌ی دانلودش آنجا هم می‌آید. */
    private fun watchExtra(deckId: String, kind: String, jobId: String, title: String) {
        val key = "$deckId|$kind"
        val name = when (kind) { "poster" -> "پوستر"; "handout" -> "جزوه"; "audio" -> "اسلاید صوتی"; else -> "پادکست" }
        val app = getApplication<Application>()
        val audible = kind == "audio" || kind == "podcast" // فقط اسلاید صوتی و پادکست درصد و اعلان پیشرفت دارند
        val finish = {
            _state.update { it.copy(extraJobs = it.extraJobs - key) }
            if (audible) { Notifier.cancelExtraProgress(app, jobId); ExtraWatcher.cancel(app, jobId) }
        }
        // Worker پیش‌زمینه: اگر کاربر از اپ بیرون رفت، اعلان پیشرفت و «آماده شد» را همان پیگیری می‌کند؛ اعلان آماده‌شدن به تب «فایل‌ها» می‌برد
        if (audible) ExtraWatcher.schedule(app, jobId, deckId, kind, title, files = true)
        viewModelScope.launch {
            var fails = 0
            val startedAt = SystemClock.elapsedRealtime()
            while (true) {
                try {
                    val j = Api.job(jobId)
                    fails = 0
                    when (j.optString("state")) {
                        "done" -> {
                            val arr = j.optJSONArray("ids")
                            val ids = if (arr == null) emptyList() else (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotEmpty() }
                            finish()
                            if (ids.isEmpty()) {
                                toast("ساخت $name ناموفق بود؛ اعتبارش برگشت.")
                                if (audible && !AppForeground.on) Notifier.extraFailed(app, deckId, kind, "", files = true)
                            } else {
                                updateJob(deckId) {
                                    when (kind) {
                                        "poster" -> it.copy(posterId = ids.first())
                                        "handout" -> it.copy(handoutId = ids.first())
                                        "audio" -> it.copy(audioIds = ids)
                                        else -> it.copy(podcastIds = ids)
                                    }
                                }
                                Reminders.onExtraMade(app)
                                toast("✅ $name آماده شد؛ در «فایل‌ها» هست.")
                                if (audible && !AppForeground.on) Notifier.extraDone(app, deckId, kind, title, files = true)
                                if (LocalFiles.autoSaveExtra(app, title, ids.map { it to kind })) refreshLocal()
                            }
                            loadFiles()
                            onResume(force = true) // اگر ساخت شکست خورده و اعتبار برگشته، فوراً دیده شود
                            return@launch
                        }
                        "error" -> {
                            finish()
                            if (audible && !AppForeground.on) Notifier.extraFailed(app, deckId, kind, j.optString("message"), files = true)
                            toast(j.optString("message").ifEmpty { "ساخت $name ناموفق بود؛ اعتبارش برگشت." })
                            loadFiles() // دکمه دوباره دیده شود
                            onResume(force = true)
                            return@launch
                        }
                        else -> {
                            val msg = j.optString("message")
                            val pct = jobPctOf(j)
                            if (msg.isNotEmpty() || pct >= 0) {
                                _state.update { it.copy(extraJobs = if (key in it.extraJobs) it.extraJobs + (key to ExtraProg(msg.ifEmpty { it.extraJobs[key]?.msg.orEmpty() }, pct)) else it.extraJobs) }
                            }
                            if (audible) Notifier.extraProgress(app, jobId, deckId, kind, msg, pct, files = true)
                        }
                    }
                } catch (e: ApiException) {
                    if (e.status == 404 || e.status == 401) { finish(); loadFiles(); return@launch }
                    fails++
                    if (SystemClock.elapsedRealtime() - startedAt > MAX_WATCH_MS) { finish(); loadFiles(); return@launch }
                }
                delay(if (fails >= 3) 8000 else 4000)
            }
        }
    }

    fun dismissJob() {
        pollJob?.cancel()
        _state.value.job?.let {
            JobWatcher.cancel(getApplication(), it.id)
            Notifier.cancelProgress(getApplication(), it.id)
        }
        _state.update { it.copy(job = null) }
    }

    // ------------------------------------------------------------ فایل‌ها

    fun loadFiles() {
        viewModelScope.launch {
            _state.update { it.copy(filesLoading = true) }
            try {
                val list = Api.files()
                FileCache.save(getApplication(), list)
                _state.update { it.copy(files = list, filesLoading = false, filesError = false) }
            } catch (e: ApiException) {
                if (e.status == 401) {
                    _state.update { it.copy(filesLoading = false) }
                    refresh()
                } else {
                    // خطای شبکه/سرور: فهرست قبلی (ذخیره‌شده) را نگه می‌داریم و دکمه‌ی تلاش دوباره نشان می‌دهیم
                    _state.update { it.copy(filesLoading = false, filesError = true) }
                }
            }
        }
    }

    fun refreshLocal() {
        val app = getApplication<Application>()
        viewModelScope.launch {
            val list = withContext(Dispatchers.IO) { LocalFiles.list(app) }
            _state.update { it.copy(localFiles = list) }
        }
    }

    fun setPromo(on: Boolean) {
        val app = getApplication<Application>()
        Push.setPromo(app, on)
        _state.update { it.copy(promo = on) }
        viewModelScope.launch { Push.sync(app) }
    }

    fun setAutoSave(on: Boolean) {
        LocalFiles.setAuto(getApplication(), on)
        _state.update { it.copy(autoSave = on) }
    }

    fun deleteLocal(id: String) {
        val app = getApplication<Application>()
        viewModelScope.launch {
            withContext(Dispatchers.IO) { LocalFiles.remove(app, id) }
            refreshLocal()
            toast("از گوشی حذف شد")
        }
    }

    fun download(fileId: String, share: Boolean = false, pkg: String? = null, caption: String = "") {
        viewModelScope.launch {
            // اگر نسخه‌ی محلی داریم، بدون اینترنت (و حتی بعد از ۲۴ ساعت) همان را در Downloads می‌گذاریم
            val app = getApplication<Application>()
            try {
                val saved = withContext(Dispatchers.IO) {
                    LocalFiles.read(app, fileId)?.let { Storage.save(app, it.name, it.mime, it.bytes) }
                }
                if (saved != null) {
                    _events.trySend(Event.FileReady(saved, share, pkg, caption))
                    if (!share) askRateMaybe()
                    return@launch
                }
            } catch (_: Exception) {
                // نسخه‌ی محلی خراب بود؛ از سرور می‌گیریم
            }
            toast("در حال دانلود…")
            try {
                // فایلی که در فهرست سرور هست حتماً وجود دارد؛ فقط فایلِ تازه‌ساخته (هنوز در فهرست نیامده) ممکن است چند ثانیه 404 بدهد
                val listed = _state.value.files.any { it.id == fileId }
                val r = Api.downloadFile(getApplication(), fileId, maxRetries = if (listed) 2 else 20)
                _events.trySend(Event.FileReady(r, share, pkg, caption))
                if (!share) askRateMaybe()
            } catch (e: ApiException) {
                toast(e.message ?: "دانلود انجام نشد")
            } catch (e: Exception) {
                toast("ذخیره‌ی فایل انجام نشد")
            }
        }
    }

    /** دانلود نسخه‌ی PDF ارائه (ساخت روی سرور ممکن است تا یک دقیقه طول بکشد). */
    fun downloadPdf(fileId: String, share: Boolean = false, pkg: String? = null, caption: String = "") {
        viewModelScope.launch {
            toast("در حال ساخت PDF؛ ممکن است تا یک دقیقه طول بکشد…")
            try {
                _events.trySend(Event.FileReady(Api.downloadPdf(getApplication(), fileId), share, pkg, caption))
                if (!share) askRateMaybe()
            } catch (e: ApiException) {
                toast(e.message ?: "ساخت PDF انجام نشد")
            } catch (e: Exception) {
                toast("ذخیره‌ی PDF انجام نشد")
            }
        }
    }

    // ------------------------------------------------------------ منبع: فایل و لینک

    /** از MainActivity صدا زده می‌شود. اگر هنوز وارد نشده‌ایم، بعد از ورود اجرا می‌شود. */
    fun onShare(share: Share) {
        pendingShare = share
        flushShare()
    }

    private fun flushShare() {
        val sh = pendingShare ?: return
        if (_state.value.screen != Screen.Main) return
        pendingShare = null
        _state.update { it.copy(tab = 0) }
        when (sh) {
            is Share.FileShare -> importFiles(sh.uris)
            is Share.TextShare -> {
                val t = sh.text.trim()
                if (Regex("^https?://\\S+$").matches(t)) importLink(t)
                else {
                    _state.update { it.copy(extractedText = t.take(MAX_SOURCE_CHARS)) }
                    toast("متن به منبع اضافه شد")
                }
            }
        }
    }

    /** App Link https://pptsaz.ir/open?topic=...: موضوع را در فرم «ساخت» می‌گذارد و تب خواسته‌شده را باز می‌کند (ساخت را خود کاربر شروع می‌کند). */
    fun openFromLink(topic: String?, tab: Int) {
        val t = topic.orEmpty().replace(Regex("\\s+"), " ").trim().take(300)
        if (t.length >= 3) {
            form.topic = t
            Draft.save(getApplication(), form)
        }
        setTab(tab)
    }

    // ------------------------------------------------------------ درخواست امتیاز

    private fun askRateMaybe() {
        if (RatePrompt.onExport(getApplication())) _state.update { it.copy(rateAsk = true) }
    }

    /** «بعداً» یا بستن پنجره؛ شمارش دفعه‌ها و فاصله‌ی بین آن‌ها در RatePrompt نگه داشته شده است. */
    fun rateLater() {
        _state.update { it.copy(rateAsk = false) }
    }

    /** کاربر «ثبت نظر» را زد؛ دیگر پرسیده نمی‌شود. */
    fun rateDone() {
        RatePrompt.done(getApplication())
        _state.update { it.copy(rateAsk = false) }
    }

    fun consumeExtracted() {
        _state.update { it.copy(extractedText = null) }
    }

    fun consumeExtractedTopic() {
        _state.update { it.copy(extractedTopic = null) }
    }

    /** نوع فایل: اول از سیستم، و اگر نامشخص بود از پسوند نام فایل. */
    private fun detectMime(ctx: Context, uri: Uri): String {
        val t = ctx.contentResolver.getType(uri).orEmpty().lowercase()
        if (t.isNotEmpty() && t != "application/octet-stream") return t
        var name = ""
        try {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) name = it.getString(0).orEmpty()
            }
        } catch (_: Exception) {
        }
        return when (name.substringAfterLast('.', "").lowercase()) {
            "pdf" -> "application/pdf"
            "docx" -> DocReader.DOCX_MIME
            "txt", "md", "csv", "json" -> "text/plain"
            "html", "htm" -> "text/html"
            "pptx" -> DocReader.PPTX_MIME
            "xlsx" -> DocReader.XLSX_MIME
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "heic", "heif" -> "image/heic"
            "mp3" -> "audio/mpeg"
            "m4a" -> "audio/mp4"
            "wav" -> "audio/wav"
            "ogg", "oga", "opus" -> "audio/ogg"
            "flac" -> "audio/flac"
            "aac" -> "audio/aac"
            "amr" -> "audio/amr"
            else -> t
        }
    }

    /** متن یک فایل (PDF/عکس با سرور؛ Word و txt روی خود گوشی) را برمی‌گرداند. */
    private suspend fun readSource(ctx: Context, uri: Uri, status: (String) -> Unit): String {
        val mime = detectMime(ctx, uri)
        val supported = mime == "application/pdf" || mime.startsWith("image/") || mime == DocReader.DOCX_MIME ||
            mime == DocReader.PPTX_MIME || mime == DocReader.XLSX_MIME ||
            mime.startsWith("text/") || mime == "application/json" || mime.startsWith("audio/")
        if (!supported) throw ApiException("فقط PDF، عکس، Word، PowerPoint، Excel، HTML، فایل متنی (txt, csv, json, md) یا فایل صوتی پشتیبانی می‌شود.")
        if (mime.startsWith("audio/")) {
            if (_state.value.config?.voice != true) throw ApiException("ورودی صوتی فعال نیست؛ موضوع را بنویسید.")
            if (mime !in AUDIO_MIMES) throw ApiException("این نوع فایل صوتی پشتیبانی نمی‌شود؛ mp3، m4a، wav، ogg، flac یا aac بدهید.")
        }
        val bytes = withContext(Dispatchers.IO) {
            ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        } ?: throw ApiException("فایل خوانده نشد.")
        return when {
            mime == "application/pdf" -> {
                if (bytes.size > 24 * 1024 * 1024) throw ApiException("حجم PDF بیشتر از ۲۴ مگابایت است.")
                status("در حال استخراج متن (ممکن است چند دقیقه طول بکشد)…")
                Api.extractText(bytes, mime)
            }
            mime.startsWith("image/") -> {
                // همه‌ی عکس‌ها (WebP/HEIC هم) با جهت درست و حجم مناسب به JPEG تبدیل می‌شوند
                val jpg = try {
                    withContext(Dispatchers.Default) { Images.normalize(bytes) }
                } catch (e: Exception) {
                    throw ApiException("این عکس خوانده نشد.")
                }
                status("در حال استخراج متن (ممکن است چند دقیقه طول بکشد)…")
                Api.extractText(jpg, "image/jpeg")
            }
            mime.startsWith("audio/") -> {
                // ویس/فایل صوتی روی سرور (Deepgram) به متن تبدیل می‌شود
                if (bytes.size > 24 * 1024 * 1024) throw ApiException("حجم فایل صوتی بیشتر از ۲۴ مگابایت است.")
                status("در حال تبدیل صدا به متن…")
                Api.extractText(bytes, mime)
            }
            mime == DocReader.DOCX_MIME -> {
                val t = withContext(Dispatchers.Default) {
                    try { DocReader.docxToText(bytes) } catch (e: Exception) { throw ApiException("فایل Word قابل خواندن نیست.") }
                }
                t.ifBlank { throw ApiException("متنی در فایل Word پیدا نشد.") }
            }
            mime == DocReader.PPTX_MIME -> {
                val t = withContext(Dispatchers.Default) {
                    try { DocReader.pptxToText(bytes) } catch (e: Exception) { throw ApiException("فایل PowerPoint قابل خواندن نیست.") }
                }
                t.ifBlank { throw ApiException("متنی در فایل PowerPoint پیدا نشد.") }
            }
            mime == DocReader.XLSX_MIME -> {
                val t = withContext(Dispatchers.Default) {
                    try { DocReader.xlsxToText(bytes) } catch (e: Exception) { throw ApiException("فایل Excel قابل خواندن نیست.") }
                }
                t.ifBlank { throw ApiException("داده‌ای در فایل Excel پیدا نشد.") }
            }
            mime == "text/html" -> DocReader.htmlToText(DocReader.plainText(bytes)).ifBlank { throw ApiException("متنی در فایل HTML پیدا نشد.") }
            else -> DocReader.plainText(bytes).ifBlank { throw ApiException("فایل متنی خالی است.") }
        }
    }

    /** یک یا چند فایل (انتخاب‌گر، دوربین یا اشتراک‌گذاری)؛ متن همه‌ی آن‌ها پشت‌سرهم به منبع اضافه می‌شود. */
    fun importFiles(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val ctx = getApplication<Application>()
        viewModelScope.launch {
            val parts = ArrayList<String>()
            var failed = 0
            var lastError = ""
            val audioSingle = uris.size == 1 && detectMime(ctx, uris[0]).startsWith("audio/")
            for ((idx, uri) in uris.withIndex()) {
                val label = if (uris.size > 1) " (" + (idx + 1).fa() + " از " + uris.size.fa() + ")" else ""
                _state.update { it.copy(extractBusy = "در حال خواندن فایل$label…") }
                try {
                    parts += readSource(ctx, uri) { msg -> _state.update { it.copy(extractBusy = msg + label) } }
                } catch (e: ApiException) {
                    failed++
                    lastError = e.message ?: ""
                } catch (e: Exception) {
                    failed++
                    lastError = "خواندن فایل انجام نشد"
                }
            }
            val full = parts.joinToString("\n\n")
            val text = full.take(MAX_SOURCE_CHARS)
            val truncated = full.length > MAX_SOURCE_CHARS
            // یک ویس/فایل صوتیِ کوتاه (تا ۶۰۰ نویسه) = موضوع؛ بلندتر = منبع ارائه
            val asTopic = audioSingle && parts.size == 1 && full.trim().length in 3..600
            _state.update { it.copy(extractBusy = null, extractedText = if (asTopic) null else text.ifEmpty { null }, extractedTopic = if (asTopic) full.trim() else null) }
            when {
                asTopic -> toast("متن صدا آماده شد")
                parts.isEmpty() -> toast(lastError.ifEmpty { "خواندن فایل انجام نشد" })
                failed > 0 -> toast("متن " + parts.size.fa() + " فایل اضافه شد؛ " + failed.fa() + " فایل خوانده نشد. " + lastError)
                truncated -> toast("متن فایل خیلی بلند بود؛ فقط " + MAX_SOURCE_CHARS.fa() + " نویسه‌ی اول به منبع اضافه شد")
                else -> toast(if (parts.size > 1) "متن فایل‌ها به منبع اضافه شد" else "متن فایل به منبع اضافه شد")
            }
        }
    }

    fun importLink(url: String) {
        if (url.isBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(extractBusy = "در حال خواندن صفحه‌ی وب…") }
            try {
                val text = Api.linkSource(url.trim())
                _state.update { it.copy(extractBusy = null, extractedText = text) }
                toast("متن صفحه به منبع اضافه شد")
            } catch (e: ApiException) {
                _state.update { it.copy(extractBusy = null) }
                toast(e.message ?: "")
            }
        }
    }

    // ------------------------------------------------------------ نمایش پوستر / پیش‌نمایش

    fun openViewer(v: Viewer) {
        _state.update { it.copy(viewer = v) }
    }

    fun closeViewer() {
        val wasOpen = _state.value.viewer != null
        _state.update { it.copy(viewer = null) }
        // دیدن فایل داخل اپ (بدون دانلود) هم یک استفاده حساب می‌شود؛ پنجره بعد از بسته شدن نمایشگر می‌آید
        if (wasOpen && RatePrompt.onView(getApplication())) _state.update { it.copy(rateAsk = true) }
    }

    // ------------------------------------------------------------ پروفایل

    private suspend fun reloadMe() {
        Api.me()?.let { me ->
            _state.update { it.copy(me = me) }
            Reminders.onMe(getApplication(), me, (_state.value.config?.dailyFree ?: 0) > 0)
        }
    }

    /** موبایل (09…) یا ایمیلِ تمیزشده؛ نامعتبر = null */
    private fun normContact(kind: String, raw: String): String? =
        if (kind == "email") normalizeEmail(raw) else normalizeIranMobile(raw)

    /** ثبت موبایل/ایمیل در پروفایل ← ۱: ارسال کد (پیامک یا ایمیل). onDone(true) = کد فرستاده شد. */
    fun sendContactCode(kind: String, raw: String, onDone: (Boolean) -> Unit) {
        val v = normContact(kind, raw)
        if (v == null) {
            toast(if (kind == "email") "ایمیل معتبر نیست؛ مثل name@example.com بنویسید" else "شماره‌ی موبایل معتبر نیست؛ مثل 09123456789 بنویسید")
            onDone(false)
            return
        }
        viewModelScope.launch {
            try {
                Api.contactSend(kind, v)
                toast(if (kind == "email") "کد به ایمیلتان فرستاده شد" else "کد تأیید پیامک شد")
                onDone(true)
            } catch (e: ApiException) {
                toast(e.message ?: "")
                onDone(false)
            }
        }
    }

    /** ← ۲: تایید کد و ثبت؛ اگر هدیه‌ای اضافه شد همان لحظه اعلام و اعتبار صفحه به‌روز می‌شود. */
    fun verifyContact(kind: String, raw: String, code: String, onDone: (Boolean) -> Unit) {
        val v = normContact(kind, raw)
        if (v == null) { onDone(false); return }
        viewModelScope.launch {
            try {
                val reward = Api.contactVerify(kind, v, normDigits(code))
                reloadMe()
                toast(
                    (if (kind == "email") "ایمیل ثبت شد" else "شماره‌ی موبایل ثبت شد") +
                        (if (reward > 0) " — " + reward.fa() + " اعتبار هدیه گرفتید 🎁" else ""),
                )
                onDone(true)
            } catch (e: ApiException) {
                toast(e.message ?: "")
                onDone(false)
            }
        }
    }

    /**
     * دعوت دوستان (همان سامانه‌ی ربات‌ها و سایت): اطلاعات دعوت در پس‌زمینه گرفته و در state نگه داشته می‌شود
     * (هنگام شروع اپ و برگشت به آن)؛ پس کارت دعوت هنگام باز شدن «حساب من» فوراً با آخرین مقدار نمایش داده می‌شود و فقط آمار بعداً به‌روز می‌شود.
     * خطای شبکه مقدار قبلی را نگه می‌دارد.
     */
    fun refreshInvite() {
        viewModelScope.launch {
            try {
                val d = Api.invite()
                if (_state.value.screen != Screen.Main) return@launch // وسط خروج از حساب: دعوت حساب قبلی ذخیره/نمایش داده نشود
                InviteCache.save(getApplication(), d)
                _state.update { it.copy(invite = d) }
            } catch (_: ApiException) { /* مقدار قبلی می‌ماند */ }
        }
    }

    /** ثبت کد دعوت دوست؛ پاداش دعوت‌کننده با ساخت اولین ارائه‌ی همین حساب شمرده می‌شود. */
    fun claimInvite(raw: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            try {
                Api.inviteClaim(raw)
                toast("کد دعوت ثبت شد 🎁")
                refreshInvite()
                onDone(true)
            } catch (e: ApiException) {
                toast(e.message ?: "")
                onDone(false)
            }
        }
    }

    fun updateName(name: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            try {
                Api.updateName(name.trim())
                reloadMe()
                toast("نام ذخیره شد")
                onDone(true)
            } catch (e: ApiException) {
                toast(e.message ?: "")
                onDone(false)
            }
        }
    }

    // ------------------------------------------------------------ تنظیمات و خرید

    private fun applySetting(s: Settings, key: String, value: Any): Settings = when (key) {
        "theme" -> s.copy(theme = value as String)
        "template" -> s.copy(template = value as String)
        "tone" -> s.copy(tone = value as String)
        "font" -> s.copy(font = value as String)
        "model" -> s.copy(model = value as String)
        "mode" -> s.copy(mode = value as String)
        "slides" -> s.copy(slides = value as Int)
        "images" -> s.copy(images = value as Boolean)
        "imagesMany" -> s.copy(imagesMany = value as Boolean)
        "digits" -> s.copy(digits = value as Boolean)
        "sources" -> s.copy(sources = value as Boolean)
        "questions" -> s.copy(questions = value as Boolean)
        else -> s
    }

    /** تنظیم را بلافاصله در صفحه اعمال می‌کند (بدون انتظار برای شبکه)؛ اگر سرور نپذیرفت به مقدار قبلی برمی‌گردد. */
    fun setSetting(key: String, value: Any) {
        val before = _state.value.me?.settings ?: return
        _state.update { st -> st.copy(me = st.me?.let { m -> m.copy(settings = applySetting(m.settings, key, value)) }) }
        viewModelScope.launch {
            try {
                Api.putSetting(key, value)
            } catch (e: ApiException) {
                // فقط همان کلید را برمی‌گردانیم؛ اگر کاربر در این فاصله تنظیم دیگری را عوض کرده، دست نمی‌خورد
                val old: Any = when (key) {
                    "theme" -> before.theme
                    "template" -> before.template
                    "tone" -> before.tone
                    "font" -> before.font
                    "model" -> before.model
                    "mode" -> before.mode
                    "slides" -> before.slides
                    "images" -> before.images
                    "imagesMany" -> before.imagesMany
                    "digits" -> before.digits
                    "sources" -> before.sources
                    "questions" -> before.questions
                    else -> value
                }
                _state.update { st -> st.copy(me = st.me?.let { m -> m.copy(settings = applySetting(m.settings, key, old)) }) }
                toast(e.message ?: "")
            }
        }
    }

    /** سطح تصویر اسلایدها: ۰ = خیر، ۱ = نرمال، ۲ = زیاد (فقط پلن‌دارها؛ تعداد نرمال + ۱). هر دو تنظیم با هم و در یک درخواست ذخیره می‌شوند. */
    fun setImageLevel(level: Int) {
        val before = _state.value.me?.settings ?: return
        if (level == 2 && _state.value.me?.premium != true) {
            toast("تصویر «زیاد» فقط برای کاربران دارای پلن پلاس/پرو فعال است")
            return
        }
        val images = level > 0
        val many = level == 2
        _state.update { st -> st.copy(me = st.me?.let { m -> m.copy(settings = m.settings.copy(images = images, imagesMany = many)) }) }
        viewModelScope.launch {
            try {
                Api.putSettings("images" to images, "imagesMany" to many)
            } catch (e: ApiException) {
                _state.update { st -> st.copy(me = st.me?.let { m -> m.copy(settings = m.settings.copy(images = before.images, imagesMany = before.imagesMany)) }) }
                toast(e.message ?: "")
            }
        }
    }

    fun openUrl(url: String) {
        refreshOnNextResume = true
        _events.trySend(Event.OpenUrl(url))
    }

    private var updateAsked = false

    /** یک بار در هر اجرا: اگر نسخه‌ی جدیدتری منتشر شده، پیشنهاد به‌روزرسانی نشان بده. */
    fun maybeAskUpdate() {
        val c = _state.value.config ?: return
        if (Store.NATIVE_UPDATE) {
            // مایکت خودش نسخه را مقایسه می‌کند و فقط اگر نسخه‌ی جدیدتری باشد دیالوگ نشان می‌دهد
            if (!updateAsked) { updateAsked = true; _events.trySend(Event.NativeUpdate(c.updateUrl, manual = false)) }
            return
        }
        if (!updateAsked && c.latestVersion > BuildConfig.VERSION_CODE) {
            updateAsked = true
            _state.update { it.copy(updateDialog = true) }
        }
    }

    fun showUpdateDialog() { _state.update { it.copy(updateDialog = true) } }

    fun startUpdate(url: String) { refreshOnNextResume = true; _events.trySend(Event.StartUpdate(url)) }

    fun dismissUpdate() {
        _state.update { it.copy(updateDialog = false) }
    }

    /** دکمه‌ی «بررسی به‌روزرسانی» در تب حساب: تنظیمات را تازه می‌گیرد و نتیجه را می‌گوید. */
    fun checkUpdate() {
        viewModelScope.launch {
            try {
                val c = Api.config()
                _state.update { it.copy(config = c) }
                if (Store.NATIVE_UPDATE && c.minVersion <= BuildConfig.VERSION_CODE) {
                    _events.trySend(Event.NativeUpdate(c.updateUrl, manual = true))
                } else if (c.latestVersion > BuildConfig.VERSION_CODE || c.minVersion > BuildConfig.VERSION_CODE) {
                    _state.update { it.copy(updateDialog = true) }
                } else {
                    toast("نسخه‌ی شما به‌روز است ✓")
                }
            } catch (e: ApiException) {
                toast(e.message ?: "")
            }
        }
    }

    fun setBazaarReady(ok: Boolean) {
        _state.update { it.copy(bazaarReady = ok) }
    }

    /** بررسی دوباره‌ی خریدهای پرداخت‌شده ولی تاییدنشده (MainActivity با تغییر این شمارنده حلقه‌ی بازیابی را دوباره شروع می‌کند). */
    fun recoverPurchases() {
        _state.update { it.copy(billingTick = it.billingTick + 1) }
    }

    /** توکن‌هایی که همین الان در حال تایید روی سرورند، و توکن‌هایی که سرور قطعی رد کرده (در این نشست دوباره فرستاده نمی‌شوند). */
    private val claiming = HashSet<String>()
    private val rejected = HashSet<String>()

    /** خطای شبکه/سرور/محدودیت موقت: خرید سالم است و باید دوباره امتحان شود. */
    private fun retryable(e: ApiException) = e.status == 0 || e.status == 408 || e.status == 425 || e.status == 429 || e.status >= 500

    /**
     * خرید را روی سرور تایید می‌کند و در خطای موقت تا چند بار (با فاصله‌ی افزایشی) دوباره می‌فرستد.
     * اگر موفق بود onDone(true) تا خرید «مصرف» شود؛ اگر نه، خرید مصرف‌نشده در بازار می‌ماند و حلقه‌ی بازیابی بعداً دوباره تایید می‌کند.
     * silent برای بازیابی خریدهای قبلی.
     */
    fun bazaarClaim(productId: String, token: String, silent: Boolean = false, onDone: (Boolean) -> Unit) {
        if (token in rejected || !claiming.add(token)) return
        viewModelScope.launch {
            try {
                if (!silent) toast("در حال تایید خرید…")
                val tries = if (silent) 3 else 6
                var last: ApiException? = null
                for (i in 1..tries) {
                    try {
                        Api.bazaarVerify(productId, token)
                        last = null
                        break
                    } catch (e: ApiException) {
                        last = e
                        if (!retryable(e)) break
                        if (i < tries) delay(CLAIM_DELAYS_MS[(i - 1).coerceAtMost(CLAIM_DELAYS_MS.size - 1)])
                    }
                }
                val err = last
                if (err == null) {
                    try { reloadMe() } catch (_: ApiException) { /* پلن فعال شده؛ تازه‌سازی حساب بعداً هم انجام می‌شود */ }
                    toast(if (silent) "خرید قبلی شما تایید و اشتراک فعال شد ✓" else "اشتراک فعال شد ✓")
                    onDone(true)
                    return@launch
                }
                Api.reportPay("verify_" + err.status, err.message.orEmpty(), productId)
                when {
                    err.status == 401 -> if (!silent) toast("برای فعال‌سازی اشتراک وارد حساب شوید. پرداخت شما در " + Store.NAME_FA + " محفوظ است.")
                    retryable(err) -> if (!silent) toast("پرداخت شما در " + Store.NAME_FA + " ثبت شده و از بین نمی‌رود؛ به‌محض برقراری ارتباط با سرور، اشتراک خودکار فعال می‌شود.")
                    else -> {
                        rejected.add(token)
                        if (!silent) toast(err.message ?: "")
                    }
                }
                onDone(false)
            } finally {
                claiming.remove(token)
            }
        }
    }

    private var buyJob: Job? = null

    /**
     * خرید فقط از طریق فروشگاه (بازار/مایکت) انجام می‌شود؛ هیچ درگاه وبی (دیجی‌پی) در اپ نیست.
     * اگر تنظیمات سرور نرسیده یا اتصال به فروشگاه هنوز برقرار نیست، چند بار دوباره وصل می‌شود و در نهایت خطای مشخص می‌دهد.
     */
    fun buy(planId: String) {
        if (buyJob?.isActive == true) return
        val sku = "plan_$planId"
        buyJob = viewModelScope.launch {
            if (_state.value.config?.bazaar != true) {
                for (i in 1..3) {
                    try {
                        val c = Api.config()
                        _state.update { it.copy(config = c) }
                        break
                    } catch (_: ApiException) {
                        if (i < 3) delay(1_500)
                    }
                }
            }
            if (_state.value.config?.bazaar != true) {
                val noCfg = _state.value.config == null
                Api.reportPay(if (noCfg) "no_config" else "server_disabled", "", sku)
                toast(
                    if (noCfg) "اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید."
                    else "پرداخت درون‌برنامه‌ای موقتاً در دسترس نیست. چند دقیقه بعد دوباره تلاش کنید.",
                )
                return@launch
            }
            if (!_state.value.bazaarReady) {
                toast("در حال اتصال به " + Store.NAME_FA + "…")
                var ok = withTimeoutOrNull(4_000) { _state.first { it.bazaarReady } } != null
                var n = 0
                while (!ok && n < 2) {
                    n++
                    _events.trySend(Event.BillingReconnect)
                    ok = withTimeoutOrNull(6_000) { _state.first { it.bazaarReady } } != null
                }
            }
            if (!_state.value.bazaarReady) {
                Api.reportPay("store_not_ready", "", sku)
                toast("اتصال به " + Store.NAME_FA + " برقرار نشد. مطمئن شوید برنامه‌ی " + Store.NAME_FA + " نصب است و وارد حساب خود شده‌اید، سپس دوباره تلاش کنید.")
                return@launch
            }
            _events.trySend(Event.BazaarBuy(sku))
        }
    }

    fun openSite() {
        refreshOnNextResume = true
        _events.trySend(Event.OpenUrl(Api.BASE))
    }
}
