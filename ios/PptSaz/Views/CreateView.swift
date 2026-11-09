import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct CreateView: View {
    @EnvironmentObject var m: AppModel
    @State private var topic = ""
    @State private var slides = 8
    @State private var handout = false
    @State private var poster = ""
    @State private var audio = false
    @State private var podcast = false
    @State private var images = true
    @State private var imagesMany = false
    @State private var source = ""
    @State private var sourceName = ""
    @State private var showSource = false
    @State private var busy = false
    @State private var didInit = false
    @FocusState private var topicFocused: Bool

    private let samples = ["هوش مصنوعی در آموزش", "برنامه‌ی بازاریابی دیجیتال", "اصول مدیریت زمان", "تغییرات اقلیمی و راه‌حل‌ها", "معرفی استارتاپ"]

    private var maxSlides: Int { m.me?.maxSlides ?? 8 }
    private var jobRunning: Bool { m.job?.running ?? false }
    private var canGenerate: Bool {
        topic.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 && !busy && !jobRunning
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    creditStrip
                    if let job = m.job { JobCard(job: job) }
                    topicCard
                    slidesCard
                    extrasCard
                    sourceCard
                    Button {
                        Task { await start() }
                    } label: {
                        if busy { ProgressView().tint(.white) }
                        else { Label("ساخت ارائه", systemImage: "sparkles") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!canGenerate)
                    .padding(.top, 4)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(.systemGroupedBackground))
            .navigationTitle("ساخت ارائه")
            .onAppear(perform: applyDefaults)
            .sheet(isPresented: $showSource) {
                SourceSheet(source: $source, sourceName: $sourceName).environmentObject(m)
            }
        }
    }

    // MARK: بخش‌ها

    private var creditStrip: some View {
        HStack(spacing: 12) {
            IconBadge(symbol: "bolt.fill", color: .orange, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                if let me = m.me {
                    Text(me.unlimited ? "اعتبار نامحدود" : "\(me.credits.fa) اعتبار")
                        .font(.headline)
                    Text(creditSubtitle(me))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            Spacer()
            Button("پلن‌ها") { m.selectedTab = 3 }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
        }
        .card(padding: 14)
    }

    private func creditSubtitle(_ me: Me) -> String {
        if me.unlimited { return "بدون محدودیت" }
        if me.planId != nil { return "هر ارائه ۱ اعتبار؛ هر همراه (جزوه، پوستر، صدا) ۱ اعتبار جدا" }
        if me.dailyFree { return "اعتبار رایگان امروز آماده است" }
        return "هر ارائه ۱ اعتبار"
    }

    private var topicCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("موضوع ارائه").font(.headline)
            TextField("مثلاً: مزایای کار تیمی در سازمان‌ها", text: $topic, axis: .vertical)
                .lineLimit(3...8)
                .focused($topicFocused)
                .padding(12)
                .background(Color(.tertiarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(samples, id: \.self) { s in
                        Button {
                            topic = s
                            Haptic.select()
                        } label: {
                            Text(s)
                                .font(.footnote)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(Theme.brand.opacity(0.10))
                                .foregroundColor(Theme.brand)
                                .clipShape(Capsule())
                        }
                    }
                }
            }
        }
        .card()
    }

    private var slidesCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("تعداد اسلاید").font(.headline)
                Spacer()
                Text("تا \(maxSlides.fa) اسلاید در پلن تو")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(m.cfg.slideChoices, id: \.self) { n in
                        Chip(text: n.fa, selected: slides == n, locked: n > maxSlides) {
                            if n > maxSlides {
                                m.upsell = "برای ساخت ارائه‌ی \(n.fa) اسلایدی به پلن پلاس یا پرو نیاز داری. پلن فعلی تا \(maxSlides.fa) اسلاید می‌سازد."
                            } else {
                                slides = n
                            }
                        }
                    }
                }
            }
        }
        .card()
    }

    private var extrasCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("گزینه‌ها").font(.headline).padding(.bottom, 6)
            optionToggle("تصویر در اسلایدها", "photo.on.rectangle.angled", .purple, "هوش مصنوعی تصویر مناسب پیدا می‌کند", $images)
            if images && (m.me?.premium ?? false) {
                Divider()
                optionToggle("تصویر بیشتر", "photo.stack", .indigo, "یک تصویر بیشتر در هر ارائه", $imagesMany)
            }
            Divider()
            optionToggle("جزوه‌ی Word", "doc.text", .blue, "+۱ اعتبار", $handout)
            if m.cfg.audio {
                Divider()
                optionToggle("اسلاید صوتی", "waveform", .pink, "روایت صوتی هر اسلاید • +۱ اعتبار", $audio)
                Divider()
                optionToggle("پادکست دو نفره", "mic.fill", .red, "گفتگوی دو میزبان درباره‌ی موضوع • +۱ اعتبار", $podcast)
            }
            if m.cfg.poster {
                Divider()
                HStack(spacing: 12) {
                    IconBadge(symbol: "photo.artframe", color: .teal, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("پوستر").font(.subheadline.weight(.medium))
                        Text("اینفوگرافیک خلاصه • +۱ اعتبار").font(.caption).foregroundColor(.secondary)
                    }
                    Spacer()
                    Picker("پوستر", selection: $poster) {
                        Text("ندارد").tag("")
                        Text("افقی").tag("wide")
                        Text("عمودی").tag("tall")
                    }
                    .pickerStyle(.menu)
                }
                .padding(.vertical, 4)
            }
        }
        .card()
    }

    private func optionToggle(_ title: String, _ symbol: String, _ color: Color, _ sub: String, _ binding: Binding<Bool>) -> some View {
        Toggle(isOn: binding) {
            HStack(spacing: 12) {
                IconBadge(symbol: symbol, color: color, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.medium))
                    Text(sub).font(.caption).foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var sourceCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("منبع (اختیاری)").font(.headline)
                Spacer()
            }
            if source.isEmpty {
                Button {
                    showSource = true
                } label: {
                    Label("افزودن متن، PDF، عکس یا لینک", systemImage: "paperclip")
                }
                .buttonStyle(SoftButtonStyle())
            } else {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.seal.fill").foregroundColor(Theme.success)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(sourceName.isEmpty ? "متن منبع" : sourceName).font(.subheadline.weight(.medium)).lineLimit(1)
                        Text("\(source.count.fa) نویسه").font(.caption).foregroundColor(.secondary)
                    }
                    Spacer()
                    Button("ویرایش") { showSource = true }.font(.footnote)
                    Button(role: .destructive) {
                        source = ""
                        sourceName = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
                    }
                }
            }
            Text("ارائه از روی همین متن ساخته می‌شود، نه از دانش عمومی هوش مصنوعی.")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .card()
    }

    // MARK: منطق

    private func applyDefaults() {
        guard !didInit, let me = m.me else { return }
        didInit = true
        slides = m.cfg.slideChoices.contains(me.settings.slides) && me.settings.slides <= me.maxSlides ? me.settings.slides : (m.cfg.slideChoices.filter { $0 <= me.maxSlides }.last ?? 8)
        images = me.settings.images
        imagesMany = me.settings.imagesMany
    }

    private func start() async {
        topicFocused = false
        busy = true
        defer { busy = false }
        let ok = await m.generate(
            topic: topic.trimmingCharacters(in: .whitespacesAndNewlines),
            slides: slides, handout: handout, source: source,
            poster: poster.isEmpty ? nil : poster,
            images: images, imagesMany: imagesMany, audio: audio, podcast: podcast
        )
        if ok {
            topic = ""
            handout = false
            poster = ""
            audio = false
            podcast = false
        }
    }
}

// MARK: - کارت پیشرفت ساخت

struct JobCard: View {
    @EnvironmentObject var m: AppModel
    let job: JobState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if job.failed {
                Label("ساخت ناموفق بود", systemImage: "exclamationmark.triangle.fill")
                    .font(.headline)
                    .foregroundColor(.red)
                Text(job.message).font(.subheadline).foregroundColor(.secondary)
                Button("بستن") { m.job = nil }.buttonStyle(SoftButtonStyle())
            } else if job.done {
                Label("ارائه آماده شد", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundColor(Theme.success)
                if !job.title.isEmpty { Text(job.title).font(.subheadline.weight(.medium)) }
                if job.audioWaiting || job.podcastWaiting {
                    Label("فایل صوتی در حال ساخت است؛ بعداً در «فایل‌ها» می‌آید.", systemImage: "hourglass")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                if job.posterFailed || job.audioFailed || job.podcastFailed {
                    Label("ساخت یکی از همراه‌ها ناموفق بود و اعتبارش برگشت.", systemImage: "info.circle")
                        .font(.caption)
                        .foregroundColor(.orange)
                }
                HStack(spacing: 10) {
                    Button("مشاهده در فایل‌ها") { m.selectedTab = 1; m.dismissJob() }.buttonStyle(PrimaryButtonStyle())
                    Button("بستن") { m.dismissJob() }.buttonStyle(SoftButtonStyle()).frame(width: 90)
                }
            } else {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("در حال ساخت ارائه").font(.headline)
                }
                if job.pct >= 0 {
                    ProgressView(value: Double(job.pct), total: 100)
                }
                Text(job.message).font(.subheadline).foregroundColor(.secondary)
                Text("می‌توانی از اپ بیرون بروی؛ ساخت روی سرور ادامه دارد.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .card()
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(job.failed ? Color.red.opacity(0.4) : (job.done ? Theme.success.opacity(0.4) : Theme.brand.opacity(0.35)), lineWidth: 1.5)
        )
    }
}

// MARK: - افزودن منبع

struct SourceSheet: View {
    @EnvironmentObject var m: AppModel
    @Environment(\.dismiss) private var dismiss
    @Binding var source: String
    @Binding var sourceName: String

    @State private var text = ""
    @State private var link = ""
    @State private var busy = false
    @State private var busyMsg = ""
    @State private var error: String?
    @State private var showImporter = false
    @State private var photoItem: PhotosPickerItem?

    private let maxChars = 120_000

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button { showImporter = true } label: {
                        Label("انتخاب فایل (PDF یا متن)", systemImage: "doc.badge.plus")
                    }
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label("انتخاب عکس از گالری (استخراج متن)", systemImage: "photo")
                    }
                } header: {
                    Text("از فایل")
                }
                if m.cfg.link {
                    Section {
                        TextField("https://…", text: $link)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .environment(\.layoutDirection, .leftToRight)
                        Button("گرفتن متن صفحه") { Task { await fetchLink() } }
                            .disabled(link.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                    } header: {
                        Text("از لینک")
                    }
                }
                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 160)
                    Text("\(text.count.fa) از \(maxChars.fa) نویسه")
                        .font(.caption)
                        .foregroundColor(.secondary)
                } header: {
                    Text("متن منبع")
                }
                if busy {
                    Section {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text(busyMsg).font(.subheadline)
                        }
                    }
                }
                if let e = error {
                    Section { Text(e).foregroundColor(.red).font(.footnote) }
                }
            }
            .navigationTitle("منبع ارائه")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("انصراف") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("تأیید") {
                        let t = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxChars))
                        source = t
                        if t.isEmpty { sourceName = "" } else if sourceName.isEmpty { sourceName = "متن منبع" }
                        dismiss()
                    }
                    .disabled(busy)
                }
            }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.pdf, .plainText, .text, .image]) { result in
                Task { await handleFile(result) }
            }
            .onChange(of: photoItem) { item in
                guard let item = item else { return }
                Task { await handlePhoto(item) }
            }
            .onAppear {
                text = source
            }
        }
    }

    private func setText(_ t: String, name: String) {
        text = String(t.prefix(maxChars))
        sourceName = name
        error = nil
    }

    private func handleFile(_ result: Result<[URL], Error>) async {
        guard case .success(let urls) = result, let url = urls.first else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            error = "خواندن فایل ممکن نشد."
            return
        }
        let ext = url.pathExtension.lowercased()
        if ext == "txt" || ext == "md" || ext == "text" {
            let t = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
            setText(t, name: url.lastPathComponent)
            return
        }
        if ext == "pdf" {
            await extract(data, mime: "application/pdf", name: url.lastPathComponent)
        } else if let img = UIImage(data: data), let jpg = img.jpegData(compressionQuality: 0.85) {
            await extract(jpg, mime: "image/jpeg", name: url.lastPathComponent)
        } else {
            error = "این نوع فایل پشتیبانی نمی‌شود؛ PDF، عکس یا متن انتخاب کن."
        }
    }

    private func handlePhoto(_ item: PhotosPickerItem) async {
        defer { photoItem = nil }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let img = UIImage(data: data), let jpg = img.jpegData(compressionQuality: 0.85) else {
            error = "خواندن عکس ممکن نشد."
            return
        }
        await extract(jpg, mime: "image/jpeg", name: "عکس")
    }

    private func extract(_ data: Data, mime: String, name: String) async {
        if data.count > 15_000_000 { error = "حجم فایل زیاد است؛ فایل کوچک‌تری انتخاب کن."; return }
        busy = true
        busyMsg = "در حال استخراج متن…"
        error = nil
        defer { busy = false }
        do {
            let t = try await Api.shared.extractText(data, mime: mime)
            if t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { error = "متنی در فایل پیدا نشد." }
            else { setText(t, name: name) }
        } catch {
            self.error = (error as? ApiError)?.message ?? error.localizedDescription
        }
    }

    private func fetchLink() async {
        busy = true
        busyMsg = "در حال گرفتن متن صفحه…"
        error = nil
        defer { busy = false }
        do {
            let t = try await Api.shared.linkSource(link.trimmingCharacters(in: .whitespaces))
            if t.isEmpty { error = "متنی از این لینک گرفته نشد." }
            else { setText(t, name: link) }
        } catch {
            self.error = (error as? ApiError)?.message ?? error.localizedDescription
        }
    }
}
