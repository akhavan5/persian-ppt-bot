import Foundation
import AppIntents

/// میان‌بر «ساخت ارائه» برای برنامه‌ی Shortcuts (و دکمه‌ی Action، ویجت میان‌بر و Siri از طریق Shortcuts).
/// اپ باز می‌شود و موضوع در فرم ساخت گذاشته می‌شود؛ ساخت با زدن دکمه انجام می‌شود (تا اعتبار بی‌اجازه خرج نشود).
struct CreateDeckIntent: AppIntent {
    static let title: LocalizedStringResource = "ساخت ارائه"
    static let description = IntentDescription("موضوع را بگو تا فرم ساخت ارائه در پاورپوینت‌ساز باز شود.")
    static let openAppWhenRun: Bool = true

    @Parameter(title: "موضوع")
    var topic: String?

    @MainActor
    func perform() async throws -> some IntentResult {
        let t = (topic ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(t.isEmpty ? "-" : t, forKey: IntentBridge.topicKey)
        return .result()
    }
}

/// باز کردن تب «فایل‌ها»
struct OpenFilesIntent: AppIntent {
    static let title: LocalizedStringResource = "فایل‌های من"
    static let description = IntentDescription("تب فایل‌های پاورپوینت‌ساز را باز می‌کند.")
    static let openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set("files", forKey: IntentBridge.tabKey)
        return .result()
    }
}

enum IntentBridge {
    static let topicKey = "pptsaz.intent.topic"
    static let tabKey = "pptsaz.intent.tab"

    /// مقدار ثبت‌شده توسط میان‌بر را می‌خواند و پاک می‌کند. topic = "-" یعنی فقط فرم باز شود.
    static func consume() -> (topic: String?, openFiles: Bool) {
        let d = UserDefaults.standard
        let t = d.string(forKey: topicKey)
        let f = d.string(forKey: tabKey) == "files"
        d.removeObject(forKey: topicKey)
        d.removeObject(forKey: tabKey)
        var topic: String? = nil
        if let t = t { topic = (t == "-") ? "" : t }
        return (topic, f)
    }
}
