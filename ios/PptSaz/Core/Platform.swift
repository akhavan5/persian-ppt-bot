import SwiftUI
import Network
import LocalAuthentication
import MetricKit
import CoreSpotlight
import UniformTypeIdentifiers

// MARK: - تنظیمات ساده‌ی اپ (UserDefaults)

/// کلیدهای تنظیمات محلی. `@AppStorage` در صفحه‌ی تنظیمات و بقیه‌ی کد از همین کلیدها می‌خوانند.
enum Pref {
    static let jobNotify = "pptsaz.pref.jobNotify"      // اعلان «ارائه آماده شد»
    static let reminders = "pptsaz.pref.reminders"      // یادآورهای هوشمند
    static let autoSave = "pptsaz.pref.autoSave"        // ذخیره‌ی خودکار روی گوشی
    static let lock = "pptsaz.pref.lock"                // قفل اپ
    static let dailyFree = "pptsaz.cfg.dailyFree"       // آخرین مقدار config.dailyFree > 0 (برای کارهای پس‌زمینه)

    static func bool(_ key: String, _ def: Bool) -> Bool {
        UserDefaults.standard.object(forKey: key) as? Bool ?? def
    }
}

// MARK: - وضعیت اینترنت

/// وضعیت اتصال؛ برای نوار «آفلاین» و به‌روزرسانی خودکار بعد از وصل شدن دوباره.
final class NetworkMonitor: ObservableObject {
    @Published var online = true
    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let ok = path.status == .satisfied
            DispatchQueue.main.async {
                if self?.online != ok { self?.online = ok }
            }
        }
        monitor.start(queue: DispatchQueue(label: "ir.pptsaz.net"))
    }

    deinit { monitor.cancel() }
}

// MARK: - قفل اپ (Face ID / Touch ID / رمز گوشی)

@MainActor
final class AppLock: ObservableObject {
    @Published var locked: Bool
    @Published var authenticating = false

    init() {
        locked = Pref.bool(Pref.lock, false)
    }

    var enabled: Bool { Pref.bool(Pref.lock, false) }

    /// نام روش قفل برای نمایش («Face ID»، «Touch ID» یا «رمز گوشی»)
    static func methodName() -> String {
        let c = LAContext()
        var e: NSError?
        guard c.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &e) else { return "رمز گوشی" }
        switch c.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return "رمز گوشی"
        }
    }

    /// آیا قفل روی این دستگاه ممکن است (رمز یا بیومتریک تنظیم شده باشد)؟
    static func available() -> Bool {
        var e: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &e)
    }

    func lockIfNeeded() {
        if enabled && !authenticating { locked = true }
    }

    func unlock() async {
        guard locked, !authenticating else { return }
        guard AppLock.available() else { locked = false; return }
        authenticating = true
        defer { authenticating = false }
        let ctx = LAContext()
        ctx.localizedCancelTitle = "انصراف"
        do {
            let ok = try await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "برای باز کردن پاورپوینت‌ساز هویتت را تأیید کن")
            if ok { locked = false }
        } catch {
            // کاربر انصراف داد یا ناموفق بود؛ قفل می‌ماند و دکمه‌ی «باز کردن» نمایش داده می‌شود
        }
    }
}

// MARK: - گزارش کرش با MetricKit (بدون کتابخانه‌ی اضافه)

/// iOS خودش گزارش کرش را روز بعد از رخ دادن تحویل می‌دهد (MetricKit). فقط خلاصه‌ی فنی (نسخه، مدل دستگاه، چند فریم اول) به سرور
/// خودمان فرستاده می‌شود؛ هیچ اطلاعات حساب یا محتوای کاربر در آن نیست. سرور همان مسیر `/api/app/crash` اندروید را دارد.
final class CrashReporter: NSObject, MXMetricManagerSubscriber {
    static let shared = CrashReporter()

    func start() {
        MXMetricManager.shared.add(self)
    }

    func didReceive(_ payloads: [MXMetricPayload]) {}

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for p in payloads {
            for c in p.crashDiagnostics ?? [] { send(c) }
        }
    }

    private func frames(_ c: MXCrashDiagnostic) -> [String] {
        guard let obj = try? JSONSerialization.jsonObject(with: c.callStackTree.jsonRepresentation()) else { return [] }
        var out: [String] = []
        var node: J? = J(obj)["callStacks"].arr.first?["callStackRootFrames"].arr.first
        while let n = node, out.count < 14 {
            out.append("\(n["binaryName"].str) +\(n["offsetIntoBinaryTextSegment"].str)")
            node = n["subFrames"].arr.first
        }
        return out
    }

    private func send(_ c: MXCrashDiagnostic) {
        let info = Bundle.main.infoDictionary ?? [:]
        let v = info["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let build = Int(info["CFBundleVersion"] as? String ?? "") ?? 0
        let os = ProcessInfo.processInfo.operatingSystemVersion
        var lines = [
            "iOS crash type=\(c.exceptionType?.stringValue ?? "-") signal=\(c.signal?.stringValue ?? "-")",
            "reason=\(c.terminationReason ?? "-")"
        ]
        lines.append(contentsOf: frames(c))
        let trace = String(lines.joined(separator: "\n").prefix(6000))
        guard trace.count >= 10, let url = URL(string: Api.base + "/api/app/crash") else { return }
        let body: [String: Any] = [
            "v": v, "c": build, "sdk": os.majorVersion,
            "model": "iOS \(c.metaData.deviceType)", "thread": "main", "trace": trace
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.httpBody = data
        r.timeoutInterval = 20
        r.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        r.setValue(Api.base, forHTTPHeaderField: "Origin")
        r.setValue("PptSazApp/\(v) (ios; iOS \(os.majorVersion).\(os.minorVersion))", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: r).resume()
    }
}

// MARK: - میان‌برهای نگه‌داشتن آیکن (Quick Actions)

extension Notification.Name {
    static let quickAction = Notification.Name("ir.pptsaz.quickAction")
    static let openedURL = Notification.Name("ir.pptsaz.openedURL")
    static let spotlightOpen = Notification.Name("ir.pptsaz.spotlightOpen")
}

enum QuickAction {
    static let new = "ir.pptsaz.app.new"
    static let files = "ir.pptsaz.app.files"
    static let library = "ir.pptsaz.app.library"
    /// اجرای سرد اپ از روی میان‌بر: تا آماده شدن اپ نگه داشته می‌شود
    static var pending: String?

    static func handle(_ type: String) {
        pending = type
        NotificationCenter.default.post(name: .quickAction, object: type)
    }
}

// MARK: - Spotlight (جست‌وجوی فایل‌های ذخیره‌شده از صفحه‌ی اصلی گوشی)

enum SpotlightIndex {
    private static let domain = "ir.pptsaz.library"
    static let prefix = "local."

    static func update(_ items: [LocalFile]) {
        let index = CSSearchableIndex.default()
        index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in
            guard !items.isEmpty else { return }
            let list: [CSSearchableItem] = items.map { f in
                let a = CSSearchableItemAttributeSet(contentType: UTType.data)
                a.title = f.title.isEmpty ? f.kindLabel : f.title
                a.contentDescription = "پاورپوینت‌ساز • \(f.kindLabel)"
                return CSSearchableItem(uniqueIdentifier: prefix + f.id, domainIdentifier: domain, attributeSet: a)
            }
            index.indexSearchableItems(list) { _ in }
        }
    }

    static func clear() {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in }
    }
}
