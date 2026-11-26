import SwiftUI
import UIKit
import VisionKit

// MARK: - ذخیره در برنامه‌ی Files

struct DocumentExporter: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        UIDocumentPickerViewController(forExporting: [url], asCopy: true)
    }
    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
}

// MARK: - اسکن با دوربین (VisionKit)

struct DocumentScanner: UIViewControllerRepresentable {
    var onFinish: ([UIImage]) -> Void
    var onCancel: () -> Void

    static var supported: Bool { VNDocumentCameraViewController.isSupported }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let v = VNDocumentCameraViewController()
        v.delegate = context.coordinator
        return v
    }

    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let parent: DocumentScanner
        init(_ p: DocumentScanner) { parent = p }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            var pages: [UIImage] = []
            for i in 0..<min(scan.pageCount, 10) { pages.append(scan.imageOfPage(at: i)) }
            parent.onFinish(pages)
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { parent.onCancel() }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { parent.onCancel() }
    }
}

// MARK: - نوار آفلاین

struct OfflineBanner: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
            Text("اینترنت قطع است؛ فایل‌های ذخیره‌شده روی گوشی در دسترس‌اند.")
                .font(.footnote.weight(.medium))
                .multilineTextAlignment(.leading)
        }
        .foregroundColor(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(Color.orange.gradient)
    }
}

// MARK: - صفحه‌ی قفل

struct LockView: View {
    @EnvironmentObject var lock: AppLock

    var body: some View {
        ZStack {
            Theme.gradient.ignoresSafeArea()
            VStack(spacing: 18) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .shadow(radius: 12, y: 5)
                Text("پاورپوینت‌ساز قفل است")
                    .font(.title3.bold())
                    .foregroundColor(.white)
                Button {
                    Task { await lock.unlock() }
                } label: {
                    Label("باز کردن با \(AppLock.methodName())", systemImage: "lock.open.fill")
                        .font(.headline)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 12)
                        .background(.white)
                        .foregroundColor(Theme.brand)
                        .clipShape(Capsule())
                }
            }
        }
    }
}

// MARK: - پخش‌کننده‌ی صدا

struct AudioPlayerCard: View {
    let url: URL
    let title: String
    @StateObject private var player = AudioPlayerModel()
    @State private var scrubbing = false
    @State private var scrub: Double = 0

    var body: some View {
        VStack(spacing: 10) {
            Slider(
                value: scrubbing ? $scrub : Binding(get: { player.current }, set: { _ in }),
                in: 0...max(player.duration, 1)
            ) { editing in
                if editing { scrub = player.current }
                else { player.seek(to: scrub) }
                scrubbing = editing
            }
            .tint(Theme.brand)
            HStack {
                Text(clockText(scrubbing ? scrub : player.current))
                Spacer()
                Text(clockText(player.duration))
            }
            .font(.caption.monospacedDigit())
            .foregroundColor(.secondary)

            HStack(spacing: 28) {
                Menu {
                    ForEach([Float(1), 1.25, 1.5, 2], id: \.self) { r in
                        Button(rateText(r)) { player.setRate(r) }
                    }
                } label: {
                    Text(rateText(player.rate))
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 52)
                }
                Button { player.skip(-15) } label: { Image(systemName: "gobackward.15").font(.title2) }
                Button { player.toggle() } label: {
                    Image(systemName: player.playing ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 52))
                        .foregroundStyle(Theme.gradient)
                }
                Button { player.skip(15) } label: { Image(systemName: "goforward.15").font(.title2) }
                Color.clear.frame(width: 52, height: 1)
            }
            .foregroundColor(.primary)
        }
        .environment(\.layoutDirection, .leftToRight)
        .card()
        .onAppear { player.load(url, title: title) }
        .onDisappear { player.stop() }
    }
}

/// «۱٫۲۵×»
func rateText(_ r: Float) -> String {
    let s = r == r.rounded() ? String(Int(r)) : String(r)
    return Fa.digits(s).replacingOccurrences(of: ".", with: "٫") + "×"
}
