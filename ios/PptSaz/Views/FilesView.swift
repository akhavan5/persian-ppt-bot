import SwiftUI

private func libraryKind(_ k: FileKind) -> String {
    switch k {
    case .deck: return "deck"
    case .poster: return "poster"
    case .handout: return "handout"
    case .audio: return "audio"
    case .podcast: return "podcast"
    case .pdf: return "pdf"
    }
}

struct FilesView: View {
    @EnvironmentObject var m: AppModel
    @State private var selected: FileItem?
    @State private var selectedLocal: LocalFile?
    @State private var autoAction: String?
    @State private var query = ""

    private func matches(_ title: String, _ label: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty || title.localizedCaseInsensitiveContains(q) || label.contains(q)
    }

    private var mine: [FileItem] { m.files.filter { !$0.sample && matches($0.title, FileKind($0).label) } }
    private var samples: [FileItem] { m.files.filter { $0.sample && matches($0.title, FileKind($0).label) } }
    private var local: [LocalFile] { m.library.filter { matches($0.title, $0.kindLabel) } }

    var body: some View {
        NavigationStack {
            List {
                if !m.filesLoaded && m.library.isEmpty {
                    HStack { Spacer(); ProgressView(); Spacer() }
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        if mine.isEmpty {
                            EmptyStateView(symbol: "tray", title: query.isEmpty ? "هنوز فایلی نداری" : "چیزی پیدا نشد",
                                           subtitle: query.isEmpty ? "ارائه‌هایی که می‌سازی ۲۴ ساعت اینجا می‌ماند و یک نسخه هم روی گوشی ذخیره می‌شود." : "")
                                .listRowBackground(Color.clear)
                        } else {
                            ForEach(mine) { f in row(f) }
                        }
                    } header: {
                        Text("فایل‌های من")
                    } footer: {
                        if !mine.isEmpty { Text("فایل‌ها ۲۴ ساعت روی سرور می‌مانند. نسخه‌ی ذخیره‌شده روی گوشی را پایین می‌بینی.") }
                    }
                    if !local.isEmpty {
                        Section {
                            ForEach(local) { f in localRow(f) }
                        } header: {
                            Text("ذخیره‌شده روی گوشی")
                        } footer: {
                            Text("در برنامه‌ی Files ← On My iPhone ← پاورپوینت‌ساز هم هست. برای حذف، روی هر مورد به چپ بکش.")
                        }
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
            .searchable(text: $query, prompt: "جست‌وجو در فایل‌ها")
            .refreshable { await m.loadFiles(); m.refreshLibrary() }
            .navigationTitle("فایل‌ها")
            .onAppear {
                m.refreshLibrary()
                if m.isDemo && UserDefaults.standard.bool(forKey: "demoFile") && selected == nil {
                    selected = m.files.first
                }
                handleFocus()
            }
            .onChange(of: m.focusFile) { _ in handleFocus() }
            .onChange(of: m.focusLocal) { _ in handleFocus() }
            .sheet(item: $selected, onDismiss: { autoAction = nil }) { f in
                FileDetailSheet(item: f, autoAction: autoAction).environmentObject(m)
            }
            .sheet(item: $selectedLocal) { f in
                LocalDetailSheet(file: f).environmentObject(m)
            }
        }
    }

    private func handleFocus() {
        if let r = m.focusFile {
            m.focusFile = nil
            if let f = m.files.first(where: { $0.id == r.id }) {
                autoAction = r.action
                selected = f
            } else if let l = m.library.first(where: { $0.id.hasPrefix(r.id + "|") }) {
                selectedLocal = l
            } else if m.filesLoaded {
                m.toast("این فایل دیگر روی سرور نیست.")
            }
        }
        if let id = m.focusLocal {
            m.focusLocal = nil
            if let l = m.library.first(where: { $0.id == id }) { selectedLocal = l }
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
                        if m.library.contains(where: { $0.id == "\(f.id)|\(libraryKind(FileKind(f)))" }) {
                            Image(systemName: "iphone").foregroundColor(Theme.success)
                        }
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

    private func localRow(_ f: LocalFile) -> some View {
        Button {
            selectedLocal = f
        } label: {
            HStack(spacing: 12) {
                IconBadge(symbol: f.icon, color: Theme.brand, size: 42)
                VStack(alignment: .leading, spacing: 4) {
                    Text(f.title.isEmpty ? f.kindLabel : f.title)
                        .font(.body.weight(.medium))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text("\(f.kindLabel) • \(formatBytes(f.size))")
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
        .contextMenu {
            ShareLink(item: LocalLibrary.shared.url(f)) { Label("اشتراک‌گذاری", systemImage: "square.and.arrow.up") }
            Button(role: .destructive) {
                LocalLibrary.shared.remove(f)
                m.refreshLibrary()
            } label: { Label("حذف از گوشی", systemImage: "trash") }
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                LocalLibrary.shared.remove(f)
                m.refreshLibrary()
            } label: { Label("حذف", systemImage: "trash") }
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
    var autoAction: String? = nil

    @State private var quick: URL?
    @State private var audioURL: URL?
    @State private var lastURL: URL?
    @State private var busyDownload = false
    @State private var busyPdf = false
    @State private var showPreview = false
    @State private var showExport = false
    @State private var posterChoice = false
    @State private var didAuto = false

    private var kind: FileKind { FileKind(item) }
    private var isDeck: Bool { kind == .deck && !item.sample }
    private var isAudio: Bool { kind == .audio || kind == .podcast }
    private var localCopy: LocalFile? { m.library.first { $0.id == "\(item.id)|\(libraryKind(kind))" } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    header
                    if let u = audioURL { AudioPlayerCard(url: u, title: item.title.isEmpty ? kind.label : item.title).id(u) }
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
            .sheet(isPresented: $showExport) {
                if let u = lastURL ?? localCopy.map({ LocalLibrary.shared.url($0) }) { DocumentExporter(url: u) }
            }
            .confirmationDialog("چیدمان پوستر", isPresented: $posterChoice, titleVisibility: .visible) {
                Button("افقی") { Task { await m.makeExtra(deckId: item.id, kind: "poster", layout: "wide") } }
                Button("عمودی") { Task { await m.makeExtra(deckId: item.id, kind: "poster", layout: "tall") } }
                Button("انصراف", role: .cancel) {}
            } message: {
                Text("ساخت پوستر ۱ اعتبار دارد.")
            }
            .onAppear {
                guard !didAuto, let a = autoAction else { return }
                didAuto = true
                if a == "download" { Task { await open() } }
                else if a == "preview" && isDeck { showPreview = true }
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
            if localCopy != nil {
                Label("یک نسخه روی همین گوشی ذخیره است", systemImage: "iphone")
                    .font(.caption)
                    .foregroundColor(Theme.success)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    private func present(_ u: URL) {
        lastURL = u
        if isAudio { audioURL = u } else { quick = u }
    }

    /// اگر نسخه‌ی محلی هست همان (بدون اینترنت)، وگرنه از سرور
    private func open() async {
        if let l = localCopy {
            Haptic.light()
            present(LocalLibrary.shared.url(l))
            return
        }
        busyDownload = true
        let u = await m.download(item)
        busyDownload = false
        if let u = u { Haptic.success(); present(u) }
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
                Task { await open() }
            } label: {
                if busyDownload { ProgressView().tint(.white) }
                else { Label(openTitle, systemImage: isAudio ? "play.fill" : "square.and.arrow.down") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busyDownload)

            if isDeck && m.cfg.pdf {
                Button {
                    Task {
                        busyPdf = true
                        if let u = await m.download(item, pdf: true) { present(u) }
                        busyPdf = false
                    }
                } label: {
                    if busyPdf { ProgressView() } else { Label("دریافت PDF", systemImage: "doc.richtext") }
                }
                .buttonStyle(SoftButtonStyle())
                .disabled(busyPdf)
            }
            if let u = lastURL {
                HStack(spacing: 10) {
                    ShareLink(item: u) { Label("اشتراک‌گذاری", systemImage: "square.and.arrow.up") }
                        .buttonStyle(SoftButtonStyle())
                    Button { showExport = true } label: { Label("ذخیره در Files", systemImage: "folder.badge.plus") }
                        .buttonStyle(SoftButtonStyle())
                }
            }
            Text("فایل را در Files، PowerPoint، Keynote یا پیام‌رسان‌ها ذخیره یا ارسال کن.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 2)
        }
    }

    private var openTitle: String {
        switch kind {
        case .deck: return localCopy != nil ? "باز کردن PPTX" : "دریافت و باز کردن PPTX"
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
