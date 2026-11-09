import SwiftUI

struct FilesView: View {
    @EnvironmentObject var m: AppModel
    @State private var selected: FileItem?
    @State private var showSamples = true

    private var mine: [FileItem] { m.files.filter { !$0.sample } }
    private var samples: [FileItem] { m.files.filter { $0.sample } }

    var body: some View {
        NavigationStack {
            List {
                if !m.filesLoaded {
                    HStack { Spacer(); ProgressView(); Spacer() }
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        if mine.isEmpty {
                            EmptyStateView(symbol: "tray", title: "هنوز فایلی نداری", subtitle: "ارائه‌هایی که می‌سازی ۲۴ ساعت اینجا می‌ماند؛ بعدش حذف می‌شوند، پس فایل را ذخیره کن.")
                                .listRowBackground(Color.clear)
                        } else {
                            ForEach(mine) { f in row(f) }
                        }
                    } header: {
                        Text("فایل‌های من")
                    } footer: {
                        if !mine.isEmpty { Text("فایل‌ها ۲۴ ساعت روی سرور می‌مانند. برای نگه‌داشتن، فایل را باز کن و در «Files» یا برنامه‌ی دلخواه ذخیره کن.") }
                    }
                    if !samples.isEmpty {
                        Section {
                            ForEach(samples) { f in row(f) }
                        } header: {
                            Text("نمونه‌ها")
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await m.loadFiles() }
            .navigationTitle("فایل‌ها")
            .onAppear {
                if m.isDemo && UserDefaults.standard.bool(forKey: "demoFile") && selected == nil {
                    selected = m.files.first
                }
            }
            .sheet(item: $selected) { f in
                FileDetailSheet(item: f).environmentObject(m)
            }
        }
    }

    private func row(_ f: FileItem) -> some View {
        Button {
            selected = f
        } label: {
            HStack(spacing: 12) {
                IconBadge(symbol: FileKind(f).icon, color: color(FileKind(f)), size: 42)
                VStack(alignment: .leading, spacing: 4) {
                    Text(f.title.isEmpty ? FileKind(f).label : f.title)
                        .font(.body.weight(.medium))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 6) {
                        Text(FileKind(f).label)
                        if f.slides > 0 { Text("• \(f.slides.fa) اسلاید") }
                        if f.sample { Text("• نمونه") } else if f.t > 0 { Text("• \(remainingText(createdMs: f.t))") }
                    }
                    .font(.caption)
                    .foregroundColor(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.left")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(Color(.tertiaryLabel))
            }
            .padding(.vertical, 4)
        }
    }

    private func color(_ k: FileKind) -> Color {
        switch k {
        case .deck: return Theme.brand
        case .poster: return .teal
        case .handout: return .blue
        case .audio: return .pink
        case .podcast: return .red
        case .pdf: return .orange
        }
    }
}

struct FileDetailSheet: View {
    @EnvironmentObject var m: AppModel
    @Environment(\.dismiss) private var dismiss
    let item: FileItem

    @State private var quick: URL?
    @State private var busyDownload = false
    @State private var busyPdf = false
    @State private var showPreview = false
    @State private var posterChoice = false

    private var kind: FileKind { FileKind(item) }
    private var isDeck: Bool { kind == .deck && !item.sample }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    header
                    actions
                    if !item.extras.isEmpty && !item.sample { extrasSection }
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("بستن") { dismiss() } }
            }
            .filePreview($quick)
            .sheet(isPresented: $showPreview) {
                if let u = m.previewURL(item.id) {
                    SlidePreviewSheet(title: item.title.isEmpty ? "پیش‌نمایش" : item.title, url: u)
                }
            }
            .confirmationDialog("چیدمان پوستر", isPresented: $posterChoice, titleVisibility: .visible) {
                Button("افقی") { Task { await m.makeExtra(deckId: item.id, kind: "poster", layout: "wide") } }
                Button("عمودی") { Task { await m.makeExtra(deckId: item.id, kind: "poster", layout: "tall") } }
                Button("انصراف", role: .cancel) {}
            } message: {
                Text("ساخت پوستر ۱ اعتبار دارد.")
            }
        }
        .presentationDetents(m.isDemo ? [.large] : [.medium, .large])
    }

    private var header: some View {
        VStack(spacing: 12) {
            IconBadge(symbol: kind.icon, color: Theme.brand, size: 64)
            Text(item.title.isEmpty ? kind.label : item.title)
                .font(.title3.bold())
                .multilineTextAlignment(.center)
            HStack(spacing: 6) {
                Text(kind.label)
                if item.slides > 0 { Text("• \(item.slides.fa) اسلاید") }
                if !item.sample && item.t > 0 { Text("• \(remainingText(createdMs: item.t))") }
            }
            .font(.footnote)
            .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    private var actions: some View {
        VStack(spacing: 10) {
            if isDeck {
                Button {
                    showPreview = true
                } label: {
                    Label("پیش‌نمایش اسلایدها", systemImage: "play.rectangle.fill")
                }
                .buttonStyle(SoftButtonStyle())
            }
            Button {
                Task {
                    busyDownload = true
                    quick = await m.download(item)
                    busyDownload = false
                    if quick != nil { Haptic.success() }
                }
            } label: {
                if busyDownload { ProgressView().tint(.white) }
                else { Label(openTitle, systemImage: "square.and.arrow.down") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busyDownload)

            if isDeck && m.cfg.pdf {
                Button {
                    Task {
                        busyPdf = true
                        quick = await m.download(item, pdf: true)
                        busyPdf = false
                    }
                } label: {
                    if busyPdf { ProgressView() } else { Label("دریافت PDF", systemImage: "doc.richtext") }
                }
                .buttonStyle(SoftButtonStyle())
                .disabled(busyPdf)
            }
            Text("بعد از باز شدن، با دکمه‌ی اشتراک‌گذاری فایل را در Files، PowerPoint، Keynote یا پیام‌رسان‌ها ذخیره یا ارسال کن.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 2)
        }
    }

    private var openTitle: String {
        switch kind {
        case .deck: return "دریافت و باز کردن PPTX"
        case .poster: return "نمایش پوستر"
        case .handout: return "دریافت جزوه"
        case .audio, .podcast: return "پخش"
        case .pdf: return "باز کردن PDF"
        }
    }

    private var extrasSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ساخت جداگانه").font(.headline)
            Text("هر مورد ۱ اعتبار دارد و اگر ساخت ناموفق باشد برمی‌گردد.")
                .font(.caption)
                .foregroundColor(.secondary)
            ForEach(item.extras, id: \.self) { k in
                let key = "\(item.id)|\(k)"
                let busy = m.extraBusy.contains(key)
                Button {
                    if k == "poster" { posterChoice = true }
                    else { Task { await m.makeExtra(deckId: item.id, kind: k) } }
                } label: {
                    HStack(spacing: 10) {
                        if busy { ProgressView() } else { Image(systemName: extraIcon(k)) }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("ساخت \(extraName(k))")
                            if busy, let msg = m.extraMsg[key] {
                                Text(msg).font(.caption2).foregroundColor(.secondary).lineLimit(1)
                            }
                        }
                        Spacer()
                    }
                }
                .buttonStyle(SoftButtonStyle())
                .disabled(busy)
            }
        }
        .card()
    }
}
