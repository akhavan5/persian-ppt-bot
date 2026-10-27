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
    val localFiles: List<LocalFile> = emptyList(), // نسخه‌های ذخیره‌شده روی گوشی (بعد از ۲۴ ساعت سرور هم می‌مانند)
    val autoSave: Boolean = true, // ذخیره‌ی خودکار روی گوشی بعد از ساخت
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
    val smsCode: String? = null, // کدی که از پیامک خوانده شد (SMS User Consent)؛ صفحه‌ی ورود آن را برمی‌دارد
    val otpTick: Int = 0, // با هر ارسال موفق کد یکی زیاد می‌شود (برای شروع دوباره‌ی تایمر و گوش‌دادن به پیامک)
)

sealed interface Event {
    data class Toast(val msg: String) : Event
    data class OpenUrl(val url: String) : Event
    /** فایل دانلود شد. share = true یعنی کاربر «اشتراک‌گذاری» را زده است. */
    data class FileReady(val saved: Saved, val share: Boolean) : Event
    /** اجازه‌ی اعلان داده نشده؛ راهنمایی برای فعال‌سازی نشان بده. */
    data object NotifHint : Event
    data class BazaarBuy(val sku: String) : Event
    data object AskNotify : Event
}

/** چیزی که برنامه‌ی دیگری از «اشتراک‌گذاری» به اپ فرستاده */
sealed interface Share {
    data class FileShare(val uris: List<Uri>) : Share
    data class TextShare(val text: String) : Share
}

private const val MAX_SOURCE_CHARS = 120_000

/** حداکثر مدتی که اپ در حالت باز، وضعیت ساخت را (حتی با قطعی اینترنت) پیگیری می‌کند؛ هم‌اندازه‌ی JobWatcher پس‌زمینه (≈ ۲۰ دقیقه). */
private const val MAX_WATCH_MS = 20L * 60 * 1000

/** حداقل فاصله‌ی دو بار «تازه‌کردن حساب» هنگام برگشت به اپ (ثانیه‌های کم بین باز و بسته‌شدن‌های پشت‌سرهم درخواست اضافه نمی‌سازد). */
private const val RESUME_REFRESH_MS = 15_000L

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
        _state.update { it.copy(files = FileCache.load(app), localFiles = LocalFiles.list(app), autoSave = LocalFiles.autoEnabled(app)) }
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
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
            try {
                val cfg = _state.value.config ?: Api.config()
                val me = Api.me()
                if (me == null) {
                    _state.update { it.copy(config = cfg, me = null, screen = Screen.Login, error = null) }
                } else {
                    _state.update { it.copy(config = cfg, me = me, screen = Screen.Main, error = null) }
                    lastMeRefresh = SystemClock.elapsedRealtime() // اولین onResume بعد از شروع، درخواست تکراری نمی‌فرستد
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

    /** وقتی کاربر از مرورگر (بعد از پرداخت) برمی‌گردد اعتبار را به‌روز می‌کند. */
    fun onResume(force: Boolean = false) {
        if (_state.value.screen != Screen.Main) return
        refreshLocal() // کار پس‌زمینه ممکن است وقتی اپ بسته بود فایلی ذخیره کرده باشد
        val now = SystemClock.elapsedRealtime()
        val must = force || refreshOnNextResume
        refreshOnNextResume = false
        if (!must && now - lastMeRefresh < RESUME_REFRESH_MS) return
        lastMeRefresh = now
        viewModelScope.launch {
            try {
                Api.me()?.let { me -> _state.update { it.copy(me = me) } }
            } catch (e: ApiException) { /* بی‌صدا */ }
        }
    }

    fun sendOtp(mobile: String) {
        val m = normalizeIranMobile(mobile)
        if (m == null) {
            toast("شماره‌ی موبایل معتبر نیست؛ مثل 09123456789 بنویسید")
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                Api.otpSend(m)
                _state.update { it.copy(busy = false, otpSent = true, otpTick = it.otpTick + 1) }
                toast("کد تأیید ارسال شد")
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

    fun editMobile() {
        _state.update { it.copy(otpSent = false) }
    }

    fun verifyOtp(mobile: String, code: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                Api.otpVerify(normalizeIranMobile(mobile) ?: normDigits(mobile), normDigits(code))
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
            Api.logout()
            Draft.clear(getApplication())
            FileCache.clear(getApplication())
            LocalFiles.clear(getApplication())
            form.reset()
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
            val startedAt = SystemClock.elapsedRealtime()
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
                            onResume(force = true) // اعتبار مصرف‌شده یا برگشت‌خورده فوراً به‌روز شود
                            val app = getApplication<Application>()
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
                            _state.update { it.copy(job = JobState(id, msg)) }
                            // اعلان «در حال ساخت» فقط وقتی اپ جلوی چشم نیست
                            val app = getApplication<Application>()
                            if (AppForeground.on) Notifier.cancelProgress(app, id) else Notifier.progress(app, id, msg)
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
                    if (fails >= 3) _state.update { it.copy(job = JobState(id, "اتصال قطع شد؛ ساخت ادامه دارد و دوباره تلاش می‌کنیم…")) }
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

    fun dismissJob() {
        pollJob?.cancel()
        _state.value.job?.let { Notifier.cancelProgress(getApplication(), it.id) }
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

    fun download(fileId: String, share: Boolean = false) {
        viewModelScope.launch {
            // اگر نسخه‌ی محلی داریم، بدون اینترنت (و حتی بعد از ۲۴ ساعت) همان را در Downloads می‌گذاریم
            val app = getApplication<Application>()
            try {
                val saved = withContext(Dispatchers.IO) {
                    LocalFiles.read(app, fileId)?.let { Storage.save(app, it.name, it.mime, it.bytes) }
                }
                if (saved != null) {
                    _events.trySend(Event.FileReady(saved, share))
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
                _events.trySend(Event.FileReady(r, share))
            } catch (e: ApiException) {
                toast(e.message ?: "دانلود انجام نشد")
            } catch (e: Exception) {
                toast("ذخیره‌ی فایل انجام نشد")
            }
        }
    }

    /** دانلود نسخه‌ی PDF ارائه (ساخت روی سرور ممکن است تا یک دقیقه طول بکشد). */
    fun downloadPdf(fileId: String, share: Boolean = false) {
        viewModelScope.launch {
            toast("در حال ساخت PDF؛ ممکن است تا یک دقیقه طول بکشد…")
            try {
                _events.trySend(Event.FileReady(Api.downloadPdf(getApplication(), fileId), share))
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

    fun consumeExtracted() {
        _state.update { it.copy(extractedText = null) }
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
            else -> t
        }
    }

    /** متن یک فایل (PDF/عکس با سرور؛ Word و txt روی خود گوشی) را برمی‌گرداند. */
    private suspend fun readSource(ctx: Context, uri: Uri, status: (String) -> Unit): String {
        val mime = detectMime(ctx, uri)
        val supported = mime == "application/pdf" || mime.startsWith("image/") || mime == DocReader.DOCX_MIME ||
            mime == DocReader.PPTX_MIME || mime == DocReader.XLSX_MIME ||
            mime.startsWith("text/") || mime == "application/json"
        if (!supported) throw ApiException("فقط PDF، عکس، Word، PowerPoint، Excel، HTML یا فایل متنی (txt, csv, json, md) پشتیبانی می‌شود.")
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
            _state.update { it.copy(extractBusy = null, extractedText = text.ifEmpty { null }) }
            when {
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

    fun openUrl(url: String) {
        refreshOnNextResume = true
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
                val url = Api.startPayment(planId)
                refreshOnNextResume = true
                _events.trySend(Event.OpenUrl(url))
            } catch (e: ApiException) {
                toast(e.message ?: "")
            }
        }
    }

    fun openSite() {
        refreshOnNextResume = true
        _events.trySend(Event.OpenUrl(Api.BASE))
    }
}
