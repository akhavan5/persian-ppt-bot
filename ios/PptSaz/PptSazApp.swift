import SwiftUI

@main
struct PptSazApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environment(\.layoutDirection, .rightToLeft)
                .environment(\.locale, Locale(identifier: "fa_IR"))
                .tint(Theme.brand)
                .task { await model.bootstrap() }
                .onChange(of: scenePhase) { phase in
                    if phase == .active { Task { await model.onResume() } }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var m: AppModel

    var body: some View {
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
            ToastOverlay()
        }
        .animation(.easeInOut(duration: 0.25), value: m.phase)
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
    var body: some View {
        VStack(spacing: 16) {
            EmptyStateView(symbol: "wifi.exclamationmark", title: "اتصال برقرار نشد", subtitle: message)
            Button("تلاش دوباره") { Task { await m.bootstrap() } }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 40)
        }
    }
}

struct MainTabs: View {
    @EnvironmentObject var m: AppModel
    var body: some View {
        TabView(selection: $m.selectedTab) {
            CreateView()
                .tabItem { Label("ساخت", systemImage: "wand.and.stars") }
                .tag(0)
            FilesView()
                .tabItem { Label("فایل‌ها", systemImage: "folder.fill") }
                .tag(1)
            SettingsView()
                .tabItem { Label("تنظیمات", systemImage: "slider.horizontal.3") }
                .tag(2)
            AccountView()
                .tabItem { Label("حساب", systemImage: "person.crop.circle.fill") }
                .tag(3)
        }
    }
}
