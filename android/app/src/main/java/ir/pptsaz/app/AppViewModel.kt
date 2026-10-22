package ir.pptsaz.app

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
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
)

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
)

sealed interface Event {
    data class Toast(val msg: String) : Event
    data class OpenUrl(val url: String) : Event
    data class OpenFile(val uri: Uri, val mime: String, val name: String) : Event
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    private val _events = Channel<Event>(Channel.BUFFERED)
    val events = _events.receiveAsFlow()

    private var pollJob: Job? = null

    init {
        Api.init(app)
        refresh()
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
                    loadFiles()
                    if (me.activeJob != null && _state.value.job == null) watch(me.activeJob)
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
            _state.update { UiState(screen = Screen.Login, config = it.config) }
        }
    }

    // ------------------------------------------------------------ ساخت ارائه

    fun generate(topic: String, slides: Int, handout: Boolean, source: String) {
        if (topic.trim().length < 3) {
            toast("موضوع ارائه را بنویسید")
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            try {
                val id = Api.generate(topic.trim(), slides, handout, source.trim())
                _state.update { it.copy(busy = false) }
                if (id.isEmpty()) toast("شروع ساخت انجام نشد") else watch(id)
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false) }
                toast(e.message ?: "")
                if (e.needPlan || e.noCredit) _state.update { it.copy(tab = 2) }
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
                            _state.update {
                                it.copy(job = JobState(id, "آماده شد", done = true, title = j.optString("title"), handoutId = h))
                            }
                            loadFiles()
                            onResume()
                            return@launch
                        }
                        "error" -> {
                            _state.update { it.copy(job = JobState(id, j.optString("message", "ساخت ناموفق بود"), failed = true)) }
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
                _state.update { it.copy(files = list, filesLoading = false) }
            } catch (e: ApiException) {
                _state.update { it.copy(filesLoading = false) }
                if (e.status == 401) refresh()
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

    // ------------------------------------------------------------ تنظیمات و خرید

    fun setSetting(key: String, value: String) {
        val me = _state.value.me ?: return
        viewModelScope.launch {
            try {
                Api.putSettings(key, value)
                val s = me.settings
                val ns = when (key) {
                    "theme" -> s.copy(theme = value)
                    "template" -> s.copy(template = value)
                    "tone" -> s.copy(tone = value)
                    "font" -> s.copy(font = value)
                    else -> s
                }
                _state.update { st -> st.copy(me = st.me?.copy(settings = ns)) }
            } catch (e: ApiException) {
                toast(e.message ?: "")
            }
        }
    }

    fun buy(planId: String) {
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
