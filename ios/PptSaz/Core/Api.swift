import Foundation
import UIKit

struct ApiError: Error, LocalizedError {
    var message: String
    var status: Int = 0
    var needPlan = false
    var noCredit = false
    var needMobile = false
    var errorDescription: String? { message }
}

struct Fetched {
    var name: String
    var mime: String
    var data: Data
}

/// ارتباط با API سایت (همان سرویس اپ اندروید). نشست با کوکی `sid` نگه داشته می‌شود.
final class Api {
    static let shared = Api()
    static let base = "https://pptsaz.ir"

    private static let noNet = "اتصال برقرار نشد. اینترنت خود را بررسی کنید."
    private static let cookieKey = "pptsaz.cookies.v1"

    private let session: URLSession
    private let ua: String

    private init() {
        let cfg = URLSessionConfiguration.default
        cfg.httpCookieStorage = HTTPCookieStorage.shared
        cfg.httpShouldSetCookies = true
        cfg.httpCookieAcceptPolicy = .always
        cfg.timeoutIntervalForRequest = 120
        cfg.timeoutIntervalForResource = 300
        session = URLSession(configuration: cfg)
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
        ua = "PptSazApp/\(v) (ios; iOS \(UIDevice.current.systemVersion))"
        restoreCookies()
    }

    // MARK: کوکی نشست

    /// کوکی نشست را علاوه بر ذخیره‌ی خود سیستم، در UserDefaults هم نگه می‌داریم تا بعد از بستن اپ وارد بمانید.
    func persistCookies() {
        guard let url = URL(string: Api.base) else { return }
        let list = HTTPCookieStorage.shared.cookies(for: url) ?? []
        var saved: [[String: Any]] = []
        for c in list {
            guard let props = c.properties else { continue }
            var d: [String: Any] = [:]
            for (k, v) in props { d[k.rawValue] = v }
            saved.append(d)
        }
        UserDefaults.standard.set(saved, forKey: Api.cookieKey)
    }

    private func restoreCookies() {
        guard let saved = UserDefaults.standard.array(forKey: Api.cookieKey) as? [[String: Any]] else { return }
        for d in saved {
            var props: [HTTPCookiePropertyKey: Any] = [:]
            for (k, v) in d { props[HTTPCookiePropertyKey(rawValue: k)] = v }
            if let c = HTTPCookie(properties: props), (c.expiresDate ?? Date.distantFuture) > Date() {
                HTTPCookieStorage.shared.setCookie(c)
            }
        }
    }

    func clearSession() {
        if let url = URL(string: Api.base) {
            for c in HTTPCookieStorage.shared.cookies(for: url) ?? [] { HTTPCookieStorage.shared.deleteCookie(c) }
        }
        UserDefaults.standard.removeObject(forKey: Api.cookieKey)
    }

    // MARK: درخواست پایه

    private func makeRequest(_ method: String, _ path: String, body: Data? = nil, contentType: String? = nil) throws -> URLRequest {
        guard let url = URL(string: Api.base + path) else { throw ApiError(message: "نشانی نامعتبر است.") }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue(ua, forHTTPHeaderField: "User-Agent")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue(Api.base, forHTTPHeaderField: "Origin") // سرور برای درخواست‌های غیر GET همین هدر را چک می‌کند (ضد CSRF)
        if let body = body {
            r.httpBody = body
            r.setValue(contentType ?? "application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    private func perform(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw ApiError(message: Api.noNet) }
            return (data, http)
        } catch let e as URLError {
            if e.code == .cancelled { throw CancellationError() }
            throw ApiError(message: Api.noNet)
        }
    }

    private func errorFrom(_ data: Data, _ status: Int, fallback: String? = nil) -> ApiError {
        let j = J(try? JSONSerialization.jsonObject(with: data))
        let msg = j["error"].str
        return ApiError(
            message: msg.isEmpty ? (fallback ?? "خطا در ارتباط با سرور (\(Fa.digits(String(status))))") : msg,
            status: status, needPlan: j["needPlan"].bool, noCredit: j["noCredit"].bool, needMobile: j["needMobile"].bool
        )
    }

    private func send(_ method: String, _ path: String, body: Data?, contentType: String? = nil) async throws -> J {
        let req = try makeRequest(method, path, body: body, contentType: contentType)
        let (data, http) = try await perform(req)
        if !(200..<300).contains(http.statusCode) { throw errorFrom(data, http.statusCode) }
        return J(try? JSONSerialization.jsonObject(with: data))
    }

    private func call(_ method: String, _ path: String, _ body: [String: Any]? = nil) async throws -> J {
        var data: Data? = nil
        if method != "GET" { data = try JSONSerialization.data(withJSONObject: body ?? [:]) }
        return try await send(method, path, body: data)
    }

    private func enc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }

    // MARK: پیکربندی و حساب

    func config() async throws -> Config { parseConfig(try await call("GET", "/api/config")) }

    /// nil یعنی وارد نشده‌اید
    func me() async throws -> Me? { parseMe(try await call("GET", "/api/me")) }

    func otpSend(_ id: String) async throws {
        let key = id.contains("@") ? "email" : "mobile"
        _ = try await call("POST", "/api/auth/otp/send", [key: id])
    }

    func otpVerify(_ id: String, code: String) async throws {
        let key = id.contains("@") ? "email" : "mobile"
        _ = try await call("POST", "/api/auth/otp/verify", [key: id, "code": code])
        persistCookies()
    }

    func logout() async {
        _ = try? await call("POST", "/api/auth/logout")
        clearSession()
    }

    func putSettings(_ pairs: [String: Any]) async throws {
        _ = try await call("PUT", "/api/settings", pairs)
    }

    func updateName(_ name: String) async throws {
        _ = try await call("PUT", "/api/profile", ["name": name])
    }

    func contactSend(kind: String, value: String) async throws {
        let key = kind == "email" ? "email" : "mobile"
        _ = try await call("POST", "/api/auth/otp/send", [key: value])
    }

    /// تایید کد و ثبت روی حساب؛ خروجی: اعتبار هدیه‌ای که همین حالا اضافه شد
    func contactVerify(kind: String, value: String, code: String) async throws -> Int {
        let key = kind == "email" ? "email" : "mobile"
        let j = try await call("POST", "/api/profile/\(key)", [key: value, "code": code])
        return j["reward"].int
    }

    func channelNotify(plat: String, on: Bool) async throws {
        _ = try await call("POST", "/api/profile/channel/notify", ["plat": plat, "on": on])
    }

    func channelUnlink(plat: String) async throws {
        _ = try await call("POST", "/api/profile/channel/unlink", ["plat": plat])
    }

    func invite() async throws -> InviteInfo {
        let j = try await call("GET", "/api/invite")
        let link = j["webLink"].str.isEmpty ? j["link"].str : j["webLink"].str
        return InviteInfo(
            link: link, count: j["count"].int,
            max: j["max"].exists ? j["max"].int : 40,
            every: j["every"].exists ? j["every"].int : 2,
            plusEvery: j["plusEvery"].exists ? j["plusEvery"].int : 20,
            canClaim: j["canClaim"].bool
        )
    }

    func inviteClaim(_ code: String) async throws {
        _ = try await call("POST", "/api/invite/claim", ["code": code.trimmingCharacters(in: .whitespacesAndNewlines)])
    }

    // MARK: پشتیبانی

    func supportHistory() async throws -> SupportData { parseSupport(try await call("GET", "/api/support/history")) }

    func supportSend(_ text: String) async throws -> SupportData {
        parseSupport(try await call("POST", "/api/support/send", ["text": text]))
    }

    // MARK: ساخت

    func generate(topic: String, slides: Int, handout: Bool, source: String, poster: String?, images: Bool, imagesMany: Bool, audio: Bool, podcast: Bool) async throws -> String {
        var b: [String: Any] = ["topic": topic, "slides": slides, "handout": handout, "images": images, "imagesMany": images && imagesMany]
        if let p = poster, !p.isEmpty { b["poster"] = p }
        if audio { b["audio"] = true }
        if podcast { b["podcast"] = true }
        if !source.isEmpty { b["source"] = source }
        return try await call("POST", "/api/generate", b)["jobId"].str
    }

    /// ساخت جداگانه‌ی پوستر/جزوه/اسلاید صوتی/پادکست برای ارائه‌ی ساخته‌شده (۱ اعتبار)
    func startExtra(deckId: String, kind: String, layout: String?) async throws -> String {
        var b: [String: Any] = ["kind": kind]
        if let l = layout { b["layout"] = l }
        return try await call("POST", "/api/files/\(enc(deckId))/extra", b)["jobId"].str
    }

    func job(_ id: String) async throws -> J { try await call("GET", "/api/jobs/\(enc(id))") }

    /// متن PDF یا عکس را در سرور استخراج می‌کند
    func extractText(_ data: Data, mime: String) async throws -> String {
        let j = try await send("POST", "/api/extract", body: data, contentType: mime)
        let direct = j["text"].str
        if !direct.isEmpty { return direct }
        let id = j["jobId"].str
        if id.isEmpty { throw ApiError(message: "استخراج متن انجام نشد.") }
        let t0 = Date()
        for _ in 0..<60 {
            try await Task.sleep(nanoseconds: Poll.delayNs(elapsed: Date().timeIntervalSince(t0)))
            let s = try await call("GET", "/api/extract/\(enc(id))")
            switch s["state"].str {
            case "done": return s["text"].str
            case "error": throw ApiError(message: s["message"].str.isEmpty ? "استخراج متن انجام نشد." : s["message"].str)
            default: break
            }
        }
        throw ApiError(message: "استخراج متن بیش از حد طول کشید. دوباره تلاش کنید.")
    }

    func linkSource(_ url: String) async throws -> String {
        try await call("POST", "/api/link", ["url": url])["text"].str
    }

    // MARK: پرداخت

    /// نشانی صفحه‌ی پرداخت (درگاه) برای پلن
    func payStart(plan: String) async throws -> URL {
        let r = try await call("POST", "/api/pay/start", ["plan": plan])["url"].str
        let full = r.hasPrefix("http") ? r : Api.base + r
        guard r.isEmpty == false, let u = URL(string: full) else { throw ApiError(message: "اتصال به درگاه پرداخت ممکن نشد.") }
        return u
    }

    /// سیب‌اپ: نشانی sibapp://package_purchase… برای خرید پلن
    func sibappStart(plan: String) async throws -> URL {
        let r = try await call("POST", "/api/pay/sibapp/start", ["plan": plan])["url"].str
        guard let u = URL(string: r), u.scheme == "sibapp" else { throw ApiError(message: "اتصال به سیب‌اپ ممکن نشد.") }
        return u
    }

    /// سیب‌اپ: تایید خرید با شناسه‌ی خرید و فعال‌سازی پلن
    func sibappVerify(purchaseId: String) async throws {
        _ = try await call("POST", "/api/pay/sibapp", ["purchaseId": purchaseId])
    }

    // MARK: فایل‌ها

    func files() async throws -> [FileItem] { parseFiles(try await call("GET", "/api/files")) }

    func previewURL(_ id: String) -> URL? { URL(string: Api.base + "/api/files/\(enc(id))/preview") }

    private static func filename(from cd: String) -> String? {
        if let r = cd.range(of: "filename*=UTF-8''", options: .caseInsensitive) {
            var rest = String(cd[r.upperBound...])
            if let semi = rest.firstIndex(of: ";") { rest = String(rest[..<semi]) }
            if let dec = rest.removingPercentEncoding, !dec.isEmpty { return dec }
        }
        if let r = cd.range(of: "filename=", options: .caseInsensitive) {
            var rest = String(cd[r.upperBound...])
            if let semi = rest.firstIndex(of: ";") { rest = String(rest[..<semi]) }
            rest = rest.trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
            if !rest.isEmpty { return rest }
        }
        return nil
    }

    /// فایل را می‌گیرد. بلافاصله بعد از اتمام کار ممکن است چند ثانیه 404 بدهد؛ پس تا maxRetries بار (هر ۳ ثانیه) دوباره تلاش می‌شود.
    func fetchFile(_ id: String, suffix: String = "", fallbackName: String = "presentation.pptx", maxRetries: Int = 20) async throws -> Fetched {
        var attempt = 0
        while true {
            let req = try makeRequest("GET", "/api/files/\(enc(id))\(suffix)")
            let (data, http) = try await perform(req)
            if (200..<300).contains(http.statusCode) {
                let cd = http.value(forHTTPHeaderField: "Content-Disposition") ?? ""
                let name = Api.filename(from: cd) ?? fallbackName
                let mime = (http.value(forHTTPHeaderField: "Content-Type") ?? "").components(separatedBy: ";").first ?? ""
                return Fetched(name: name, mime: mime.trimmingCharacters(in: .whitespaces), data: data)
            }
            if http.statusCode == 404 && attempt < maxRetries {
                attempt += 1
                try await Task.sleep(nanoseconds: 3_000_000_000)
                continue
            }
            throw errorFrom(data, http.statusCode, fallback: "دانلود انجام نشد (\(Fa.digits(String(http.statusCode))))")
        }
    }
}
