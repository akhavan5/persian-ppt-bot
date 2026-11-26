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
        guard !appID.isEmpty, !sender.isEmpty, !appID.hasPrefix("$(") else { return }
        if FirebaseApp.app() == nil {
            let o = FirebaseOptions(googleAppID: appID, gcmSenderID: sender)
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
