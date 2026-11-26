import SwiftUI
import CoreSpotlight

/// نقطه‌ی ورود UIKit: ثبت وظایف پس‌زمینه، اعلان‌ها، گزارش کرش و میان‌برهای آیکن
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Notify.shared.setup()
        BackgroundJobs.register()      // باید قبل از پایان راه‌اندازی صدا زده شود
        CrashReporter.shared.start()
        Stats.start()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if let item = options.shortcutItem { QuickAction.pending = item.type }
        let cfg = UISceneConfiguration(name: connectingSceneSession.configuration.name, sessionRole: connectingSceneSession.role)
        cfg.delegateClass = SceneDelegate.self
        return cfg
    }
}

/// SwiftUI برای میان‌برهای آیکن (وقتی اپ در پس‌زمینه است) راهی ندارد؛ پس این نماینده فقط همین را دریافت می‌کند
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        QuickAction.handle(shortcutItem.type)
        completionHandler(true)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for c in URLContexts { NotificationCenter.default.post(name: .openedURL, object: c.url) }
    }
}

@main
struct PptSazApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()
    @StateObject private var net = NetworkMonitor()
    @StateObject private var lock = AppLock()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environmentObject(net)
                .environmentObject(lock)
                .environment(\.layoutDirection, .rightToLeft)
                .environment(\.locale, Locale(identifier: "fa_IR"))
                .tint(Theme.brand)
                .task {
                    Notify.shared.routeHandler = { r in Task { @MainActor in model.handleRoute(r) } }
                    if lock.locked { Task { await lock.unlock() } }
                    await model.bootstrap()
                    await model.claimSibappPending()
                }
                .onOpenURL { model.handleURL($0) }
                .onReceive(NotificationCenter.default.publisher(for: .openedURL)) { n in
                    if let u = n.object as? URL { model.handleURL(u) }
                }
                .onReceive(NotificationCenter.default.publisher(for: .quickAction)) { n in
                    model.applyQuickAction(n.object as? String)
                }
                .onContinueUserActivity(CSSearchableItemActionType) { a in
                    if let id = a.userInfo?[CSSearchableItemActivityIdentifier] as? String { model.openSpotlight(id) }
                }
                .onChange(of: scenePhase) { phase in
                    switch phase {
                    case .active:
                        Task { await model.onResume(); await model.claimSibappPending() }
                        if lock.locked { Task { await lock.unlock() } }
                    case .background:
                        BackgroundJobs.shared.appDidEnterBackground()
                        lock.lockIfNeeded()
                    default:
                        break
                    }
                }
                .onChange(of: net.online) { on in
                    if on { Task { await model.onResume(force: true) } }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var m: AppModel
    @EnvironmentObject var net: NetworkMonitor
    @EnvironmentObject var lock: AppLock
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                if !net.online && m.phase != .loading { OfflineBanner() }
                ZStack {
                    switch m.phase {
                    case .loading:
                        SplashView()
                    case .loggedOut:
                        LoginView()
                    case .failed(let msg):
                        RetryView(message: msg)
                    case .ready:
                        MainTabs()
                    }
                }
            }
            ToastOverlay()
            if lock.locked {
                LockView().transition(.opacity)
            } else if lock.enabled && scenePhase != .active {
                // پوشش حریم خصوصی در نمای چندوظیفگی
                Theme.gradient.ignoresSafeArea()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: m.phase)
        .animation(.easeInOut(duration: 0.2), value: lock.locked)
        .alert("نیاز به پلن یا اعتبار", isPresented: Binding(get: { m.upsell != nil }, set: { if !$0 { m.upsell = nil } })) {
            Button("مشاهده‌ی پلن‌ها") { m.selectedTab = 3 }
            Button("بعداً", role: .cancel) {}
        } message: {
            Text(m.upsell ?? "")
        }
        .fullScreenCover(item: $m.payURL, onDismiss: { Task { await m.refreshMe() } }) { item in
            SafariView(url: item.url).ignoresSafeArea()
        }
    }
}

struct SplashView: View {
    var body: some View {
        ZStack {
            Theme.gradient.ignoresSafeArea()
            VStack(spacing: 16) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 96, height: 96)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .shadow(radius: 14, y: 6)
                ProgressView().tint(.white)
            }
        }
    }
}

struct RetryView: View {
    @EnvironmentObject var m: AppModel
    let message: String
    @State private var showLibrary = false

    var body: some View {
        VStack(spacing: 16) {
            EmptyStateView(symbol: "wifi.exclamationmark", title: "اتصال برقرار نشد", subtitle: message)
            Button("تلاش دوباره") { Task { await m.bootstrap() } }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 40)
            if !m.library.isEmpty {
                Button("فایل‌های ذخیره‌شده روی گوشی (\(m.library.count.fa))") { showLibrary = true }
                    .buttonStyle(SoftButtonStyle())
                    .padding(.horizontal, 40)
            }
        }
        .sheet(isPresented: $showLibrary) { OfflineLibrarySheet().environmentObject(m) }
    }
}

struct MainTabs: View {
    @EnvironmentObject var m: AppModel
    var body: some View {
        TabView(selection: $m.selectedTab) {
            CreateView()
                .readableColumn()
                .tabItem { Label("ساخت", systemImage: "wand.and.stars") }
                .tag(0)
            FilesView()
                .readableColumn()
                .tabItem { Label("فایل‌ها", systemImage: "folder.fill") }
                .badge(m.files.filter { !$0.sample }.count)
                .tag(1)
            SettingsView()
                .readableColumn()
                .tabItem { Label("تنظیمات", systemImage: "slider.horizontal.3") }
                .tag(2)
            AccountView()
                .readableColumn()
                .tabItem { Label("حساب", systemImage: "person.crop.circle.fill") }
                .tag(3)
        }
    }
}
