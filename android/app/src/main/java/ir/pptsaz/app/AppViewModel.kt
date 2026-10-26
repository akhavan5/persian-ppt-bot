package ir.pptsaz.app

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class Screen { Loading, Error, Login, Main }

data class JobState(
    val id: String,
    val message: String,
    val done: Boolean = false,
    val failed: Boolean = false,
    val title: String = "",
    val handoutId: String? = null,
    val posterId: String? = null,
    val posterFailed: Boolean = false,
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
    val filesLoading: Boolean = false,
    val tab: Int = 0,
    val busy: Boolean = false,
    val otpSent: Boolean = false,
    val error: String? = null,
    val job: JobState? = null,
    val extractBusy: String? = null,
    val extractedText: String? = null,
    val viewer: Viewer? = null,
    val bazaarReady: Boolean = false,
    val updateDialog: Boolean = false,
    val filesError: Boolean = false, // آخرین بارگیری فهرست فایل‌ها به خاطر شبکه ناموفق بود (فهرست ذخیره‌شده نمایش داده می‌شود)
)

sealed interface Event {
    data class Toast(val msg: String) : Event
    data class OpenUrl(val url: String) : Event
    data class OpenFile(val uri: Uri, val mime: String, val name: String) : Event
    data class BazaarBuy(val sku: String) : Event
    data object AskNotify : Event
}

/** چیزی که برنامه‌ی دیگری از «اشتراک‌گذاری» به اپ فرستاده */
sealed interface Share {
    data class FileShare(val uri: Uri) : Share
    data class TextShare(val text: String) : Share
}

private const val MAX_SOURCE_CHARS = 100_000

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    private val _events = Channel<Event>(Channel.BUFFERED)
    val events = _events.receiveAsFlow()

    private var pollJob: Job? = null

    private var pendingShare: Share? = null

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
        _state.update { it.copy(files = FileCache.load(app)) }
        viewModelScope.launch { CrashReporter.sendPending(app) }
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
        viewModelScope.launch {
            try {
                val cfg = _state.value.config ?: Api.config()
                val me = Api.me()
                if (me == null) {
                    _state.update { it.copy(config = cfg, me = null, screen = Screen.Login, error = null) }
                } else {
                    _state.update { it.copy(config = cfg, me = me, screen = Screen.Main, error = null) }
                    if (me.dailyFree) toast("🎁 اعتبار رایگان امروزت اضافه شد.")
                    loadFiles()
                    if (me.activeJob != null && _state.value.job == null) watch(me.activeJob)
                    flushShare()
                }
            } catch (e: ApiException) {
                if (_state.value.screen == Screen.Main) toast(e.message ?: "") else
                    _state.update { it.copy(screen = Screen.Error, error = e.message) }
            }
        }
    }

    /** وقتی کاربر از مرورگر (بعد از پرداخت) برمی‌گردد اعتبار را به‌روز می‌کند. */
    fun onResume() {
        if (_state.value.screen != Screen.Main) return
        viewModelScope.launch {
            try {
                Api.me()?.let { me -> _state.update { it.copy(me = me) } }
            } catch (e: ApiException) { /* بی‌صدا */ }
        }
    }

    fun sendOtp(mobile: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                Api.otpSend(normDigits(mobile))
                _state.update { it.copy(busy = false, otpSent = true) }
                toast("کد تأیید ارسال شد")
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false) }
                toast(e.message ?: "")
            }
        }
    }

    fun editMobile() {
        _state.update { it.copy(otpSent = false) }
    }

    fun verifyOtp(mobile: String, code: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                Api.otpVerify(normDigits(mobile), normDigits(code))
                _state.update { it.copy(busy = false, otpSent = false) }
                refresh()
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false) }
                toast(e.message ?: "")
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            pollJob?.cancel()
            Api.logout()
            Draft.clear(getApplication())
            FileCache.clear(getApplication())
            _state.update { UiState(screen = Screen.Login, config = it.config) }
        }
    }

    // ------------------------------------------------------------ ساخت ارائه

    fun generate(topic: String, slides: Int, handout: Boolean, source: String, poster: String?, images: Boolean) {
        if (topic.trim().length < 3) {
            toast("موضوع ارائه را بنویسید")
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                val id = Api.generate(topic.trim(), slides, handout, source.trim().take(MAX_SOURCE_CHARS), poster, images)
                _state.update { it.copy(busy = false) }
                if (id.isEmpty()) toast("شروع ساخت انجام نشد") else {
                    watch(id)
                    JobWatcher.schedule(getApplication(), id) // اگر اپ بسته شد، با اعلان خبر می‌دهیم
                    _events.trySend(Event.AskNotify)
                }
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false) }
                toast(e.message ?: "")
                if (e.needPlan || e.noCredit) _state.update { it.copy(tab = 3) }
            }
        }
    }

    private fun watch(id: String) {
        pollJob?.cancel()
        _state.update { it.copy(job = JobState(id, "در صف ساخت…")) }
        pollJob = viewModelScope.launch {
            var fails = 0
            while (true) {
                try {
                    val j = Api.job(id)
                    fails = 0
                    when (j.optString("state")) {
                        "done" -> {
                            val h = if (j.optString("handout") == "ok") j.optString("handoutId").ifEmpty { null } else null
                            val posterOk = j.optString("poster") == "ok"
                            _state.update {
                                it.copy(
                                    job = JobState(
                                        id, "آماده شد", done = true, title = j.optString("title"), handoutId = h,
                                        posterId = if (posterOk) j.optString("posterId").ifEmpty { null } else null,
                                        posterFailed = j.optString("poster") == "failed",
                                    )
                                )
                            }
                            loadFiles()
                            onResume()
                            val app = getApplication<Application>()
                            JobWatcher.cancel(app, id)
                            if (!AppForeground.on) Notifier.done(app, id, j.optString("title"))
                            return@launch
                        }
                        "error" -> {
                            _state.update { it.copy(job = JobState(id, j.optString("message", "ساخت ناموفق بود"), failed = true)) }
                            val app = getApplication<Application>()
                            JobWatcher.cancel(app, id)
                            if (!AppForeground.on) Notifier.failed(app, id, j.optString("message"))
                            return@launch
                        }
                        else -> _state.update { it.copy(job = JobState(id, j.optString("message", "در حال ساخت…"))) }
                    }
                } catch (e: ApiException) {
                    if (e.status == 404 || e.status == 401) {
                        _state.update { it.copy(job = null) }
                        return@launch
                    }
                    fails++
                    if (fails > 20) {
                        _state.update { it.copy(job = JobState(id, e.message ?: "قطع ارتباط", failed = true)) }
                        return@launch
                    }
                }
                delay(3000)
            }
        }
    }

    fun dismissJob() {
        pollJob?.cancel()
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

    fun download(fileId: String) {
        viewModelScope.launch {
            toast("در حال دانلود…")
            try {
                val r = Api.downloadFile(getApplication(), fileId)
                _events.trySend(Event.OpenFile(r.uri, r.mime, r.name))
            } catch (e: ApiException) {
                toast(e.message ?: "دانلود انجام نشد")
            } catch (e: Exception) {
                toast("ذخیره‌ی فایل انجام نشد")
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
            is Share.FileShare -> importFile(sh.uri)
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

    fun consumeExtracted() {
        _state.update { it.copy(extractedText = null) }
    }

    fun importFile(uri: Uri) {
        val ctx = getApplication<Application>()
        viewModelScope.launch {
            _state.update { it.copy(extractBusy = "در حال خواندن فایل…") }
            try {
                val mime = ctx.contentResolver.getType(uri) ?: ""
                if (mime != "application/pdf" && mime != "image/png" && mime != "image/jpeg") {
                    throw ApiException("فقط PDF یا عکس PNG/JPG پشتیبانی می‌شود.")
                }
                var bytes = withContext(Dispatchers.IO) {
                    ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                } ?: throw ApiException("فایل خوانده نشد.")
                var m = mime
                if (mime.startsWith("image/") && bytes.size > 3_800_000) {
                    bytes = withContext(Dispatchers.Default) { Images.shrink(bytes) }
                    m = "image/jpeg"
                } else if (mime == "application/pdf" && bytes.size > 24 * 1024 * 1024) {
                    throw ApiException("حجم PDF بیشتر از ۲۴ مگابایت است.")
                }
                _state.update { it.copy(extractBusy = "در حال استخراج متن (ممکن است چند دقیقه طول بکشد)…") }
                val text = Api.extractText(bytes, m)
                _state.update { it.copy(extractBusy = null, extractedText = text) }
                toast("متن فایل به منبع اضافه شد")
            } catch (e: ApiException) {
                _state.update { it.copy(extractBusy = null) }
                toast(e.message ?: "")
            } catch (e: Exception) {
                _state.update { it.copy(extractBusy = null) }
                toast("خواندن فایل انجام نشد")
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
        _state.update { it.copy(viewer = null) }
    }

    // ------------------------------------------------------------ پروفایل

    private suspend fun reloadMe() {
        Api.me()?.let { me -> _state.update { it.copy(me = me) } }
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
        "digits" -> s.copy(digits = value as Boolean)
        "sources" -> s.copy(sources = value as Boolean)
        "questions" -> s.copy(questions = value as Boolean)
        else -> s
    }

    fun setSetting(key: String, value: Any) {
        viewModelScope.launch {
            try {
                Api.putSetting(key, value)
                _state.update { st -> st.copy(me = st.me?.let { m -> m.copy(settings = applySetting(m.settings, key, value)) }) }
            } catch (e: ApiException) {
                toast(e.message ?: "")
            }
        }
    }

    fun telegramSend(tgId: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            try {
                val sent = Api.telegramSend(normDigits(tgId))
                if (sent) toast("کد در تلگرام ارسال شد") else {
                    reloadMe()
                    toast("تلگرام قبلاً وصل شده است ✓")
                }
                onDone(sent)
            } catch (e: ApiException) {
                toast(e.message ?: "")
                onDone(false)
            }
        }
    }

    fun telegramVerify(code: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            try {
                Api.telegramVerify(normDigits(code))
                reloadMe()
                toast("تلگرام به حساب وصل شد ✓")
                onDone(true)
            } catch (e: ApiException) {
                toast(e.message ?: "")
                onDone(false)
            }
        }
    }

    fun openUrl(url: String) {
        _events.trySend(Event.OpenUrl(url))
    }

    private var updateAsked = false

    /** یک بار در هر اجرا: اگر نسخه‌ی جدیدتری منتشر شده، پیشنهاد به‌روزرسانی نشان بده. */
    fun maybeAskUpdate() {
        val c = _state.value.config ?: return
        if (!updateAsked && c.latestVersion > BuildConfig.VERSION_CODE) {
            updateAsked = true
            _state.update { it.copy(updateDialog = true) }
        }
    }

    fun dismissUpdate() {
        _state.update { it.copy(updateDialog = false) }
    }

    /** دکمه‌ی «بررسی به‌روزرسانی» در تب حساب: تنظیمات را تازه می‌گیرد و نتیجه را می‌گوید. */
    fun checkUpdate() {
        viewModelScope.launch {
            try {
                val c = Api.config()
                _state.update { it.copy(config = c) }
                if (c.latestVersion > BuildConfig.VERSION_CODE || c.minVersion > BuildConfig.VERSION_CODE) {
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

    /** خرید از طریق کافه‌بازار وقتی کلاینت بازار نصب/متصل است و سرور هم آن را فعال کرده؛ وگرنه درگاه وب. */
    private fun viaBazaar(): Boolean {
        val s = _state.value
        return s.bazaarReady && s.config?.bazaar == true
    }

    /** خرید را روی سرور تایید می‌کند؛ اگر موفق بود onDone(true) تا خرید «مصرف» شود. silent برای بازیابی خریدهای قبلی. */
    fun bazaarClaim(productId: String, token: String, silent: Boolean = false, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            if (!silent) toast("در حال تایید خرید…")
            try {
                Api.bazaarVerify(productId, token)
                reloadMe()
                toast(if (silent) "خرید قبلی شما تایید و اشتراک فعال شد ✓" else "اشتراک فعال شد ✓")
                onDone(true)
            } catch (e: ApiException) {
                if (!silent) toast(e.message ?: "")
                onDone(false)
            }
        }
    }

    fun buy(planId: String) {
        if (viaBazaar()) {
            _events.trySend(Event.BazaarBuy("plan_$planId"))
            return
        }
        viewModelScope.launch {
            try {
                _events.trySend(Event.OpenUrl(Api.startPayment(planId)))
            } catch (e: ApiException) {
                toast(e.message ?: "")
            }
        }
    }

    fun openSite() {
        _events.trySend(Event.OpenUrl(Api.BASE))
    }
}
