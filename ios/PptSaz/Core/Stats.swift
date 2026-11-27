import Foundation
import FirebaseCore
import FirebaseAnalytics

/// آمار استفاده‌ی اپ با Google Analytics 4 (استریم iOS با bundle ID: ir.pptsaz.app).
/// فقط وقتی کار می‌کند که FIREBASE_IOS_APP_ID و FIREBASE_SENDER_ID هنگام بیلد ست شده باشند (در Info.plist)؛ وگرنه همه‌ی توابع بی‌اثرند.
/// هیچ اطلاعات شخصی (شماره، ایمیل، متن موضوع ارائه) نباید در پارامترها فرستاده شود.
enum Stats {
    private static var on = false

    static func start() {
        let info = Bundle.main.infoDictionary ?? [:]
        let appID = (info["FirebaseAppID"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let sender = (info["FirebaseSenderID"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let apiKey = (info["FirebaseAPIKey"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let projectID = (info["FirebaseProjectID"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        // در تست‌های واحد آنالیتیکس لازم نیست (و بدون مقدارهای کامل فایربیس کل برنامه را با استثنا می‌بندد)
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
        guard !appID.isEmpty, !sender.isEmpty, !apiKey.isEmpty, !projectID.isEmpty,
              ![appID, sender, apiKey, projectID].contains(where: { $0.hasPrefix("$(") }) else { return }
        if FirebaseApp.app() == nil {
            let o = FirebaseOptions(googleAppID: appID, gcmSenderID: sender)
            o.apiKey = apiKey
            o.projectID = projectID
            o.bundleID = Bundle.main.bundleIdentifier ?? "ir.pptsaz.app"
            FirebaseApp.configure(options: o)
        }
        Analytics.setAnalyticsCollectionEnabled(true)
        Analytics.setUserProperty((info["PptSazStore"] as? String) ?? "direct", forName: "store")
        on = true
    }

    static func log(_ name: String, _ params: [String: String] = [:]) {
        guard on else { return }
        Analytics.logEvent(name, parameters: params.mapValues { String($0.prefix(100)) })
    }

    /// SwiftUI صفحه‌ی UIKit ندارد؛ screen_view را دستی می‌فرستیم.
    static func screen(_ name: String) {
        log(AnalyticsEventScreenView, [AnalyticsParameterScreenName: name])
    }
}
