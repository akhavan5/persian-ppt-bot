import Foundation

// MARK: - کتابخانه‌ی فایل‌های ذخیره‌شده روی گوشی

/// kind: deck (PPTX)، handout (Word)، poster (تصویر)، audio (اسلاید صوتی)، podcast (پادکست)، pdf
struct LocalFile: Codable, Identifiable, Hashable {
    var id: String          // «شناسه‌ی سرور|نوع»
    var title: String
    var fileName: String
    var kind: String
    var slides: Int
    var t: Double           // زمان ذخیره (میلی‌ثانیه)
    var size: Int

    var kindLabel: String {
        switch kind {
        case "deck": return "ارائه"
        case "handout": return "جزوه"
        case "poster": return "پوستر"
        case "audio": return "اسلاید صوتی"
        case "podcast": return "پادکست"
        case "pdf": return "PDF"
        default: return "فایل"
        }
    }

    var icon: String {
        switch kind {
        case "deck": return "rectangle.on.rectangle.angled"
        case "handout": return "doc.text"
        case "poster": return "photo.artframe"
        case "audio": return "waveform"
        case "podcast": return "mic.fill"
        case "pdf": return "doc.richtext"
        default: return "doc"
        }
    }

    var isAudio: Bool { kind == "audio" || kind == "podcast" }
}

/// نسخه‌ی محلی فایل‌های ساخته‌شده. فایل‌ها روی سرور فقط ۲۴ ساعت می‌مانند؛ این‌جا تا ۴۰ فایل اخیر در پوشه‌ی Documents اپ نگه داشته می‌شود
/// (در برنامه‌ی Files ← «On My iPhone» ← پاورپوینت‌ساز هم دیده می‌شود). با خروج از حساب پاک می‌شود.
final class LocalLibrary {
    static let shared = LocalLibrary()

    private let key = "pptsaz.library.v1"
    private let maxItems = 40
    private let lock = NSLock()

    var autoSave: Bool {
        get { Pref.bool(Pref.autoSave, true) }
        set { UserDefaults.standard.set(newValue, forKey: Pref.autoSave) }
    }

    var directory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    private func readIndex() -> [LocalFile] {
        guard let d = UserDefaults.standard.data(forKey: key),
              let l = try? JSONDecoder().decode([LocalFile].self, from: d) else { return [] }
        return l
    }

    private func writeIndex(_ l: [LocalFile]) {
        if let d = try? JSONEncoder().encode(l) { UserDefaults.standard.set(d, forKey: key) }
    }

    func url(_ f: LocalFile) -> URL { directory.appendingPathComponent(f.fileName) }

    /// فهرست جدیدترین‌ها اول؛ مواردی که فایلشان (مثلاً از برنامه‌ی Files) حذف شده از فهرست برداشته می‌شود.
    func all() -> [LocalFile] {
        lock.lock()
        defer { lock.unlock() }
        let fm = FileManager.default
        let all = readIndex()
        let alive = all.filter { fm.fileExists(atPath: directory.appendingPathComponent($0.fileName).path) }
        if alive.count != all.count { writeIndex(alive) }
        return alive.sorted { $0.t > $1.t }
    }

    func has(_ id: String) -> Bool { all().contains { $0.id == id } }

    static func sanitize(_ s: String) -> String {
        let bad = CharacterSet(charactersIn: "/\\:*?\"<>|\n\r\t")
        let cleaned = s.components(separatedBy: bad).joined(separator: "-").trimmingCharacters(in: .whitespaces)
        return String(cleaned.prefix(80))
    }

    private func uniqueName(_ preferred: String) -> String {
        let fm = FileManager.default
        let base = (preferred as NSString).deletingPathExtension
        let ext = (preferred as NSString).pathExtension
        var name = preferred
        var n = 2
        while fm.fileExists(atPath: directory.appendingPathComponent(name).path) {
            name = ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"
            n += 1
        }
        return name
    }

    @discardableResult
    func save(id: String, title: String, kind: String, slides: Int, data: Data, fileName: String) -> LocalFile? {
        lock.lock()
        defer { lock.unlock() }
        let fm = FileManager.default
        var l = readIndex()
        if let old = l.first(where: { $0.id == id }) {
            try? fm.removeItem(at: directory.appendingPathComponent(old.fileName))
            l.removeAll { $0.id == id }
        }
        var clean = LocalLibrary.sanitize(fileName)
        if clean.isEmpty { clean = "file" }
        let name = uniqueName(clean)
        do {
            try data.write(to: directory.appendingPathComponent(name), options: .atomic)
        } catch {
            return nil
        }
        let f = LocalFile(id: id, title: title, fileName: name, kind: kind, slides: slides,
                          t: Date().timeIntervalSince1970 * 1000, size: data.count)
        l.insert(f, at: 0)
        while l.count > maxItems {
            let x = l.removeLast()
            try? fm.removeItem(at: directory.appendingPathComponent(x.fileName))
        }
        writeIndex(l)
        return f
    }

    func remove(_ f: LocalFile) {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(f.fileName))
        writeIndex(readIndex().filter { $0.id != f.id })
    }

    func removeAll() {
        lock.lock()
        defer { lock.unlock() }
        for f in readIndex() { try? FileManager.default.removeItem(at: directory.appendingPathComponent(f.fileName)) }
        UserDefaults.standard.removeObject(forKey: key)
    }

    func totalBytes() -> Int { all().reduce(0) { $0 + $1.size } }
}

func formatBytes(_ n: Int) -> String {
    let mb = Double(n) / 1_048_576
    if mb >= 1 { return Fa.digits(String(format: "%.1f", mb)) + " مگابایت" }
    return Fa.digits(String(max(1, n / 1024))) + " کیلوبایت"
}

// MARK: - کش فهرست فایل‌های سرور (برای حالت آفلاین)

struct CachedFile: Codable {
    var id: String
    var title: String
    var slides: Int
    var t: Double
    var poster: Bool
    var handout: Bool
    var audio: String
    var extras: [String]
    var sample: Bool
    var pdf: Bool
    var label: String
}

enum FileCache {
    private static let key = "pptsaz.filecache.v1"

    static func save(_ files: [FileItem]) {
        let list = files.filter { !$0.sample }.map {
            CachedFile(id: $0.id, title: $0.title, slides: $0.slides, t: $0.t, poster: $0.poster, handout: $0.handout,
                       audio: $0.audio, extras: $0.extras, sample: false, pdf: $0.pdf, label: $0.label)
        }
        if let d = try? JSONEncoder().encode(list) { UserDefaults.standard.set(d, forKey: key) }
    }

    /// فقط فایل‌هایی که هنوز در ۲۴ ساعت اخیرند (بعدش از سرور پاک می‌شوند)
    static func load() -> [FileItem] {
        guard let d = UserDefaults.standard.data(forKey: key),
              let list = try? JSONDecoder().decode([CachedFile].self, from: d) else { return [] }
        let now = Date().timeIntervalSince1970 * 1000
        return list.filter { $0.t <= 0 || now - $0.t < 86_400_000 }.map {
            FileItem(id: $0.id, title: $0.title, slides: $0.slides, t: $0.t, poster: $0.poster, handout: $0.handout,
                     audio: $0.audio, extras: $0.extras, sample: $0.sample, pdf: $0.pdf, label: $0.label)
        }
    }

    static func clear() { UserDefaults.standard.removeObject(forKey: key) }
}

// MARK: - پیش‌نویس فرم «ساخت»

struct DraftForm: Codable, Equatable {
    var topic = ""
    var source = ""
    var sourceName = ""
    var handout = false
    var poster = ""
    var audio = false
    var podcast = false

    var isEmpty: Bool { topic.isEmpty && source.isEmpty && !handout && poster.isEmpty && !audio && !podcast }
}

/// اگر اپ وسط تایپ بسته شود، دفعه‌ی بعد همان متن برمی‌گردد. با خروج از حساب پاک می‌شود.
enum Draft {
    private static let key = "pptsaz.draft.v1"

    static func load() -> DraftForm {
        guard let d = UserDefaults.standard.data(forKey: key),
              let f = try? JSONDecoder().decode(DraftForm.self, from: d) else { return DraftForm() }
        return f
    }

    static func save(_ f: DraftForm) {
        if f.isEmpty { clear(); return }
        var x = f
        x.source = String(x.source.prefix(120_000))
        if let d = try? JSONEncoder().encode(x) { UserDefaults.standard.set(d, forKey: key) }
    }

    static func clear() { UserDefaults.standard.removeObject(forKey: key) }
}

// MARK: - ذخیره‌ی خودکار معوق

/// ارائه‌ای که وقتی اپ بسته بود آماده شده؛ دفعه‌ی بعد که اپ باز شد نسخه‌ی محلی‌اش گرفته می‌شود (تا قبل از پاک‌شدن ۲۴ ساعته‌ی سرور).
struct PendingSave: Codable, Equatable {
    var id: String
    var title: String
    var slides: Int
    var handoutId: String
    var posterId: String
}

enum PendingSaves {
    private static let key = "pptsaz.pendingsave.v1"

    static func all() -> [PendingSave] {
        guard let d = UserDefaults.standard.data(forKey: key),
              let l = try? JSONDecoder().decode([PendingSave].self, from: d) else { return [] }
        return l
    }

    private static func write(_ l: [PendingSave]) {
        if let d = try? JSONEncoder().encode(Array(l.suffix(10))) { UserDefaults.standard.set(d, forKey: key) }
    }

    static func add(_ p: PendingSave) {
        var l = all().filter { $0.id != p.id }
        l.append(p)
        write(l)
    }

    static func remove(id: String) { write(all().filter { $0.id != id }) }

    static func clear() { UserDefaults.standard.removeObject(forKey: key) }
}

/// رویدادهایی که فقط یک‌بار باید پردازش شوند (مثلاً «ارائه تمام شد» که هم پیش‌زمینه و هم پس‌زمینه می‌بینند).
enum Handled {
    private static let key = "pptsaz.handled.v1"

    /// true یعنی این کلید همین حالا برای اولین بار ثبت شد
    static func first(_ k: String) -> Bool {
        var l = UserDefaults.standard.stringArray(forKey: key) ?? []
        if l.contains(k) { return false }
        l.append(k)
        UserDefaults.standard.set(Array(l.suffix(80)), forKey: key)
        return true
    }

    static func clear() { UserDefaults.standard.removeObject(forKey: key) }
}
