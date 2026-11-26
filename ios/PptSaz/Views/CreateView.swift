import SwiftUI
import UserNotifications
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
    @State private var voiceBusy = false
    @StateObject private var recorder = VoiceRecorder()
    @FocusState private var topicFocused: Bool

    private let samples = ["هوش مصنوعی در آموزش", "برنامه‌ی بازاریابی دیجیتال", "اصول مدیریت زمان", "تغییرات اقلیمی و راه‌حل‌ها", "معرفی استارتاپ"]

    private var maxSlides: Int { m.me?.maxSlides ?? 6 }
    private var jobRunning: Bool { m.job?.running ?? false }
    private var canGenerate: Bool {
        topic.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 && !busy && !jobRunning
    }

    private var draft: DraftForm {
        DraftForm(topic: topic, source: source, sourceName: sourceName, handout: handout, poster: poster, audio: audio, podcast: podcast)
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
            .onAppear {
                applyDefaults()
                consumePending()
                if !m.pendingImports.isEmpty { showSource = true }
                recorder.onAutoStop = { Task { await finishVoice() } }
            }
            .onChange(of: m.pendingTopic) { _ in consumePending() }
            .onChange(of: m.pendingImports) { l in if !l.isEmpty { showSource = true } }
            .onChange(of: draft) { d in if didInit && !m.isDemo { Draft.save(d) } }
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
            HStack {
                Text("موضوع ارائه").font(.headline)
                Spacer()
                if m.cfg.voice { voiceButton }
            }
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

    /// ورودی صوتی: ضبط ← تبدیل به متن روی سرور (فقط وقتی سرور Deepgram دارد)
    @ViewBuilder
    private var voiceButton: some View {
        if voiceBusy {
            HStack(spacing: 6) { ProgressView(); Text("در حال تبدیل صدا…").font(.caption) }
        } else if recorder.recording {
            Button { Task { await finishVoice() } } label: {
                Label("پایان • \(clockText(Double(recorder.seconds)))", systemImage: "stop.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.red)
            }
        } else {
            Button {
                Task { if let e = await recorder.start() { m.toast(e); Haptic.error() } else { Haptic.light() } }
            } label: {
                Label("بگو", systemImage: "mic.fill").font(.subheadline.weight(.semibold))
            }
            .disabled(jobRunning)
        }
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
                    Label("افزودن متن، فایل، عکس، اسکن یا لینک", systemImage: "paperclip")
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
        slides = m.cfg.slideChoices.contains(me.settings.slides) && me.settings.slides <= me.maxSlides ? me.settings.slides : (m.cfg.slideChoices.filter { $0 <= me.maxSlides }.last ?? 6)
        images = me.settings.images
        imagesMany = me.settings.imagesMany
        if m.isDemo {
            if m.job == nil { topic = "اصول مدیریت زمان برای دانشجویان" }
        } else {
            // پیش‌نویس قبلی (اگر اپ وسط تایپ بسته شده بود)
            let d = Draft.load()
            topic = d.topic
            source = d.source
            sourceName = d.sourceName
            handout = d.handout
            poster = m.cfg.poster ? d.poster : ""
            audio = m.cfg.audio && d.audio
            podcast = m.cfg.audio && d.podcast
        }
        didInit = true
    }

    /// موضوعی که از اعلان، میان‌بر آیکن، Shortcuts یا لینک pptsaz://new آمده
    private func consumePending() {
        guard let t = m.pendingTopic else { return }
        m.pendingTopic = nil
        if !t.isEmpty { topic = t }
        topicFocused = true
    }

    private func finishVoice() async {
        guard recorder.recording else { return }
        guard let data = recorder.stop() else {
            m.toast("صدایی ضبط نشد؛ دوباره امتحان کن.")
            return
        }
        voiceBusy = true
        defer { voiceBusy = false }
        do {
            let t = try await Api.shared.extractText(data, mime: "audio/mp4")
            let text = t.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { m.toast("صدا تشخیص داده نشد؛ دوباره امتحان کن."); return }
            if topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.count <= 400 {
                topic = text
            } else {
                source = source.isEmpty ? text : source + "\n\n" + text
                if sourceName.isEmpty { sourceName = "متن صوتی" }
            }
            Haptic.success()
        } catch {
            m.report(error)
        }
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
            source = ""
            sourceName = ""
            Draft.clear()
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
                if m.notifyStatus == .denied {
                    Button {
                        Task { await m.enableNotifications() }
                    } label: {
                        Label("اعلان‌ها خاموش است؛ برای خبر گرفتن روشنشان کن", systemImage: "bell.slash")
                            .font(.caption.weight(.semibold))
                    }
                } else if m.notifyStatus == .authorized {
                    Text("آماده که شد اعلان می‌گیری (ممکن است iOS چند دقیقه دیرتر نشانش بدهد).")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
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
    @State private var names: [String] = []
    @State private var link = ""
    @State private var busy = false
    @State private var busyMsg = ""
    @State private var error: String?
    @State private var showImporter = false
    @State private var showScanner = false
    @State private var photoItems: [PhotosPickerItem] = []

    private let maxChars = 120_000

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button { showImporter = true } label: {
                        Label("انتخاب فایل (PDF، Word، PowerPoint، Excel، متن…)", systemImage: "doc.badge.plus")
                    }
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 5, matching: .images) {
                        Label("انتخاب عکس از گالری (استخراج متن)", systemImage: "photo")
                    }
                    if DocumentScanner.supported {
                        Button { showScanner = true } label: {
                            Label("اسکن کتاب یا برگه با دوربین", systemImage: "doc.viewfinder")
                        }
                    }
                    PasteButton(payloadType: String.self) { strings in
                        if let s = strings.first, !s.isEmpty { append(s, name: "متن چسبانده‌شده") }
                    }
                } header: {
                    Text("از فایل و دوربین")
                } footer: {
                    Text(m.cfg.voice ? "فایل صوتی (mp3، m4a، wav…) هم پشتیبانی می‌شود و به متن تبدیل می‌شود. چند فایل را می‌توانی با هم انتخاب کنی." : "چند فایل را می‌توانی با هم انتخاب کنی؛ متن همه پشت‌سرهم اضافه می‌شود.")
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
                        if t.isEmpty { sourceName = "" }
                        else if !names.isEmpty { sourceName = names.joined(separator: "، ") }
                        else if sourceName.isEmpty { sourceName = "متن منبع" }
                        dismiss()
                    }
                    .disabled(busy)
                }
            }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let urls) = result { Task { await importURLs(urls) } }
            }
            .fullScreenCover(isPresented: $showScanner) {
                DocumentScanner(onFinish: { pages in
                    showScanner = false
                    Task { await extractPages(pages) }
                }, onCancel: { showScanner = false })
                .ignoresSafeArea()
            }
            .onChange(of: photoItems) { items in
                guard !items.isEmpty else { return }
                Task { await handlePhotos(items) }
            }
            .onAppear {
                text = source
                let urls = m.takeImports()
                if !urls.isEmpty { Task { await importURLs(urls) } }
            }
        }
    }

    private func append(_ t: String, name: String) {
        let clean = t.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        let joined = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? clean : text.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n" + clean
        text = String(joined.prefix(maxChars))
        if !name.isEmpty { names.append(name) }
        error = nil
    }

    private func importURLs(_ urls: [URL]) async {
        busy = true
        error = nil
        defer { busy = false }
        var firstError: String?
        var added = false
        for (i, u) in urls.enumerated() {
            busyMsg = urls.count > 1 ? "فایل \((i + 1).fa) از \(urls.count.fa)…" : "در حال خواندن فایل…"
            do {
                let t = try await SourceImporter.read(url: u, voiceEnabled: m.cfg.voice) { s in busyMsg = s }
                append(t, name: u.lastPathComponent)
                added = true
            } catch {
                if firstError == nil { firstError = (error as? ApiError)?.message ?? error.localizedDescription }
            }
        }
        if let e = firstError { error = added ? "بعضی فایل‌ها خوانده نشد: \(e)" : e }
    }

    private func handlePhotos(_ items: [PhotosPickerItem]) async {
        defer { photoItems = [] }
        busy = true
        error = nil
        defer { busy = false }
        var firstError: String?
        for (i, item) in items.enumerated() {
            busyMsg = items.count > 1 ? "عکس \((i + 1).fa) از \(items.count.fa)…" : "در حال استخراج متن…"
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let jpg = ImageTools.normalizedJPEG(data) else {
                if firstError == nil { firstError = "خواندن عکس ممکن نشد." }
                continue
            }
            do {
                let t = try await Api.shared.extractText(jpg, mime: "image/jpeg")
                if t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { if firstError == nil { firstError = "متنی در عکس پیدا نشد." } }
                else { append(t, name: "عکس") }
            } catch {
                if firstError == nil { firstError = (error as? ApiError)?.message ?? error.localizedDescription }
            }
        }
        if let e = firstError { error = e }
    }

    private func extractPages(_ pages: [UIImage]) async {
        busy = true
        error = nil
        defer { busy = false }
        var firstError: String?
        for (i, img) in pages.enumerated() {
            busyMsg = "صفحه \((i + 1).fa) از \(pages.count.fa)…"
            guard let jpg = ImageTools.normalizedJPEG(img) else { continue }
            do {
                let t = try await Api.shared.extractText(jpg, mime: "image/jpeg")
                if !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { append(t, name: "اسکن") }
                else if firstError == nil { firstError = "متنی در یکی از صفحه‌ها پیدا نشد." }
            } catch {
                if firstError == nil { firstError = (error as? ApiError)?.message ?? error.localizedDescription }
            }
        }
        if let e = firstError { error = e }
    }

    private func fetchLink() async {
        busy = true
        busyMsg = "در حال گرفتن متن صفحه…"
        error = nil
        defer { busy = false }
        do {
            let t = try await Api.shared.linkSource(link.trimmingCharacters(in: .whitespaces))
            if t.isEmpty { error = "متنی از این لینک گرفته نشد." }
            else { append(t, name: link) }
        } catch {
            self.error = (error as? ApiError)?.message ?? error.localizedDescription
        }
    }
}
