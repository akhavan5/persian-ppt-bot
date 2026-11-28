import SwiftUI
import SafariServices
import QuickLook
import WebKit

enum Theme {
    static let brand = Color(red: 0.145, green: 0.388, blue: 0.922)
    static let cyan = Color(red: 0.024, green: 0.714, blue: 0.831)
    static var gradient: LinearGradient {
        LinearGradient(colors: [brand, cyan], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
    static let success = Color(red: 0.13, green: 0.62, blue: 0.33)
}

// MARK: - کارت و دکمه

struct CardModifier: ViewModifier {
    var padding: CGFloat = 16
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardModifier(padding: padding)) }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(isEnabled ? AnyShapeStyle(Theme.gradient) : AnyShapeStyle(Color.gray.opacity(0.4)))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: isEnabled ? Theme.brand.opacity(0.3) : .clear, radius: 10, y: 5)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct SoftButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundColor(Theme.brand)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Theme.brand.opacity(configuration.isPressed ? 0.18 : 0.10))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct IconBadge: View {
    let symbol: String
    var color: Color = Theme.brand
    var size: CGFloat = 34
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.48, weight: .semibold))
            .foregroundColor(.white)
            .frame(width: size, height: size)
            .background(color.gradient)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
}

struct SectionHeader: View {
    let title: String
    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundColor(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
    }
}

/// انتخاب‌گر چیپی (تعداد اسلاید و …)
struct Chip: View {
    let text: String
    let selected: Bool
    var locked = false
    let action: () -> Void
    var body: some View {
        Button(action: { Haptic.select(); action() }) {
            HStack(spacing: 4) {
                Text(text)
                if locked { Image(systemName: "lock.fill").font(.caption2) }
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .foregroundColor(selected ? .white : (locked ? .secondary : .primary))
            .background(selected ? AnyShapeStyle(Theme.gradient) : AnyShapeStyle(Color(.tertiarySystemGroupedBackground)))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - اعلان کوتاه (Toast)

struct ToastOverlay: View {
    @EnvironmentObject var m: AppModel
    var body: some View {
        VStack {
            if let t = m.toastItem {
                Text(t.text)
                    .font(.subheadline.weight(.medium))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .background(.regularMaterial)
                    .clipShape(Capsule())
                    .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                    .padding(.horizontal, 24)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { m.toastItem = nil }
            }
            Spacer()
        }
        .padding(.top, 8)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: m.toastItem)
        .allowsHitTesting(m.toastItem != nil)
    }
}

// MARK: - Safari (درگاه پرداخت و صفحه‌های وب)

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let c = SFSafariViewController(url: url)
        c.preferredControlTintColor = UIColor(Theme.brand)
        return c
    }
    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

// MARK: - پیش‌نمایش اسلایدها (صفحه‌ی HTML سرور با نشست اپ)

struct PreviewWeb: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let w = WKWebView(frame: .zero)
        w.isOpaque = false
        w.backgroundColor = .clear
        let store = w.configuration.websiteDataStore.httpCookieStore
        let cookies = HTTPCookieStorage.shared.cookies(for: URL(string: Api.base)!) ?? []
        let group = DispatchGroup()
        for c in cookies {
            group.enter()
            store.setCookie(c) { group.leave() }
        }
        group.notify(queue: .main) { w.load(URLRequest(url: url)) }
        return w
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct SlidePreviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let url: URL
    var body: some View {
        NavigationStack {
            PreviewWeb(url: url)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("بستن") { dismiss() } }
                }
        }
    }
}

// MARK: - پیش‌نمایش فایل (QuickLook) و اشتراک‌گذاری

extension View {
    /// QuickLook خود iOS فایل pptx، docx، pdf، عکس و صدا را باز می‌کند و دکمه‌ی اشتراک‌گذاری هم دارد
    func filePreview(_ url: Binding<URL?>) -> some View { quickLookPreview(url) }
}

/// «باز کردن در…»: منوی سیستم با برنامه‌های نصب‌شده‌ای که می‌توانند فایل را باز و ویرایش کنند (Google Slides و Docs، PowerPoint، Keynote، Word…).
/// ShareLink فقط برگه‌ی اشتراک‌گذاری را نشان می‌دهد؛ این منو مستقیم به برنامه‌ی ویرایشگر می‌رسد. اگر هیچ برنامه‌ای فایل را نپذیرد false برمی‌گرداند.
@MainActor
enum OpenIn {
    private static var controller: UIDocumentInteractionController? // تا بسته‌شدن منو زنده بماند

    static func present(_ url: URL) -> Bool {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
        guard var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return false }
        while let next = top.presentedViewController { top = next }
        let c = UIDocumentInteractionController(url: url)
        controller = c
        let b = top.view.bounds
        return c.presentOpenInMenu(from: CGRect(x: b.midX, y: b.maxY - 1, width: 1, height: 1), in: top.view, animated: true)
    }

    /// برنامه‌ای برای باز کردن PPTX نصب نیست: همان ارائه در سایت (Safari) باز می‌شود و دکمه‌ی «Google Slides» سایت
    /// آن را مستقیم در Google Drive خودِ کاربر می‌سازد (نیازی به نصب برنامه نیست). serverID = شناسه‌ی ارائه روی سرور.
    static func openOnSite(_ serverID: String) {
        let safe = String(serverID.unicodeScalars.filter { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_") })
        guard !safe.isEmpty else { return }
        Task { @MainActor in
            // لینک ورود یک‌بارمصرف (بدون ورود دوباره)؛ اگر نشد، آدرس ساده و کاربر خودش وارد می‌شود
            let link = (try? await Api.shared.siteLink(safe)) ?? ""
            if let url = URL(string: link.isEmpty ? Api.base + "/?files=" + safe : link) { _ = await UIApplication.shared.open(url) }
        }
    }

    enum SlidesResult { case created, cancelled, fallback }

    /// ساخت مستقیم Google Slides در Drive خودِ کاربر (DriveSlides)؛ اگر نشد (کلاینت در بیلد نیست، دسترسی ندادن، خطای شبکه) همان مسیر سایت باز می‌شود.
    static func createInSlides(fileURL: URL, title: String, serverID: String) async -> SlidesResult {
        guard DriveSlides.available else { openOnSite(serverID); return .fallback }
        do {
            let data = try Data(contentsOf: fileURL)
            let link = try await DriveSlides.create(title: title, pptx: data)
            guard let url = URL(string: link) else { throw DriveSlides.Failure.failed }
            _ = await UIApplication.shared.open(url)
            return .created
        } catch DriveSlides.Failure.cancelled {
            return .cancelled
        } catch {
            openOnSite(serverID)
            return .fallback
        }
    }
}

struct EmptyStateView: View {
    let symbol: String
    let title: String
    var subtitle: String = ""
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(Theme.gradient)
            Text(title).font(.headline)
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}
