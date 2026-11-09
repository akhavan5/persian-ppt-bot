import SwiftUI
import UIKit

/// پوشش سبک روی JSON خام (مثل org.json در اپ اندروید): هر کلید ناموجود یا نوع نادرست، مقدار خالی می‌دهد و هیچ‌وقت کرش نمی‌کند.
struct J {
    let v: Any?
    init(_ v: Any?) { self.v = v }

    subscript(_ key: String) -> J { J((v as? [String: Any])?[key]) }

    var exists: Bool { v != nil && !(v is NSNull) }
    var str: String {
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return ""
    }
    var int: Int {
        if let n = v as? NSNumber { return n.intValue }
        if let s = v as? String { return Int(s) ?? 0 }
        return 0
    }
    var double: Double {
        if let n = v as? NSNumber { return n.doubleValue }
        if let s = v as? String { return Double(s) ?? 0 }
        return 0
    }
    var bool: Bool {
        if let n = v as? NSNumber { return n.boolValue }
        return false
    }
    var arr: [J] { (v as? [Any])?.map { J($0) } ?? [] }
    var keys: [String] { Array(((v as? [String: Any]) ?? [:]).keys) }
}

enum Fa {
    /// ارقام فارسی و عربی را به لاتین برمی‌گرداند (برای ارسال به سرور)
    static func normalize(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        for ch in s.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars {
            switch ch.value {
            case 0x06F0...0x06F9:
                out.append(Unicode.Scalar(0x30 + ch.value - 0x06F0)!)
            case 0x0660...0x0669:
                out.append(Unicode.Scalar(0x30 + ch.value - 0x0660)!)
            default:
                out.append(ch)
            }
        }
        return String(out)
    }

    /// ارقام لاتین را برای نمایش فارسی می‌کند
    static func digits(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        for ch in s.unicodeScalars {
            if ch.value >= 0x30 && ch.value <= 0x39 {
                out.append(Unicode.Scalar(0x06F0 + ch.value - 0x30)!)
            } else {
                out.append(ch)
            }
        }
        return String(out)
    }
}

extension Int {
    var fa: String { Fa.digits(String(self)) }
}

private func isAsciiDigit(_ c: Character) -> Bool { c >= "0" && c <= "9" }

/// شماره‌ی موبایل ایران را به شکل 09xxxxxxxxx برمی‌گرداند؛ نامعتبر = nil
func normalizeIranMobile(_ raw: String) -> String? {
    var d = String(Fa.normalize(raw).filter { isAsciiDigit($0) || $0 == "+" })
    if d.hasPrefix("+98") { d = String(d.dropFirst(3)) }
    else if d.hasPrefix("0098") { d = String(d.dropFirst(4)) }
    else if d.hasPrefix("98") && d.count == 12 { d = String(d.dropFirst(2)) }
    if d.hasPrefix("0") { d = String(d.dropFirst()) }
    let ok = d.count == 10 && d.hasPrefix("9") && d.allSatisfy { isAsciiDigit($0) }
    return ok ? "0" + d : nil
}

func normalizeEmail(_ raw: String) -> String? {
    let e = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard e.count <= 254, !e.contains(" ") else { return nil }
    let parts = e.split(separator: "@", omittingEmptySubsequences: false)
    guard parts.count == 2, !parts[0].isEmpty else { return nil }
    let domain = parts[1]
    guard let dot = domain.lastIndex(of: "."), dot != domain.startIndex else { return nil }
    return domain.distance(from: dot, to: domain.endIndex) >= 3 ? e : nil
}

/// کادر ورود هم موبایل می‌گیرد هم ایمیل: اگر «@» داشته باشد ایمیل است
func normalizeLoginId(_ raw: String) -> String? {
    raw.contains("@") ? normalizeEmail(raw) : normalizeIranMobile(raw)
}

/// اولین رشته‌ی ۴ تا ۸ رقمی در یک متن (کد تأیید)
func extractOtp(_ text: String) -> String? {
    let s = Fa.normalize(text)
    guard let r = s.range(of: "(?<!\\d)\\d{4,8}(?!\\d)", options: .regularExpression) else { return nil }
    return String(s[r])
}

func persianDate(_ ms: Double) -> String {
    guard ms > 0 else { return "" }
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .persian)
    f.locale = Locale(identifier: "fa_IR")
    f.dateStyle = .long
    return f.string(from: Date(timeIntervalSince1970: ms / 1000))
}

/// «۵ ساعت و ۱۲ دقیقه مانده» برای فایل‌هایی که ۲۴ ساعت روی سرور می‌مانند
func remainingText(createdMs: Double) -> String {
    let left = createdMs + 86_400_000 - Date().timeIntervalSince1970 * 1000
    if left <= 0 { return "در حال انقضا" }
    let mins = Int(left / 60_000)
    if mins >= 60 { return "\((mins / 60).fa) ساعت مانده" }
    return "\(max(mins, 1).fa) دقیقه مانده"
}

extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        self.init(
            red: Double((v >> 16) & 255) / 255,
            green: Double((v >> 8) & 255) / 255,
            blue: Double(v & 255) / 255
        )
    }
}

enum Haptic {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
}
