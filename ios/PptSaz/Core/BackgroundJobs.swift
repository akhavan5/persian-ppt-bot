import UIKit
import BackgroundTasks

/// کاری که سمت سرور در حال ساخت است و باید حتی بعد از رفتن اپ به پس‌زمینه پیگیری شود
struct TrackedJob: Codable, Equatable {
    var id: String       // شناسه‌ی کار در سرور
    var kind: String     // deck | audio | podcast | extra
    var deckId: String   // ارائه‌ای که این کار به آن تعلق دارد
    var title: String
    var t: Double
}

/// پیگیری ساخت در پس‌زمینه بدون Push:
/// - تا ~۳۰ ثانیه بعد از رفتن به پس‌زمینه (beginBackgroundTask) هر ۴ ثانیه از سرور می‌پرسد؛
/// - بعدش BGAppRefreshTask / BGProcessingTask که iOS هر وقت صلاح بداند اجرا می‌کند (زمانش در اختیار سیستم است)؛
/// - اعلان «احتمالاً آماده است» (Notify.scheduleWait) پشتیبان هر دو است.
@MainActor
final class BackgroundJobs {
    static let shared = BackgroundJobs()
    nonisolated static let refreshId = "ir.pptsaz.app.refresh"
    nonisolated static let pollId = "ir.pptsaz.app.poll"

    private let key = "pptsaz.trackedjobs.v1"
    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    // MARK: فهرست کارها

    func list() -> [TrackedJob] {
        guard let d = UserDefaults.standard.data(forKey: key),
              let l = try? JSONDecoder().decode([TrackedJob].self, from: d) else { return [] }
        return l
    }

    private func write(_ l: [TrackedJob]) {
        if let d = try? JSONEncoder().encode(l) { UserDefaults.standard.set(d, forKey: key) }
    }

    func track(_ j: TrackedJob) {
        var l = list().filter { $0.id != j.id }
        l.append(j)
        write(l)
    }

    func untrack(id: String) { write(list().filter { $0.id != id }) }

    func clear() { UserDefaults.standard.removeObject(forKey: key) }

    // MARK: ثبت وظایف پس‌زمینه (باید قبل از پایان راه‌اندازی اپ صدا زده شود)

    nonisolated static func register() {
        for id in [refreshId, pollId] {
            BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { task in
                Task { @MainActor in BackgroundJobs.shared.handle(task) }
            }
        }
    }

    func schedule() {
        let hasJobs = !list().isEmpty
        let r = BGAppRefreshTaskRequest(identifier: Self.refreshId)
        r.earliestBeginDate = Date(timeIntervalSinceNow: hasJobs ? 60 : 6 * 3600)
        try? BGTaskScheduler.shared.submit(r)
        if hasJobs {
            let p = BGProcessingTaskRequest(identifier: Self.pollId)
            p.requiresNetworkConnectivity = true
            p.requiresExternalPower = false
            p.earliestBeginDate = Date(timeIntervalSinceNow: 60)
            try? BGTaskScheduler.shared.submit(p)
        }
    }

    private func handle(_ task: BGTask) {
        var finished = false
        func finish(_ ok: Bool) {
            if finished { return }
            finished = true
            task.setTaskCompleted(success: ok)
        }
        let work = Task { @MainActor in
            _ = await self.pollOnce()
            await self.refreshAccount()
            self.schedule()
            finish(true)
        }
        task.expirationHandler = {
            work.cancel()
            Task { @MainActor in finish(false) }
        }
    }

    // MARK: رفتن به پس‌زمینه

    func appDidEnterBackground() {
        guard !list().isEmpty else { schedule(); return }
        endBackgroundTask()
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "pptsaz.jobs") { [weak self] in
            self?.endBackgroundTask()
        }
        Task { @MainActor in
            var rounds = 0
            while UIApplication.shared.backgroundTimeRemaining > 8 && rounds < 12 {
                let open = await self.pollOnce()
                if !open { break }
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                rounds += 1
            }
            self.endBackgroundTask()
            self.schedule()
        }
    }

    private func endBackgroundTask() {
        if bgTask != .invalid {
            UIApplication.shared.endBackgroundTask(bgTask)
            bgTask = .invalid
        }
    }

    // MARK: پرسش از سرور

    /// یک دور پرسش برای همه‌ی کارها؛ true یعنی هنوز کار باز داریم
    func pollOnce() async -> Bool {
        var open = false
        let now = Date().timeIntervalSince1970 * 1000
        for j in list() {
            if now - j.t > 30 * 60_000 { untrack(id: j.id); continue }
            do {
                let r = try await Api.shared.job(j.id)
                switch r["state"].str {
                case "done": await completed(j, r)
                case "error": await failed(j, r["message"].str)
                default: open = true
                }
            } catch {
                if let e = error as? ApiError, e.status == 401 || e.status == 403 || e.status == 404 {
                    untrack(id: j.id)
                } else {
                    open = true
                }
            }
        }
        return open
    }

    private func completed(_ j: TrackedJob, _ r: J) async {
        untrack(id: j.id)
        switch j.kind {
        case "deck":
            let title = r["title"].str.isEmpty ? j.title : r["title"].str
            if Handled.first("done.\(j.id)") {
                ReminderCenter.shared.onDeckDone()
                PendingSaves.add(PendingSave(
                    id: j.id, title: title, slides: r["slides"].int,
                    handoutId: r["handout"].str == "ok" ? r["handoutId"].str : "",
                    posterId: r["poster"].str == "ok" ? r["posterId"].str : ""))
            }
            await Notify.shared.jobDone(id: j.id, title: title)
            let now = Date().timeIntervalSince1970 * 1000
            if r["audio"].str == "pending", !r["audioId"].str.isEmpty {
                track(TrackedJob(id: r["audioId"].str, kind: "audio", deckId: j.id, title: title, t: now))
                await Notify.shared.scheduleWait(id: "\(j.id)|audio", kind: "audio", afterSeconds: 420)
            }
            if r["podcast"].str == "pending", !r["podcastId"].str.isEmpty {
                track(TrackedJob(id: r["podcastId"].str, kind: "podcast", deckId: j.id, title: title, t: now))
                await Notify.shared.scheduleWait(id: "\(j.id)|podcast", kind: "podcast", afterSeconds: 420)
            }
        default:
            let ok = !r["ids"].arr.filter { !$0.str.isEmpty }.isEmpty
            if ok {
                if Handled.first("extra.\(j.id)") { ReminderCenter.shared.onExtraMade() }
                await Notify.shared.extraDone(deckId: j.deckId, kind: j.kind, title: j.title)
            } else {
                await Notify.shared.extraFailed(deckId: j.deckId, kind: j.kind, message: "")
            }
        }
    }

    private func failed(_ j: TrackedJob, _ message: String) async {
        untrack(id: j.id)
        if j.kind == "deck" {
            await Notify.shared.jobFailed(id: j.id, message: message)
        } else {
            await Notify.shared.extraFailed(deckId: j.deckId, kind: j.kind, message: message)
        }
    }

    private func refreshAccount() async {
        guard let me = try? await Api.shared.me() else { return }
        ReminderCenter.shared.onMe(me, dailyFreeOn: Pref.bool(Pref.dailyFree, false), opened: false)
    }
}
