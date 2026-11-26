import UIKit
import UserNotifications

/// مقصدی که با زدن روی اعلان باز می‌شود
struct NotifyRoute {
    var tab: Int? = nil
    var topic: String? = nil
    var url: URL? = nil
    var jobId: String? = nil
    var action: String? = nil   // open | download | preview
}

/// اعلان‌های محلی (بدون APNs و بدون حساب Apple Developer): «ارائه آماده شد»، «ساخت ناموفق بود»، یادآورهای هوشمند.
/// خود iOS اجازه نمی‌دهد اپ بسته شده بدون Push چیزی اجرا کند، پس برای ساخت‌های طولانی سه لایه داریم:
/// ۱) پرسش از سرور تا ~۳۰ ثانیه بعد از رفتن به پس‌زمینه، ۲) BGTask (هر وقت iOS اجازه دهد)،
/// ۳) یک اعلان «احتمالاً آماده است» که اگر ساخت زودتر تمام شود لغو می‌شود.
final class Notify: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notify()
    static let jobCategory = "ir.pptsaz.job"
    static let remPrefix = "rem."

    private let center = UNUserNotificationCenter.current()
    private var pendingRoute: NotifyRoute?

    var routeHandler: ((NotifyRoute) -> Void)? {
        didSet {
            if let r = pendingRoute, let h = routeHandler {
                pendingRoute = nil
                h(r)
            }
        }
    }

    // MARK: راه‌اندازی

    func setup() {
        center.delegate = self
        let dl = UNNotificationAction(identifier: "download", title: "دانلود", options: [.foreground])
        let pv = UNNotificationAction(identifier: "preview", title: "پیش‌نمایش", options: [.foreground])
        let cat = UNNotificationCategory(identifier: Notify.jobCategory, actions: [dl, pv], intentIdentifiers: [], options: [])
        center.setNotificationCategories([cat])
    }

    // MARK: مجوز

    func status() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func allowed() async -> Bool {
        let s = await status()
        return s == .authorized || s == .provisional || s == .ephemeral
    }

    /// فقط وقتی هنوز پرسیده نشده، پنجره‌ی مجوز سیستم را نشان می‌دهد
    @discardableResult
    func askIfNeeded() async -> Bool {
        if await status() == .notDetermined {
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        }
        return await allowed()
    }

    func openSystemSettings() {
        if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
    }

    // MARK: ارسال

    private func inBackground() async -> Bool {
        await MainActor.run { UIApplication.shared.applicationState != .active }
    }

    func post(id: String, title: String, body: String, delay: TimeInterval, category: String? = nil,
              info: [String: Any] = [:], thread: String? = nil) async {
        guard await allowed() else { return }
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        if let cat = category { c.categoryIdentifier = cat }
        if let th = thread { c.threadIdentifier = th }
        c.userInfo = info
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, delay), repeats: false)
        try? await center.add(UNNotificationRequest(identifier: id, content: c, trigger: trigger))
    }

    // MARK: ساخت ارائه

    /// اعلان احتمالی «تا الان باید تمام شده باشد»؛ با تمام شدن کار لغو می‌شود
    func scheduleWait(id: String, kind: String, afterSeconds: TimeInterval) async {
        guard Pref.bool(Pref.jobNotify, true) else { return }
        let name = kind == "deck" ? "ارائه‌ات" : (kind == "podcast" ? "پادکست" : (kind == "audio" ? "اسلاید صوتی" : "فایلت"))
        await post(id: "job.wait.\(id)", title: "\(name) احتمالاً آماده است",
                   body: "برای دیدن نتیجه اپ را باز کن؛ فایل‌ها ۲۴ ساعت روی سرور می‌مانند.",
                   delay: afterSeconds, info: ["tab": 1, "job": id])
    }

    func cancelWait(_ id: String) {
        center.removePendingNotificationRequests(withIdentifiers: ["job.wait.\(id)"])
    }

    func jobDone(id: String, title: String) async {
        cancelWait(id)
        guard Pref.bool(Pref.jobNotify, true), await inBackground() else { return }
        await post(id: "job.done.\(id)", title: "ارائه‌ات آماده شد ✓",
                   body: title.isEmpty ? "برای دانلود یا پیش‌نمایش، اعلان را باز کن." : title,
                   delay: 1, category: Notify.jobCategory, info: ["tab": 1, "job": id], thread: "jobs")
    }

    func jobFailed(id: String, message: String) async {
        cancelWait(id)
        guard Pref.bool(Pref.jobNotify, true), await inBackground() else { return }
        await post(id: "job.fail.\(id)", title: "ساخت ارائه ناموفق بود",
                   body: message.isEmpty ? "اعتبارت برگشت؛ دوباره تلاش کن." : String(message.prefix(120)),
                   delay: 1, info: ["tab": 0], thread: "jobs")
    }

    func extraDone(deckId: String, kind: String, title: String) async {
        cancelWait("\(deckId)|\(kind)")
        guard Pref.bool(Pref.jobNotify, true), await inBackground() else { return }
        await post(id: "extra.done.\(deckId).\(kind)", title: "\(extraName(kind)) آماده شد ✓",
                   body: title.isEmpty ? "برای دانلود، اعلان را باز کن." : title,
                   delay: 1, info: ["tab": 1, "job": deckId], thread: "jobs")
    }

    func extraFailed(deckId: String, kind: String, message: String) async {
        cancelWait("\(deckId)|\(kind)")
        guard Pref.bool(Pref.jobNotify, true), await inBackground() else { return }
        await post(id: "extra.fail.\(deckId).\(kind)", title: "ساخت \(extraName(kind)) ناموفق بود",
                   body: message.isEmpty ? "اعتبارش برگشت؛ دوباره تلاش کن." : String(message.prefix(120)),
                   delay: 1, info: ["tab": 1], thread: "jobs")
    }

    // MARK: یادآورها

    /// همه‌ی یادآورهای زمان‌بندی‌شده را با فهرست جدید عوض می‌کند
    func replaceReminders(_ plan: [PlannedReminder]) async {
        let pending = await center.pendingNotificationRequests()
        let old = pending.map { $0.identifier }.filter { $0.hasPrefix(Notify.remPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: old)
        guard !plan.isEmpty, await allowed() else { return }
        let now = Date().timeIntervalSince1970 * 1000
        for p in plan {
            var info: [String: Any] = ["tab": p.tab, "kind": p.kind]
            if let t = p.topic { info["topic"] = t }
            if let u = p.url { info["url"] = u }
            await post(id: Notify.remPrefix + p.kind, title: p.title, body: p.body,
                       delay: max(60, (p.at - now) / 1000), info: info)
        }
    }

    func cancelReminders() async {
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map { $0.identifier }.filter { $0.hasPrefix(Notify.remPrefix) })
    }

    // MARK: پاک‌سازی

    /// با باز شدن اپ: اعلان‌های نمایش‌داده‌شده و نشان آیکن پاک می‌شود
    func clearDelivered() {
        center.removeAllDeliveredNotifications()
        Task { try? await center.setBadgeCount(0) }
    }

    func cancelAll() async {
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    // MARK: UNUserNotificationCenterDelegate

    /// اپ جلوی چشم است؛ خود صفحه وضعیت را نشان می‌دهد، پس اعلان سیستم نمی‌آید
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        var r = NotifyRoute()
        r.tab = info["tab"] as? Int
        r.topic = info["topic"] as? String
        if let u = info["url"] as? String { r.url = URL(string: u) }
        r.jobId = info["job"] as? String
        switch response.actionIdentifier {
        case "download": r.action = "download"
        case "preview": r.action = "preview"
        default: r.action = "open"
        }
        DispatchQueue.main.async {
            if let h = self.routeHandler { h(r) } else { self.pendingRoute = r }
            completionHandler()
        }
    }
}
