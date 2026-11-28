import Foundation
import AuthenticationServices
import CryptoKit
import UIKit

/// ساخت Google Slides مستقیم از داخل اپ، معادل DriveSlides.kt در اندروید:
/// دسترسی drive.file (OAuth 2.0 + PKCE با ASWebAuthenticationSession؛ بدون SDK اضافه و بدون تأیید گوگل)
/// ← آپلود چندبخشی PPTX به Drive خودِ کاربر با mimeType گوگل‌اسلایدز (گوگل خودش تبدیل می‌کند) ← webViewLink.
/// لازم: OAuth Client از نوع iOS برای bundle ID اپ (ir.pptsaz.app) + فعال بودن Google Drive API.
/// شناسه‌ی کلاینت از کلید GoogleIOSClientID در Info.plist می‌آید (project.yml ← GOOGLE_IOS_CLIENT_ID)؛ محرمانه نیست.
@MainActor
enum DriveSlides {
    enum Failure: Error {
        case unavailable   // Client ID در بیلد نیست
        case cancelled     // کاربر صفحه‌ی گوگل را بست
        case denied        // دسترسی Drive را تیک نزد
        case failed        // هر خطای دیگر (شبکه، سهمیه، …)
    }

    private static let scope = "https://www.googleapis.com/auth/drive.file"
    private static let pptxType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    private static let slidesType = "application/vnd.google-apps.presentation"
    private static let idSuffix = ".apps.googleusercontent.com"

    private static var cached: (token: String, expires: Date)?
    private static var session: ASWebAuthenticationSession?
    private static let presenter = Presenter()

    static var clientID: String {
        (Bundle.main.object(forInfoDictionaryKey: "GoogleIOSClientID") as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// اگر شناسه‌ی کلاینت در بیلد نباشد دکمه به مسیر سایت برمی‌گردد
    static var available: Bool { clientID.hasSuffix(idSuffix) }

    /// scheme برگشت = همان REVERSED_CLIENT_ID که گوگل برای کلاینت iOS تعریف کرده
    private static var redirectScheme: String {
        "com.googleusercontent.apps." + String(clientID.dropLast(idSuffix.count))
    }

    // MARK: ورود و توکن

    private static func accessToken() async throws -> String {
        if let c = cached, c.expires > Date() { return c.token }
        guard available else { throw Failure.unavailable }

        let verifier = randomString(64)
        let challenge = base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = randomString(24)
        let redirect = redirectScheme + ":/oauth2redirect"

        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ]
        guard let authURL = comps.url else { throw Failure.failed }

        let callback = try await webAuth(authURL, scheme: redirectScheme)
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func q(_ n: String) -> String? { items.first { $0.name == n }?.value }
        if q("error") != nil { throw Failure.cancelled }
        guard q("state") == state, let code = q("code"), !code.isEmpty else { throw Failure.failed }

        // تعویض code با توکن (کلاینت iOS «Client Secret» ندارد؛ PKCE جایگزین آن است)
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = formEncode([
            "client_id": clientID,
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": redirect,
            "grant_type": "authorization_code",
        ])
        let (data, resp) = try await dataTask(req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = j["access_token"] as? String, !token.isEmpty
        else { throw Failure.failed }

        // کاربر ممکن است در صفحه‌ی رضایت تیک Drive را برداشته باشد
        let granted = (j["scope"] as? String ?? "").split(separator: " ").map(String.init)
        guard granted.contains(scope) else { throw Failure.denied }

        let ttl = (j["expires_in"] as? Double) ?? 3600
        cached = (token, Date().addingTimeInterval(max(60, ttl - 60)))
        return token
    }

    private static func webAuth(_ url: URL, scheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<URL, Error>) in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
                if let callback = callback {
                    cont.resume(returning: callback)
                } else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    cont.resume(throwing: Failure.cancelled)
                } else {
                    cont.resume(throwing: Failure.failed)
                }
            }
            s.presentationContextProvider = presenter
            s.prefersEphemeralWebBrowserSession = false // اگر قبلاً وارد گوگل شده، حساب را دوباره نمی‌پرسد
            session = s
            if !s.start() { cont.resume(throwing: Failure.failed) }
        }
    }

    // MARK: ساخت ارائه در Drive

    /// ارائه را در Drive می‌سازد و لینک باز کردن در Slides را برمی‌گرداند؛ خطا = throw
    static func create(title: String, pptx: Data) async throws -> String {
        let token = try await accessToken()

        let boundary = "pptsaz" + String(UInt64(Date().timeIntervalSince1970 * 1000), radix: 36)
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let meta = (try? JSONSerialization.data(withJSONObject: ["name": name.isEmpty ? "presentation" : name, "mimeType": slidesType])) ?? Data()

        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".utf8))
        body.append(meta)
        body.append(Data("\r\n--\(boundary)\r\nContent-Type: \(pptxType)\r\n\r\n".utf8))
        body.append(pptx)
        body.append(Data("\r\n--\(boundary)--".utf8))

        var req = URLRequest(url: URL(string: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 120
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/related; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        let (data, resp) = try await dataTask(req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { cached = nil; throw Failure.failed } // توکن باطل شده؛ دفعه‌ی بعد دوباره ورود
        guard (200..<300).contains(status), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.failed }
        if let link = j["webViewLink"] as? String, !link.isEmpty { return link }
        if let id = j["id"] as? String, !id.isEmpty { return "https://docs.google.com/presentation/d/\(id)/edit" }
        throw Failure.failed
    }

    // MARK: ابزار

    private static func dataTask(_ req: URLRequest) async throws -> (Data, URLResponse) {
        do { return try await URLSession.shared.data(for: req) } catch { throw Failure.failed }
    }

    private static func randomString(_ n: Int) -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var g = SystemRandomNumberGenerator()
        return String((0..<n).map { _ in chars[Int(g.next() % UInt64(chars.count))] })
    }

    private static func base64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    private static func formEncode(_ p: [String: String]) -> Data {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+")
        let s = p.map { k, v in "\(k)=\(v.addingPercentEncoding(withAllowedCharacters: allowed) ?? v)" }.joined(separator: "&")
        return Data(s.utf8)
    }

    @MainActor
    private final class Presenter: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
            return scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first ?? ASPresentationAnchor()
        }
    }
}
