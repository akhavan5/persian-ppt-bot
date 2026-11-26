import SwiftUI
import UIKit
import UserNotifications

struct ToastItem: Identifiable, Equatable {
    let id = UUID()
    let text: String
}

enum PollResult {
    case done(J)
    case failed(String)
    case cancelled
}

/// درخواست باز کردن جزئیات یک فایل (از اعلان یا Spotlight)؛ action: open | download | preview
struct FocusRequest: Identifiable, Equatable {
    let id: String
    let action: String
    let token = UUID()
}

@MainActor
final class AppModel: ObservableObject {
    enum Phase: Equatable {
        case loading, loggedOut, ready
        case failed(String)
    }

    @Published var phase: Phase = .loading
    @Published var cfg = Config.empty
    @Published var me: Me?
    @Published var files: [FileItem] = []
    @Published var filesLoaded = false
    @Published var job: JobState?
    @Published var toastItem: ToastItem?
    @Published var selectedTab = 0 {
        didSet { if selectedTab != oldValue { Stats.screen("tab_\(selectedTab)") } }
    }
    /// پیام «به پلن نیاز داری / اعتبار تمام شد» که به‌صورت هشدار با دکمه‌ی «مشاهده‌ی پلن‌ها» نشان داده می‌شود
    @Published var upsell: String?
    @Published var extraBusy: Set<String> = []
    @Published var extraMsg: [String: String] = [:]
    /// پرداخت: صفحه‌ی درگاه داخل Safari باز می‌شود
    @Published var payURL: IdentURL?
    @Published var needMobile = false

    /// فایل‌های ذخیره‌شده روی گوشی
    @Published var library: [LocalFile] = []
    /// موضوعی که از اعلان / میان‌بر / Shortcuts آمده و باید در فرم ساخت گذاشته شود (رشته‌ی خالی = فقط فرم را باز کن)
    @Published var pendingTopic: String?
    /// فایل‌هایی که از «Open in…» آمده‌اند و باید به منبع ارائه اضافه شوند
    @Published var pendingImports: [URL] = []
    @Published var focusFile: FocusRequest?
    @Published var focusLocal: String?
    @Published var notifyStatus: UNAuthorizationStatus = .notDetermined

    /// فقط برای اسکرین‌شات‌های معرفی (آرگومان اجرای -demo YES)
    var isDemo = false

    private var jobTask: Task<Void, Never>?
    private var lastResume = Date.distantPast
    private var pendingRoute: NotifyRoute?
    private var lastURL: (String, Date)?
    private var lastIndexed: [String] = []
    private let api = Api.shared

    // MARK: راه‌اندازی

    func bootstrap() async {
        if UserDefaults.standard.bool(forKey: "demo") { loadDemo(); return }
        phase = .loading
        refreshLibrary()
        if files.isEmpty {
            let cached = FileCache.load()
            if !cached.isEmpty { files = cached; filesLoaded = true }
        }
        do {
            cfg = try await api.config()
            UserDefaults.standard.set(cfg.dailyFree > 0, forKey: Pref.dailyFree)
            let m = try await api.me()
            if let m = m {
                applyMe(m)
                api.persistCookies()
                phase = .ready
                afterLogin()
            } else {
                me = nil
                phase = .loggedOut
            }
        } catch {
            phase = .failed((error as? ApiError)?.message ?? error.localizedDescription)
        }
    }

    func loginSucceeded() async {
        do {
            if cfg.templates.isEmpty { cfg = try await api.config() }
            UserDefaults.standard.set(cfg.dailyFree > 0, forKey: Pref.dailyFree)
            guard let m = try await api.me() else { toast("ورود کامل نشد؛ دوباره تلاش کنید."); return }
            applyMe(m)
            Stats.log("login")
            phase = .ready
            afterLogin()
        } catch {
            report(error)
        }
    }

    private func applyMe(_ m: Me) {
        me = m
        ReminderCenter.shared.onMe(m, dailyFreeOn: cfg.dailyFree > 0)
    }

    private func afterLogin() {
        Task { await loadFiles() }
        if let a = me?.activeJob, job == nil { watch(a) }
        Notify.shared.clearDelivered()
        refreshLibrary()
        consumeExternalRequests()
        if let r = pendingRoute { pendingRoute = nil; apply(r) }
        Task {
            await refreshNotifyStatus()
            await flushPendingSaves()
        }
    }

    func onResume(force: Bool = false) async {
        guard !isDemo, phase == .ready, force || Date().timeIntervalSince(lastResume) > 5 else { return }
        lastResume = Date()
        Notify.shared.clearDelivered()
        await refreshMe()
        await loadFiles()
        if job == nil, let a = me?.activeJob { watch(a) }
        refreshLibrary()
        consumeExternalRequests()
        await refreshNotifyStatus()
        await flushPendingSaves()
    }

    func refreshMe() async {
        if isDemo { return }
        do {
            let m = try await api.me()
            if let m = m { applyMe(m) } else if phase == .ready { sessionExpired() }
        } catch {}
    }

    func logout() async {
        Stats.log("logout")
        jobTask?.cancel()
        await api.logout()
        me = nil
        files = []
        filesLoaded = false
        job = nil
        selectedTab = 0
        pendingTopic = nil
        pendingImports = []
        BackgroundJobs.shared.clear()
        PendingSaves.clear()
        Draft.clear()
        FileCache.clear()
        LocalLibrary.shared.removeAll()
        SpotlightIndex.clear()
        library = []
        lastIndexed = []
        ReminderCenter.shared.onLogout()
        await Notify.shared.cancelAll()
        phase = .loggedOut
    }

    private func sessionExpired() {
        jobTask?.cancel()
        BackgroundJobs.shared.clear()
        api.clearSession()
        me = nil
        job = nil
        phase = .loggedOut
        toast("نشست شما تمام شده؛ دوباره وارد شوید.")
    }

    // MARK: پیام‌ها

    func toast(_ text: String) {
        let t = ToastItem(text: text)
        toastItem = t
        Task {
            try? await Task.sleep(nanoseconds: 3_200_000_000)
            if self.toastItem?.id == t.id { self.toastItem = nil }
        }
    }

    func report(_ error: Error) {
        if error is CancellationError { return }
        if let e = error as? ApiError {
            if e.status == 401 && phase == .ready { sessionExpired(); return }
            if e.needPlan || e.noCredit { Haptic.error(); upsell = e.message; return }
            Haptic.error()
            toast(e.message)
        } else {
            toast(error.localizedDescription)
        }
    }

    // MARK: اعلان‌ها

    func refreshNotifyStatus() async {
        notifyStatus = await Notify.shared.status()
    }

    func enableNotifications() async {
        if notifyStatus == .notDetermined {
            await Notify.shared.askIfNeeded()
        } else {
            Notify.shared.openSystemSettings()
        }
        await refreshNotifyStatus()
        ReminderCenter.shared.refresh()
    }

    // MARK: مسیر‌یابی (اعلان، میان‌بر، Shortcuts، Spotlight، لینک)

    func handleRoute(_ r: NotifyRoute) {
        guard phase == .ready else { pendingRoute = r; return }
        apply(r)
    }

    private func apply(_ r: NotifyRoute) {
        if let u = r.url { UIApplication.shared.open(u) }
        if let t = r.topic, !t.isEmpty {
            selectedTab = 0
            pendingTopic = t
        } else if let tab = r.tab {
            selectedTab = tab
        }
        if let id = r.jobId, !id.isEmpty {
            selectedTab = 1
            Task {
                await loadFiles()
                focusFile = FocusRequest(id: id, action: r.action ?? "open")
            }
        }
    }

    func applyQuickAction(_ type: String?) {
        guard phase == .ready, let t = type else { return }
        QuickAction.pending = nil
        switch t {
        case QuickAction.new:
            selectedTab = 0
            pendingTopic = ""
        case QuickAction.files, QuickAction.library:
            selectedTab = 1
        default:
            break
        }
    }

    func openSpotlight(_ identifier: String) {
        guard identifier.hasPrefix(SpotlightIndex.prefix) else { return }
        focusLocal = String(identifier.dropFirst(SpotlightIndex.prefix.count))
        selectedTab = 1
    }

    /// میان‌بر باز شده از روی آیکن یا برنامه‌ی Shortcuts
    private func consumeExternalRequests() {
        if let a = QuickAction.pending { applyQuickAction(a) }
        let i = IntentBridge.consume()
        if i.openFiles { selectedTab = 1 }
        if let t = i.topic {
            selectedTab = 0
            pendingTopic = t
        }
    }

    // MARK: تنظیمات

    func setSettings(_ pairs: [String: Any]) {
        guard var s = me?.settings else { return }
        for (k, v) in pairs { s.apply(k, v) }
        me?.settings = s
        if isDemo { return }
        Task {
            do { try await api.putSettings(pairs) }
            catch {
                report(error)
                await refreshMe()
            }
        }
    }

    func setSetting(_ key: String, _ value: Any) { setSettings([key: value]) }

    func updateName(_ name: String) async -> Bool {
        do {
            try await api.updateName(name)
            await refreshMe()
            return true
        } catch {
            report(error)
            return false
        }
    }

    // MARK: اتصال پلتفرم‌ها

    func setChannelNotify(_ plat: String, _ on: Bool) async {
        do { try await api.channelNotify(plat: plat, on: on); await refreshMe() } catch { report(error) }
    }

    func unlinkChannel(_ plat: String) async {
        do { try await api.channelUnlink(plat: plat); await refreshMe(); toast("پیام‌رسان جدا شد") } catch { report(error) }
    }

    // MARK: فایل‌ها

    func loadFiles() async {
        if isDemo { return }
        do {
            files = try await api.files()
            filesLoaded = true
            FileCache.save(files)
        } catch {
            if let e = error as? ApiError, e.status == 401, phase == .ready { sessionExpired() }
            else if files.isEmpty {
                let cached = FileCache.load()
                if !cached.isEmpty { files = cached; filesLoaded = true }
            }
        }
    }

    private func libKind(_ item: FileItem, pdf: Bool) -> String {
        if pdf { return "pdf" }
        switch FileKind(item) {
        case .deck: return "deck"
        case .poster: return "poster"
        case .handout: return "handout"
        case .audio: return "audio"
        case .podcast: return "podcast"
        case .pdf: return "pdf"
        }
    }

    /// فایل را می‌گیرد و در پوشه‌ی موقت می‌گذارد تا QuickLook/اشتراک‌گذاری/پخش باز کند؛ اگر «ذخیره‌ی خودکار» روشن باشد یک نسخه هم روی گوشی می‌ماند
    func download(_ item: FileItem, pdf: Bool = false) async -> URL? {
        do {
            let f: Fetched
            if pdf {
                f = try await api.fetchFile(item.id, suffix: "/pdf", fallbackName: "presentation.pdf", maxRetries: 0)
            } else {
                f = try await api.fetchFile(item.id, maxRetries: item.sample ? 2 : 6)
            }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dl-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var name = f.name.replacingOccurrences(of: "/", with: "-")
            if name.isEmpty { name = pdf ? "presentation.pdf" : "presentation.pptx" }
            let url = dir.appendingPathComponent(name)
            try f.data.write(to: url, options: .atomic)
            if LocalLibrary.shared.autoSave && !item.sample {
                keep(item, data: f.data, name: name, pdf: pdf)
            }
            return url
        } catch {
            report(error)
            return nil
        }
    }

    /// نسخه‌ی محلی (دستی یا خودکار)
    func keep(_ item: FileItem, data: Data, name: String, pdf: Bool) {
        let kind = libKind(item, pdf: pdf)
        LocalLibrary.shared.save(id: "\(item.id)|\(kind)", title: item.title, kind: kind, slides: item.slides, data: data, fileName: name)
        refreshLibrary()
    }

    func previewURL(_ id: String) -> URL? { api.previewURL(id) }

    func refreshLibrary() {
        library = LocalLibrary.shared.all()
        let ids = library.map { $0.id }
        if ids != lastIndexed {
            lastIndexed = ids
            SpotlightIndex.update(library)
        }
    }

    private func libName(_ title: String, _ suffix: String, _ f: Fetched) -> String {
        let ext = (f.name as NSString).pathExtension
        let base = title.isEmpty ? (f.name as NSString).deletingPathExtension : title
        return ext.isEmpty ? base + suffix : base + suffix + "." + ext
    }

    /// بعد از ساخت: ارائه، جزوه و پوستر را بی‌صدا روی گوشی ذخیره می‌کند (فایل‌های سرور بعد از ۲۴ ساعت پاک می‌شوند)
    func autoSave(_ p: PendingSave) async {
        guard LocalLibrary.shared.autoSave, !isDemo else { return }
        if let f = try? await api.fetchFile(p.id, maxRetries: 6) {
            LocalLibrary.shared.save(id: "\(p.id)|deck", title: p.title, kind: "deck", slides: p.slides, data: f.data, fileName: libName(p.title, "", f))
        }
        if !p.handoutId.isEmpty, let f = try? await api.fetchFile(p.handoutId, fallbackName: "handout.docx", maxRetries: 6) {
            LocalLibrary.shared.save(id: "\(p.handoutId)|handout", title: p.title, kind: "handout", slides: 0, data: f.data, fileName: libName(p.title, " - جزوه", f))
        }
        if !p.posterId.isEmpty, let f = try? await api.fetchFile(p.posterId, fallbackName: "poster.png", maxRetries: 6) {
            LocalLibrary.shared.save(id: "\(p.posterId)|poster", title: p.title, kind: "poster", slides: 0, data: f.data, fileName: libName(p.title, " - پوستر", f))
        }
        refreshLibrary()
    }

    private func flushPendingSaves() async {
        for p in PendingSaves.all() {
            PendingSaves.remove(id: p.id)
            await autoSave(p)
        }
    }

    // MARK: ساخت

    func generate(topic: String, slides: Int, handout: Bool, source: String, poster: String?, images: Bool, imagesMany: Bool, audio: Bool, podcast: Bool) async -> Bool {
        do {
            let id = try await api.generate(topic: topic, slides: slides, handout: handout, source: source, poster: poster, images: images, imagesMany: imagesMany, audio: audio, podcast: podcast)
            guard !id.isEmpty else {
                toast("شروع ساخت ممکن نشد؛ دوباره تلاش کنید.")
                return false
            }
            Haptic.light()
            Stats.log("generate_deck", ["slides": String(slides), "handout": String(handout), "images": String(images), "audio": String(audio), "podcast": String(podcast)])
            job = JobState(id: id, message: "در صف ساخت…")
            watch(id, topic: topic)
            // مجوز اعلان در همین لحظه‌ی طبیعی («خبرت می‌کنیم») پرسیده می‌شود؛ بعدش اعلان پشتیبان زمان‌بندی می‌شود
            Task {
                await Notify.shared.askIfNeeded()
                await Notify.shared.scheduleWait(id: id, kind: "deck", afterSeconds: 240)
                await refreshNotifyStatus()
            }
            await refreshMe()
            return true
        } catch {
            report(error)
            return false
        }
    }

    func dismissJob() {
        if let j = job, j.running { return }
        job = nil
    }

    private func pollJob(_ id: String, onRunning: (String, Int) -> Void) async -> PollResult {
        var fails = 0
        let start = Date()
        while !Task.isCancelled {
            do {
                let j = try await api.job(id)
                fails = 0
                switch j["state"].str {
                case "done": return .done(j)
                case "error": return .failed(j["message"].str.isEmpty ? "ساخت ناموفق بود؛ اعتبارت برگردانده شد." : j["message"].str)
                default:
                    onRunning(j["message"].str, j["progress"].exists ? min(max(j["progress"].int, -1), 100) : -1)
                }
            } catch is CancellationError {
                return .cancelled
            } catch {
                if let e = error as? ApiError, e.status == 401 || e.status == 403 || e.status == 404 { return .failed(e.message) }
                fails += 1
                if fails > 30 { return .failed((error as? ApiError)?.message ?? "ارتباط با سرور قطع شد.") }
            }
            if Date().timeIntervalSince(start) > 1800 { return .failed("زمان انتظار برای ساخت تمام شد.") }
            try? await Task.sleep(nanoseconds: Poll.delayNs(elapsed: Date().timeIntervalSince(start), fails: fails))
        }
        return .cancelled
    }

    private var nowMs: Double { Date().timeIntervalSince1970 * 1000 }

    func watch(_ id: String, topic: String = "") {
        if isDemo { return }
        jobTask?.cancel()
        if job?.id != id { job = JobState(id: id, message: "در حال ساخت…") }
        if !BackgroundJobs.shared.list().contains(where: { $0.id == id }) {
            BackgroundJobs.shared.track(TrackedJob(id: id, kind: "deck", deckId: id, title: topic, t: nowMs))
        }
        jobTask = Task { [weak self] in
            guard let self = self else { return }
            let r = await self.pollJob(id) { msg, pct in
                if !msg.isEmpty { self.job?.message = msg }
                self.job?.pct = pct
            }
            switch r {
            case .done(let j):
                var s = self.job ?? JobState(id: id, message: "")
                s.done = true
                s.message = "آماده شد"
                s.title = j["title"].str
                if j["handout"].str == "ok" { s.handoutId = j["handoutId"].str }
                s.posterId = j["poster"].str == "ok" ? j["posterId"].str : nil
                s.posterFailed = j["poster"].str == "failed"
                s.audioFailed = j["audio"].str == "failed"
                s.podcastFailed = j["podcast"].str == "failed"
                let audioJob = j["audio"].str == "pending" ? j["audioId"].str : ""
                let podcastJob = j["podcast"].str == "pending" ? j["podcastId"].str : ""
                s.audioWaiting = !audioJob.isEmpty
                s.podcastWaiting = !podcastJob.isEmpty
                self.job = s
                Haptic.success()
                BackgroundJobs.shared.untrack(id: id)
                Notify.shared.cancelWait(id)
                PendingSaves.remove(id: id)
                if Handled.first("done.\(id)") { ReminderCenter.shared.onDeckDone() }
                await Notify.shared.jobDone(id: id, title: s.title)
                await self.loadFiles()
                await self.refreshMe()
                if !audioJob.isEmpty { self.watchCompanion(audioJob, kind: "audio", deckId: id, title: s.title) }
                if !podcastJob.isEmpty { self.watchCompanion(podcastJob, kind: "podcast", deckId: id, title: s.title) }
                await self.autoSave(PendingSave(
                    id: id, title: s.title, slides: j["slides"].int,
                    handoutId: j["handout"].str == "ok" ? j["handoutId"].str : "",
                    posterId: j["poster"].str == "ok" ? j["posterId"].str : ""))
            case .failed(let msg):
                self.job = JobState(id: id, message: msg, failed: true)
                Haptic.error()
                BackgroundJobs.shared.untrack(id: id)
                await Notify.shared.jobFailed(id: id, message: msg)
                await self.refreshMe()
            case .cancelled:
                break
            }
        }
    }

    /// اسلاید صوتی / پادکستِ همراه ارائه که در کار جدا ساخته می‌شود
    private func watchCompanion(_ jobId: String, kind: String, deckId: String, title: String) {
        if !BackgroundJobs.shared.list().contains(where: { $0.id == jobId }) {
            BackgroundJobs.shared.track(TrackedJob(id: jobId, kind: kind, deckId: deckId, title: title, t: nowMs))
        }
        Task { [weak self] in
            guard let self = self else { return }
            await Notify.shared.scheduleWait(id: "\(deckId)|\(kind)", kind: kind, afterSeconds: 420)
            let r = await self.pollJob(jobId) { _, _ in }
            BackgroundJobs.shared.untrack(id: jobId)
            switch r {
            case .done(let j):
                let ok = !j["ids"].arr.filter { !$0.str.isEmpty }.isEmpty
                if kind == "audio" { self.job?.audioWaiting = false; self.job?.audioFailed = !ok }
                else { self.job?.podcastWaiting = false; self.job?.podcastFailed = !ok }
                if ok {
                    self.toast("✅ \(extraName(kind)) آماده شد؛ در «فایل‌ها» هست.")
                    if Handled.first("extra.\(jobId)") { ReminderCenter.shared.onExtraMade() }
                    await Notify.shared.extraDone(deckId: deckId, kind: kind, title: title)
                } else {
                    await Notify.shared.extraFailed(deckId: deckId, kind: kind, message: "")
                }
                await self.loadFiles()
            case .failed(let msg):
                if kind == "audio" { self.job?.audioWaiting = false; self.job?.audioFailed = true }
                else { self.job?.podcastWaiting = false; self.job?.podcastFailed = true }
                self.toast("ساخت \(extraName(kind)) ناموفق بود؛ اعتبارش برگشت.")
                await Notify.shared.extraFailed(deckId: deckId, kind: kind, message: msg)
                await self.refreshMe()
            case .cancelled:
                break
            }
        }
    }

    /// ساخت جداگانه‌ی پوستر/جزوه/صدا برای ارائه‌ی موجود
    func makeExtra(deckId: String, kind: String, layout: String? = nil) async {
        let key = "\(deckId)|\(kind)"
        if extraBusy.contains(key) { return }
        extraBusy.insert(key)
        extraMsg[key] = "در صف ساخت…"
        defer {
            extraBusy.remove(key)
            extraMsg[key] = nil
        }
        do {
            let jid = try await api.startExtra(deckId: deckId, kind: kind, layout: layout)
            guard !jid.isEmpty else { toast("شروع ساخت ممکن نشد."); return }
            Haptic.light()
            let title = files.first { $0.id == deckId }?.title ?? ""
            BackgroundJobs.shared.track(TrackedJob(id: jid, kind: kind, deckId: deckId, title: title, t: nowMs))
            await Notify.shared.askIfNeeded()
            await Notify.shared.scheduleWait(id: key, kind: kind, afterSeconds: 300)
            let r = await pollJob(jid) { msg, _ in
                if !msg.isEmpty { self.extraMsg[key] = msg }
            }
            BackgroundJobs.shared.untrack(id: jid)
            switch r {
            case .done(let j):
                let ok = !j["ids"].arr.filter { !$0.str.isEmpty }.isEmpty
                if ok {
                    Haptic.success()
                    toast("✅ \(extraName(kind)) آماده شد؛ در فهرست فایل‌ها هست.")
                    if Handled.first("extra.\(jid)") { ReminderCenter.shared.onExtraMade() }
                    await Notify.shared.extraDone(deckId: deckId, kind: kind, title: title)
                } else {
                    toast("ساخت \(extraName(kind)) ناموفق بود؛ اعتبارش برگشت.")
                    await Notify.shared.extraFailed(deckId: deckId, kind: kind, message: "")
                }
            case .failed(let msg):
                toast(msg.isEmpty ? "ساخت \(extraName(kind)) ناموفق بود؛ اعتبارش برگشت." : msg)
                await Notify.shared.extraFailed(deckId: deckId, kind: kind, message: msg)
            case .cancelled:
                break
            }
            await loadFiles()
            await refreshMe()
        } catch {
            report(error)
        }
    }

    // MARK: لینک‌ها، «Open in…» و پرداخت

    /// نسخه‌ی سیب‌اپ اپ؟ (کلید PptSazStore در Info.plist؛ در ساخت با PPTSAZ_STORE=sibapp)
    static let isSibappBuild = (Bundle.main.object(forInfoDictionaryKey: "PptSazStore") as? String) == "sibapp"
    private static let pendingKey = "sibappPending"

    /// pptsaz://?purchase_id=… (برگشت از سیب‌اپ)، pptsaz://new?topic=…، pptsaz://files و فایل‌های بازشده با «Open in…»
    func handleURL(_ url: URL) {
        let key = url.absoluteString
        if let l = lastURL, l.0 == key, Date().timeIntervalSince(l.1) < 3 { return } // هم SwiftUI و هم SceneDelegate خبر می‌دهند
        lastURL = (key, Date())

        if url.isFileURL { importFile(url); return }
        guard url.scheme == "pptsaz" else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query: (String) -> String? = { name in comps?.queryItems?.first(where: { $0.name == name })?.value }

        if let id = query("purchase_id") {
            guard id.range(of: "^[A-Za-z0-9_-]{4,100}$", options: .regularExpression) != nil else { return }
            UserDefaults.standard.set(id, forKey: Self.pendingKey)
            Task { await claimSibappPending() }
            return
        }
        switch url.host ?? "" {
        case "new":
            handleRoute(NotifyRoute(tab: 0, topic: query("topic") ?? ""))
            if phase == .ready, (query("topic") ?? "").isEmpty { selectedTab = 0; pendingTopic = "" }
        case "files", "library":
            handleRoute(NotifyRoute(tab: 1))
        default:
            break
        }
    }

    private func importFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("in-\(UUID().uuidString)", isDirectory: true)
        let dst = dir.appendingPathComponent(url.lastPathComponent)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: url, to: dst)
            pendingImports.append(dst)
            selectedTab = 0
        } catch {
            toast("باز کردن فایل ممکن نشد.")
        }
    }

    func takeImports() -> [URL] {
        let l = pendingImports
        pendingImports = []
        return l
    }

    func claimSibappPending() async {
        guard me != nil, let id = UserDefaults.standard.string(forKey: Self.pendingKey) else { return }
        do {
            try await api.sibappVerify(purchaseId: id)
            UserDefaults.standard.removeObject(forKey: Self.pendingKey)
            Haptic.success()
            toast("پرداخت انجام شد و پلن فعال شد.")
            await refreshMe()
        } catch {
            if let e = error as? ApiError, e.status >= 400 && e.status < 500 && e.status != 429 {
                UserDefaults.standard.removeObject(forKey: Self.pendingKey) // رد قطعی؛ دیگر تلاش نمی‌کنیم
            }
            report(error)
        }
    }

    func startPay(_ plan: PlanInfo) async {
        if Self.isSibappBuild && cfg.sibapp {
            do {
                let u = try await api.sibappStart(plan: plan.id)
                _ = await UIApplication.shared.open(u)
            } catch {
                if let e = error as? ApiError, e.needMobile { needMobile = true; toast(e.message) } else { report(error) }
            }
            return
        }
        if !cfg.payEnabled {
            if let u = URL(string: plan.url), !plan.url.isEmpty { payURL = IdentURL(url: u) }
            else { toast("پرداخت آنلاین هنوز فعال نشده است.") }
            return
        }
        do {
            let u = try await api.payStart(plan: plan.id)
            payURL = IdentURL(url: u)
        } catch {
            if let e = error as? ApiError, e.needMobile {
                needMobile = true
                toast(e.message)
            } else {
                report(error)
            }
        }
    }
}

struct IdentURL: Identifiable {
    let id = UUID()
    let url: URL
}
