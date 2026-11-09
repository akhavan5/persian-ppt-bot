import SwiftUI
import UIKit

struct ToastItem: Identifiable, Equatable {
    let id = UUID()
    let text: String
}

enum PollResult {
    case done(J)
    case failed(String)
    case cancelled
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
    @Published var selectedTab = 0
    /// پیام «به پلن نیاز داری / اعتبار تمام شد» که به‌صورت هشدار با دکمه‌ی «مشاهده‌ی پلن‌ها» نشان داده می‌شود
    @Published var upsell: String?
    @Published var extraBusy: Set<String> = []
    @Published var extraMsg: [String: String] = [:]
    /// پرداخت: صفحه‌ی درگاه داخل Safari باز می‌شود
    @Published var payURL: IdentURL?
    @Published var needMobile = false

    /// فقط برای اسکرین‌شات‌های معرفی (آرگومان اجرای -demo YES)
    var isDemo = false

    private var jobTask: Task<Void, Never>?
    private var lastResume = Date.distantPast
    private let api = Api.shared

    // MARK: راه‌اندازی

    func bootstrap() async {
        if UserDefaults.standard.bool(forKey: "demo") { loadDemo(); return }
        phase = .loading
        do {
            cfg = try await api.config()
            me = try await api.me()
            if me == nil {
                phase = .loggedOut
            } else {
                api.persistCookies()
                phase = .ready
                afterLogin()
            }
        } catch {
            phase = .failed((error as? ApiError)?.message ?? error.localizedDescription)
        }
    }

    func loginSucceeded() async {
        do {
            if cfg.templates.isEmpty { cfg = try await api.config() }
            me = try await api.me()
            if me == nil { toast("ورود کامل نشد؛ دوباره تلاش کنید."); return }
            phase = .ready
            afterLogin()
        } catch {
            report(error)
        }
    }

    private func afterLogin() {
        Task { await loadFiles() }
        if let a = me?.activeJob, job == nil { watch(a) }
    }

    func onResume() async {
        guard !isDemo, phase == .ready, Date().timeIntervalSince(lastResume) > 5 else { return }
        lastResume = Date()
        await refreshMe()
        await loadFiles()
        if job == nil, let a = me?.activeJob { watch(a) }
    }

    func refreshMe() async {
        if isDemo { return }
        do {
            let m = try await api.me()
            if let m = m { me = m } else if phase == .ready { sessionExpired() }
        } catch {}
    }

    func logout() async {
        jobTask?.cancel()
        await api.logout()
        me = nil
        files = []
        filesLoaded = false
        job = nil
        selectedTab = 0
        phase = .loggedOut
    }

    private func sessionExpired() {
        jobTask?.cancel()
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

    // MARK: فایل‌ها

    func loadFiles() async {
        if isDemo { return }
        do {
            files = try await api.files()
            filesLoaded = true
        } catch {
            if let e = error as? ApiError, e.status == 401, phase == .ready { sessionExpired() }
        }
    }

    /// فایل را می‌گیرد و در پوشه‌ی موقت می‌گذارد تا QuickLook/اشتراک‌گذاری باز کند
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
            return url
        } catch {
            report(error)
            return nil
        }
    }

    func previewURL(_ id: String) -> URL? { api.previewURL(id) }

    // MARK: ساخت

    func generate(topic: String, slides: Int, handout: Bool, source: String, poster: String?, images: Bool, imagesMany: Bool, audio: Bool, podcast: Bool) async -> Bool {
        do {
            let id = try await api.generate(topic: topic, slides: slides, handout: handout, source: source, poster: poster, images: images, imagesMany: imagesMany, audio: audio, podcast: podcast)
            guard !id.isEmpty else {
                toast("شروع ساخت ممکن نشد؛ دوباره تلاش کنید.")
                return false
            }
            Haptic.light()
            job = JobState(id: id, message: "در صف ساخت…")
            watch(id)
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
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }
        return .cancelled
    }

    func watch(_ id: String) {
        if isDemo { return }
        jobTask?.cancel()
        if job?.id != id { job = JobState(id: id, message: "در حال ساخت…") }
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
                await self.loadFiles()
                await self.refreshMe()
                if !audioJob.isEmpty { self.watchCompanion(audioJob, kind: "audio") }
                if !podcastJob.isEmpty { self.watchCompanion(podcastJob, kind: "podcast") }
            case .failed(let msg):
                self.job = JobState(id: id, message: msg, failed: true)
                Haptic.error()
                await self.refreshMe()
            case .cancelled:
                break
            }
        }
    }

    /// اسلاید صوتی / پادکستِ همراه ارائه که در کار جدا ساخته می‌شود
    private func watchCompanion(_ jobId: String, kind: String) {
        Task { [weak self] in
            guard let self = self else { return }
            let r = await self.pollJob(jobId) { _, _ in }
            switch r {
            case .done(let j):
                let ok = !j["ids"].arr.filter { !$0.str.isEmpty }.isEmpty
                if kind == "audio" { self.job?.audioWaiting = false; self.job?.audioFailed = !ok }
                else { self.job?.podcastWaiting = false; self.job?.podcastFailed = !ok }
                if ok { self.toast("✅ \(extraName(kind)) آماده شد؛ در «فایل‌ها» هست.") }
                await self.loadFiles()
            case .failed:
                if kind == "audio" { self.job?.audioWaiting = false; self.job?.audioFailed = true }
                else { self.job?.podcastWaiting = false; self.job?.podcastFailed = true }
                self.toast("ساخت \(extraName(kind)) ناموفق بود؛ اعتبارش برگشت.")
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
            let r = await pollJob(jid) { msg, _ in
                if !msg.isEmpty { self.extraMsg[key] = msg }
            }
            switch r {
            case .done(let j):
                let ok = !j["ids"].arr.filter { !$0.str.isEmpty }.isEmpty
                if ok {
                    Haptic.success()
                    toast("✅ \(extraName(kind)) آماده شد؛ در فهرست فایل‌ها هست.")
                } else {
                    toast("ساخت \(extraName(kind)) ناموفق بود؛ اعتبارش برگشت.")
                }
            case .failed(let msg):
                toast(msg.isEmpty ? "ساخت \(extraName(kind)) ناموفق بود؛ اعتبارش برگشت." : msg)
            case .cancelled:
                break
            }
            await loadFiles()
            await refreshMe()
        } catch {
            report(error)
        }
    }

    // MARK: پرداخت

    func startPay(_ plan: PlanInfo) async {
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
