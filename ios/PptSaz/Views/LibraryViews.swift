import SwiftUI

/// جزئیات یک فایل ذخیره‌شده روی گوشی: باز کردن، پخش، اشتراک‌گذاری، ذخیره در Files و حذف
struct LocalDetailSheet: View {
    @EnvironmentObject var m: AppModel
    @Environment(\.dismiss) private var dismiss
    let file: LocalFile

    @State private var quick: URL?
    @State private var showExport = false
    @State private var confirmDelete = false
    @State private var busySlides = false

    private var url: URL { LocalLibrary.shared.url(file) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 12) {
                        IconBadge(symbol: file.icon, color: Theme.brand, size: 64)
                        Text(file.title.isEmpty ? file.kindLabel : file.title)
                            .font(.title3.bold())
                            .multilineTextAlignment(.center)
                        HStack(spacing: 6) {
                            Text(file.kindLabel)
                            if file.slides > 0 { Text("• \(file.slides.fa) اسلاید") }
                            Text("• \(formatBytes(file.size))")
                        }
                        .font(.footnote)
                        .foregroundColor(.secondary)
                        Label("روی همین گوشی ذخیره است", systemImage: "iphone")
                            .font(.caption)
                            .foregroundColor(Theme.success)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)

                    if file.isAudio { AudioPlayerCard(url: url, title: file.title.isEmpty ? file.kindLabel : file.title) }

                    VStack(spacing: 10) {
                        if !file.isAudio {
                            Button { quick = url; Haptic.light() } label: {
                                Label("باز کردن", systemImage: "arrow.up.forward.app")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                        }
                        ShareLink(item: url) { Label("اشتراک‌گذاری", systemImage: "square.and.arrow.up") }
                            .buttonStyle(SoftButtonStyle())
                        if file.kind == "deck" {
                            Button {
                                Task {
                                    busySlides = true
                                    let r = await OpenIn.createInSlides(fileURL: url, title: file.title, serverID: String(file.id.split(separator: "|").first ?? ""))
                                    busySlides = false
                                    switch r {
                                    case .created: Haptic.success()
                                    case .cancelled: break
                                    case .fallback: Haptic.light(); m.toast("ساخت مستقیم ممکن نشد؛ ارائه در سایت باز شد، آنجا «Google Slides» را بزن.")
                                    }
                                }
                            } label: {
                                if busySlides { ProgressView() }
                                else { Label("ساخت مستقیم در Google Slides", systemImage: "rectangle.on.rectangle.angled") }
                            }
                            .buttonStyle(SoftButtonStyle())
                            .disabled(busySlides)
                        }
                        // مشاهده در سایت برای همه‌ی نوع فایل (ارائه، پوستر، جزوه، صوت، پادکست)
                        Button { Haptic.light(); OpenIn.openOnSite(String(file.id.split(separator: "|").first ?? "")) } label: { Label("مشاهده در سایت", systemImage: "safari") }
                            .buttonStyle(SoftButtonStyle())
                        if file.kind == "deck" || file.kind == "handout" {
                            Button {
                                if OpenIn.present(url) { Haptic.light() }
                                else if file.kind == "deck" { Haptic.light(); m.toast("برنامه‌ی Slides یا PowerPoint نصب نیست؛ ارائه در سایت باز شد، آنجا «Google Slides» را بزن."); OpenIn.openOnSite(String(file.id.split(separator: "|").first ?? "")) }
                                else { Haptic.error(); m.toast("برنامه‌ای برای ویرایش این فایل نصب نیست") }
                            } label: { Label(file.kind == "deck" ? "ویرایش در Google Slides، PowerPoint…" : "ویرایش در Google Docs، Word…", systemImage: "square.and.pencil") }
                                .buttonStyle(SoftButtonStyle())
                        }
                        Button { showExport = true } label: { Label("ذخیره در برنامه‌ی Files", systemImage: "folder.badge.plus") }
                            .buttonStyle(SoftButtonStyle())
                        Button(role: .destructive) { confirmDelete = true } label: {
                            Label("حذف از گوشی", systemImage: "trash").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                    }
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("بستن") { dismiss() } } }
            .filePreview($quick)
            .sheet(isPresented: $showExport) { DocumentExporter(url: url) }
            .confirmationDialog("این فایل از گوشی حذف شود؟", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("حذف", role: .destructive) {
                    LocalLibrary.shared.remove(file)
                    m.refreshLibrary()
                    dismiss()
                }
                Button("انصراف", role: .cancel) {}
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// فهرست فایل‌های ذخیره‌شده (برای وقتی اینترنت یا حساب در دسترس نیست)
struct OfflineLibrarySheet: View {
    @EnvironmentObject var m: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var selected: LocalFile?

    var body: some View {
        NavigationStack {
            List {
                if m.library.isEmpty {
                    EmptyStateView(symbol: "tray", title: "فایلی روی گوشی ذخیره نیست")
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(m.library) { f in
                        Button { selected = f } label: {
                            HStack(spacing: 12) {
                                IconBadge(symbol: f.icon, color: Theme.brand, size: 40)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(f.title.isEmpty ? f.kindLabel : f.title).foregroundColor(.primary).lineLimit(2)
                                    Text("\(f.kindLabel) • \(formatBytes(f.size))").font(.caption).foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("ذخیره‌شده روی گوشی")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("بستن") { dismiss() } } }
            .sheet(item: $selected) { f in LocalDetailSheet(file: f).environmentObject(m) }
            .onAppear { m.refreshLibrary() }
        }
    }
}
