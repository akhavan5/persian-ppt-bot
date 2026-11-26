import Foundation
import Compression
import UniformTypeIdentifiers

// MARK: - خواندن ZIP (برای docx / pptx / xlsx) بدون کتابخانه‌ی اضافه

enum MiniZip {
    struct Entry {
        let name: String
        let method: Int
        let compSize: Int
        let size: Int
        let localOffset: Int
    }

    private static func u16(_ b: [UInt8], _ o: Int) -> Int { Int(b[o]) | (Int(b[o + 1]) << 8) }
    private static func u32(_ b: [UInt8], _ o: Int) -> Int {
        Int(b[o]) | (Int(b[o + 1]) << 8) | (Int(b[o + 2]) << 16) | (Int(b[o + 3]) << 24)
    }

    /// فهرست فایل‌های داخل ZIP؛ nil یعنی ZIP معتبر نیست
    static func entries(_ bytes: [UInt8]) -> [Entry]? {
        let n = bytes.count
        guard n >= 22 else { return nil }
        // امضای «پایان فهرست مرکزی» (۰x06054b50) از انتهای فایل
        var eocd = -1
        var i = n - 22
        let lowest = max(0, n - 22 - 65_535)
        while i >= lowest {
            if bytes[i] == 0x50 && bytes[i + 1] == 0x4b && bytes[i + 2] == 0x05 && bytes[i + 3] == 0x06 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { return nil }
        let count = u16(bytes, eocd + 10)
        var p = u32(bytes, eocd + 16)
        var out: [Entry] = []
        for _ in 0..<count {
            guard p + 46 <= n, bytes[p] == 0x50, bytes[p + 1] == 0x4b, bytes[p + 2] == 0x01, bytes[p + 3] == 0x02 else { break }
            let method = u16(bytes, p + 10)
            let comp = u32(bytes, p + 20)
            let size = u32(bytes, p + 24)
            let nameLen = u16(bytes, p + 28)
            let extraLen = u16(bytes, p + 30)
            let commentLen = u16(bytes, p + 32)
            let local = u32(bytes, p + 42)
            guard p + 46 + nameLen <= n else { break }
            let name = String(decoding: bytes[(p + 46)..<(p + 46 + nameLen)], as: UTF8.self)
            out.append(Entry(name: name, method: method, compSize: comp, size: size, localOffset: local))
            p += 46 + nameLen + extraLen + commentLen
        }
        return out
    }

    /// محتوای یک فایل داخل ZIP (روش ذخیره‌ی ساده یا Deflate)؛ فایل‌های بزرگ‌تر از ۳۰ مگابایت رد می‌شوند
    static func read(_ bytes: [UInt8], _ e: Entry) -> Data? {
        guard e.size <= 30_000_000, e.compSize <= 30_000_000 else { return nil }
        let o = e.localOffset
        guard o >= 0, o + 30 <= bytes.count, bytes[o] == 0x50, bytes[o + 1] == 0x4b, bytes[o + 2] == 0x03, bytes[o + 3] == 0x04 else { return nil }
        let start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28)
        guard start + e.compSize <= bytes.count else { return nil }
        if e.size == 0 { return Data() }
        if e.method == 0 { return Data(bytes[start..<(start + e.compSize)]) }
        guard e.method == 8 else { return nil }
        let src = Array(bytes[start..<(start + e.compSize)])
        var dst = [UInt8](repeating: 0, count: e.size)
        let written = src.withUnsafeBufferPointer { sp -> Int in
            dst.withUnsafeMutableBufferPointer { dp -> Int in
                guard let s = sp.baseAddress, let d = dp.baseAddress else { return 0 }
                return compression_decode_buffer(d, e.size, s, e.compSize, nil, COMPRESSION_ZLIB)
            }
        }
        guard written > 0 else { return nil }
        return Data(dst[0..<written])
    }
}

// MARK: - تبدیل فایل‌های سند به متن

enum DocReader {
    static let docxExts: Set<String> = ["docx"]
    static let pptxExts: Set<String> = ["pptx"]
    static let xlsxExts: Set<String> = ["xlsx"]
    static let textExts: Set<String> = ["txt", "md", "csv", "json", "text"]
    static let htmlExts: Set<String> = ["html", "htm"]
    static let audioExts: Set<String> = ["mp3", "m4a", "wav", "ogg", "oga", "opus", "flac", "aac", "amr"]
    static let imageExts: Set<String> = ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "bmp", "tiff"]

    // MARK: کمک‌های regex

    private static func regex(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: p, options: o)
    }

    private static func replace(_ s: String, _ p: String, _ t: String, _ o: NSRegularExpression.Options = []) -> String {
        guard let r = regex(p, o) else { return s }
        return r.stringByReplacingMatches(in: s, options: [], range: NSRange(s.startIndex..., in: s), withTemplate: t)
    }

    /// همه‌ی تطبیق‌ها؛ هر تطبیق = [کل، گروه ۱، گروه ۲، …]
    private static func groups(_ s: String, _ p: String, _ o: NSRegularExpression.Options = []) -> [[String]] {
        guard let r = regex(p, o) else { return [] }
        let ns = s as NSString
        return r.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length)).map { m in
            (0..<m.numberOfRanges).map { i in
                let rg = m.range(at: i)
                return rg.location == NSNotFound ? "" : ns.substring(with: rg)
            }
        }
    }

    static func unescape(_ t: String) -> String {
        var s = t
            .replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&nbsp;", with: " ")
        for g in groups(s, "&#(\\d+);") {
            if let n = UInt32(g[1]), let u = Unicode.Scalar(n) { s = s.replacingOccurrences(of: g[0], with: String(Character(u))) }
        }
        for g in groups(s, "&#[xX]([0-9a-fA-F]+);") {
            if let n = UInt32(g[1], radix: 16), let u = Unicode.Scalar(n) { s = s.replacingOccurrences(of: g[0], with: String(Character(u))) }
        }
        return s.replacingOccurrences(of: "&amp;", with: "&")
    }

    private static func numberIn(_ name: String) -> Int {
        let last = name.split(separator: "/").last.map(String.init) ?? name
        return groups(last, "\\d+").first.flatMap { Int($0[0]) } ?? 0
    }

    private static func zipTexts(_ data: Data, _ want: (String) -> Bool) -> [String: String]? {
        let bytes = [UInt8](data)
        guard let es = MiniZip.entries(bytes) else { return nil }
        var out: [String: String] = [:]
        for e in es where want(e.name) {
            if let d = MiniZip.read(bytes, e) { out[e.name] = String(decoding: d, as: UTF8.self) }
        }
        return out
    }

    // MARK: Word

    static func docxToText(_ data: Data) -> String? {
        guard let files = zipTexts(data, { $0 == "word/document.xml" }), let xml = files["word/document.xml"] else { return nil }
        var s = replace(xml, "</w:p>", "\n")
        s = replace(s, "<w:br\\s*/>|<w:cr\\s*/>", "\n")
        s = replace(s, "<w:tab\\s*/>", "\t")
        s = replace(s, "<[^>]+>", "")
        s = unescape(s)
        s = replace(s, "\n{3,}", "\n\n")
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: PowerPoint

    static func pptxToText(_ data: Data) -> String? {
        guard let files = zipTexts(data, { $0.hasPrefix("ppt/slides/slide") && $0.hasSuffix(".xml") && !$0.contains("_rels") }),
              !files.isEmpty else { return nil }
        var out: [String] = []
        for (i, name) in files.keys.sorted(by: { numberIn($0) < numberIn($1) }).enumerated() {
            let paras = groups(files[name] ?? "", "<a:p[ >].*?</a:p>", .dotMatchesLineSeparators).map { p -> String in
                groups(p[0], "<a:t[^>]*>(.*?)</a:t>", .dotMatchesLineSeparators).map { unescape($0[1]) }.joined()
            }.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            if !paras.isEmpty { out.append("# اسلاید \(i + 1)\n" + paras.joined(separator: "\n")) }
        }
        return out.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Excel

    static func xlsxToText(_ data: Data) -> String? {
        guard let files = zipTexts(data, { $0 == "xl/sharedStrings.xml" || ($0.hasPrefix("xl/worksheets/sheet") && $0.hasSuffix(".xml")) }) else { return nil }
        let sheets = files.keys.filter { $0.hasPrefix("xl/worksheets/") }.sorted { numberIn($0) < numberIn($1) }
        guard !sheets.isEmpty else { return nil }
        let shared: [String] = (files["xl/sharedStrings.xml"]).map { x in
            groups(x, "<si>(.*?)</si>", .dotMatchesLineSeparators).map { si in
                groups(si[1], "<t[^>]*>(.*?)</t>", .dotMatchesLineSeparators).map { unescape($0[1]) }.joined()
            }
        } ?? []
        var out: [String] = []
        for (i, name) in sheets.enumerated() {
            let rows: [String] = groups(files[name] ?? "", "<row[ >].*?</row>", .dotMatchesLineSeparators).prefix(200).map { r in
                groups(r[0], "<c ([^>]*?)(?:/>|>(.*?)</c>)", .dotMatchesLineSeparators).map { c -> String in
                    let attrs = c[1], body = c[2]
                    let t = groups(attrs, "\\bt=\"([^\"]*)\"").first?[1]
                    let v = groups(body, "<v>(.*?)</v>", .dotMatchesLineSeparators).first?[1] ?? ""
                    switch t {
                    case "s": return Int(v).flatMap { $0 >= 0 && $0 < shared.count ? shared[$0] : nil } ?? ""
                    case "inlineStr": return groups(body, "<t[^>]*>(.*?)</t>", .dotMatchesLineSeparators).map { unescape($0[1]) }.joined()
                    default: return unescape(v)
                    }
                }.joined(separator: "\t")
            }.filter { !$0.replacingOccurrences(of: "\t", with: "").trimmingCharacters(in: .whitespaces).isEmpty }
            if !rows.isEmpty { out.append("# برگه \(i + 1)\n" + rows.joined(separator: "\n")) }
        }
        return out.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: HTML و متن ساده

    static func htmlToText(_ html: String) -> String {
        var s = replace(html, "<(script|style|noscript)[^>]*>.*?</\\1>", " ", [.caseInsensitive, .dotMatchesLineSeparators])
        s = replace(s, "<br\\s*/?>|</(p|div|li|h[1-6]|tr)>", "\n", .caseInsensitive)
        s = replace(s, "<[^>]+>", " ")
        s = unescape(s)
        s = replace(s, "[ \\t\u{00A0}]+", " ")
        s = replace(s, " ?\n ?", "\n")
        s = replace(s, "\n{3,}", "\n\n")
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// متن ساده با تشخیص رمزگذاری: BOM یونیکد ← UTF-8 دقیق ← Windows-1256 (فایل‌های قدیمی فارسی ویندوز)
    static func plainText(_ data: Data) -> String {
        var text: String
        if data.count >= 2, data[data.startIndex] == 0xFF, data[data.startIndex + 1] == 0xFE {
            text = String(data: data.dropFirst(2), encoding: .utf16LittleEndian) ?? ""
        } else if data.count >= 2, data[data.startIndex] == 0xFE, data[data.startIndex + 1] == 0xFF {
            text = String(data: data.dropFirst(2), encoding: .utf16BigEndian) ?? ""
        } else if let u = String(data: data, encoding: .utf8) {
            text = u
        } else {
            let enc = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.windowsArabic.rawValue)))
            text = (String(data: data, encoding: enc) ?? String(decoding: data, as: UTF8.self))
                .replacingOccurrences(of: "\u{064A}", with: "\u{06CC}")
                .replacingOccurrences(of: "\u{0643}", with: "\u{06A9}")
        }
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - خواندن منبع از فایل (مثل نسخه‌ی اندروید)

enum SourceImporter {
    static let maxBytes = 24 * 1024 * 1024

    static func mime(forExt ext: String) -> String {
        switch ext {
        case "mp3": return "audio/mpeg"
        case "m4a": return "audio/mp4"
        case "wav": return "audio/wav"
        case "ogg", "oga", "opus": return "audio/ogg"
        case "flac": return "audio/flac"
        case "aac": return "audio/aac"
        case "amr": return "audio/amr"
        default: return "application/octet-stream"
        }
    }

    /// متن یک فایل: PDF / عکس / صدا با سرور، بقیه روی خود گوشی
    static func read(url: URL, voiceEnabled: Bool, status: @escaping @MainActor (String) -> Void) async throws -> String {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let ext = url.pathExtension.lowercased()
        guard let data = try? Data(contentsOf: url) else { throw ApiError(message: "خواندن فایل ممکن نشد.") }

        if ext == "pdf" {
            if data.count > maxBytes { throw ApiError(message: "حجم PDF بیشتر از ۲۴ مگابایت است.") }
            await status("در حال استخراج متن (ممکن است چند دقیقه طول بکشد)…")
            return try await Api.shared.extractText(data, mime: "application/pdf")
        }
        if DocReader.imageExts.contains(ext) {
            guard let jpg = ImageTools.normalizedJPEG(data) else { throw ApiError(message: "این عکس خوانده نشد.") }
            await status("در حال استخراج متن (ممکن است چند دقیقه طول بکشد)…")
            return try await Api.shared.extractText(jpg, mime: "image/jpeg")
        }
        if DocReader.audioExts.contains(ext) {
            if !voiceEnabled { throw ApiError(message: "ورودی صوتی فعال نیست؛ موضوع را بنویس.") }
            if data.count > maxBytes { throw ApiError(message: "حجم فایل صوتی بیشتر از ۲۴ مگابایت است.") }
            await status("در حال تبدیل صدا به متن…")
            return try await Api.shared.extractText(data, mime: mime(forExt: ext))
        }
        if DocReader.docxExts.contains(ext) {
            guard let t = DocReader.docxToText(data) else { throw ApiError(message: "فایل Word قابل خواندن نیست.") }
            if t.isEmpty { throw ApiError(message: "متنی در فایل Word پیدا نشد.") }
            return t
        }
        if DocReader.pptxExts.contains(ext) {
            guard let t = DocReader.pptxToText(data) else { throw ApiError(message: "فایل PowerPoint قابل خواندن نیست.") }
            if t.isEmpty { throw ApiError(message: "متنی در فایل PowerPoint پیدا نشد.") }
            return t
        }
        if DocReader.xlsxExts.contains(ext) {
            guard let t = DocReader.xlsxToText(data) else { throw ApiError(message: "فایل Excel قابل خواندن نیست.") }
            if t.isEmpty { throw ApiError(message: "داده‌ای در فایل Excel پیدا نشد.") }
            return t
        }
        if DocReader.htmlExts.contains(ext) {
            let t = DocReader.htmlToText(DocReader.plainText(data))
            if t.isEmpty { throw ApiError(message: "متنی در فایل HTML پیدا نشد.") }
            return t
        }
        if DocReader.textExts.contains(ext) || ext.isEmpty {
            let t = DocReader.plainText(data)
            if t.isEmpty { throw ApiError(message: "فایل متنی خالی است.") }
            return t
        }
        throw ApiError(message: "فقط PDF، عکس، Word، PowerPoint، Excel، HTML، فایل متنی (txt, csv, json, md) یا فایل صوتی پشتیبانی می‌شود.")
    }
}
