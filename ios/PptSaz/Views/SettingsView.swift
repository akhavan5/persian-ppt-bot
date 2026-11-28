import SwiftUI
import UserNotifications

struct ModeInfo: Identifiable {
    let id: String
    let name: String
    let hint: String
}

private let modes: [ModeInfo] = [
    ModeInfo(id: "normal", name: "عادی", hint: "ساختار آزاد، متناسب با موضوع"),
    ModeInfo(id: "student", name: "دانشجویی", hint: "فهرست، مقدمه، بدنه، نتیجه‌گیری و منابع (حداقل ۸ اسلاید)"),
    ModeInfo(id: "business", name: "کسب‌وکار", hint: "خلاصه‌ی مدیریتی، مسئله و راه‌حل، جدول و نمودار، برنامه‌ی اجرا (حداقل ۸ اسلاید)"),
    ModeInfo(id: "teacher", name: "معلم", hint: "اهداف درس، پرسش آغازین، محتوا، فعالیت کلاسی و پرسش‌های مرور (حداقل ۸ اسلاید)"),
    ModeInfo(id: "thesis", name: "دفاع پایان‌نامه", hint: "مسئله، اهداف، پیشینه، روش، یافته‌ها، نتیجه‌گیری و منابع (حداقل ۱۰ اسلاید)")
]

struct SettingsView: View {
    @EnvironmentObject var m: AppModel
    @AppStorage(Pref.jobNotify) private var jobNotify = true
    @AppStorage(Pref.reminders) private var reminders = true
    @AppStorage(Pref.autoSave) private var autoSave = true
    @AppStorage(Pref.lock) private var lockOn = false
    @State private var confirmClear = false

    var body: some View {
        NavigationStack {
            if let s = m.me?.settings {
                Form {
                    Section {
                        NavigationLink {
                            TemplatePicker(selected: s.template)
                        } label: {
                            LabeledContent("قالب", value: m.cfg.templates.first { $0.key == s.template }?.name ?? "—")
                        }
                        VStack(alignment: .leading, spacing: 10) {
                            Text("تم رنگی").font(.subheadline)
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 12) {
                                    ForEach(m.cfg.themes) { t in
                                        swatch(t, selected: s.theme == t.key)
                                    }
                                }
                                .padding(.vertical, 4)
                            }
                        }
                        .padding(.vertical, 4)
                    } header: {
                        Text("ظاهر ارائه")
                    }

                    Section {
                        Picker("فونت", selection: Binding(get: { s.font }, set: { m.setSetting("font", $0) })) {
                            ForEach(m.cfg.fonts, id: \.self) { Text($0).tag($0) }
                        }
                        Picker("لحن", selection: Binding(get: { s.tone }, set: { m.setSetting("tone", $0) })) {
                            ForEach(m.cfg.tones) { Text($0.name).tag($0.key) }
                        }
                        Picker("زبان خروجی", selection: Binding(get: { s.lang }, set: { m.setSetting("lang", $0) })) {
                            Text("فارسی").tag("fa")
                            Text("English").tag("en")
                        }
                    } footer: {
                        Text("فونت‌های Vazirmatn و B Nazanin باید روی دستگاهی که ارائه را باز می‌کند نصب باشند؛ Tahoma و Arial همه‌جا کار می‌کنند.")
                    }

                    Section {
                        ForEach(modes) { mode in
                            // حالت‌های دارای حداقل اسلاید (همه به‌جز «عادی») فقط برای دارندگان پلن فعال‌اند
                            let modeLocked = mode.id != "normal" && !(m.me?.premium ?? false)
                            Button {
                                if modeLocked { m.upsell = "حالت \(mode.name) (دارای حداقل اسلاید) فقط برای کاربران دارای پلن پلاس یا پرو فعال است."; return }
                                Haptic.select()
                                m.setSetting("mode", mode.id)
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(modeLocked ? "\(mode.name) 🔒" : mode.name).font(.body.weight(.medium)).foregroundColor(modeLocked ? .secondary : .primary)
                                        Text(mode.hint).font(.caption).foregroundColor(.secondary).multilineTextAlignment(.leading)
                                    }
                                    Spacer()
                                    if s.mode == mode.id {
                                        Image(systemName: "checkmark.circle.fill").foregroundColor(Theme.brand)
                                    }
                                }
                            }
                        }
                    } header: {
                        Text("حالت ساخت")
                    }

                    Section {
                        Toggle("ارقام فارسی", isOn: Binding(get: { s.digits }, set: { m.setSetting("digits", $0) }))
                        Toggle("اسلاید منابع", isOn: Binding(get: { s.sources }, set: { m.setSetting("sources", $0) }))
                        Toggle("اسلاید پرسش‌های پایانی", isOn: Binding(get: { s.questions }, set: { m.setSetting("questions", $0) }))
                        Toggle("یادداشت سخنرانی", isOn: Binding(get: { s.notes }, set: { m.setSetting("notes", $0) }))
                        Toggle("تصویر در اسلایدها", isOn: Binding(get: { s.images }, set: { m.setSetting("images", $0) }))
                    } header: {
                        Text("گزینه‌ها")
                    }

                    if !m.cfg.models.isEmpty {
                        Section {
                            let canExtra = m.me?.premium ?? false
                            ForEach(m.cfg.models) { model in
                                let locked = !model.free && !canExtra
                                Button {
                                    if locked { m.upsell = "این مدل ویژه‌ی دارندگان پلن پلاس یا پرو است." }
                                    else { Haptic.select(); m.setSetting("model", model.id) }
                                } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(model.name).foregroundColor(locked ? .secondary : .primary)
                                            if !model.brand.isEmpty { Text(model.brand).font(.caption).foregroundColor(.secondary) }
                                        }
                                        Spacer()
                                        if locked { Image(systemName: "lock.fill").foregroundColor(.secondary) }
                                        else if s.model == model.id { Image(systemName: "checkmark.circle.fill").foregroundColor(Theme.brand) }
                                    }
                                }
                            }
                        } header: {
                            Text("مدل هوش مصنوعی")
                        }
                    }

                    notificationsSection
                    storageSection
                    securitySection
                }
                .navigationTitle("تنظیمات")
                .task { await m.refreshNotifyStatus(); m.refreshLibrary() }
                .confirmationDialog("همه‌ی فایل‌های ذخیره‌شده روی گوشی پاک شود؟", isPresented: $confirmClear, titleVisibility: .visible) {
                    Button("پاک کردن همه", role: .destructive) {
                        LocalLibrary.shared.removeAll()
                        m.refreshLibrary()
                        m.toast("فایل‌های ذخیره‌شده پاک شد.")
                    }
                    Button("انصراف", role: .cancel) {}
                }
            } else {
                ProgressView()
            }
        }
    }

    // MARK: اعلان‌ها، ذخیره‌سازی و امنیت

    private var notifyStatusText: String {
        switch m.notifyStatus {
        case .authorized, .provisional, .ephemeral: return "روشن"
        case .denied: return "خاموش (در تنظیمات iOS)"
        default: return "هنوز پرسیده نشده"
        }
    }

    private var notificationsSection: some View {
        Section {
            LabeledContent("اعلان‌های اپ", value: notifyStatusText)
            if m.notifyStatus == .notDetermined {
                Button("روشن کردن اعلان‌ها") { Task { await m.enableNotifications() } }
            } else if m.notifyStatus == .denied {
                Button("باز کردن تنظیمات iOS") { Notify.shared.openSystemSettings() }
            }
            Toggle("آماده شدن ارائه و فایل‌ها", isOn: $jobNotify)
            Toggle("یادآورهای هوشمند", isOn: $reminders)
                .onChange(of: reminders) { _ in ReminderCenter.shared.refresh() }
        } header: {
            Text("اعلان‌ها")
        } footer: {
            Text("اعلان‌ها محلی‌اند و از سرور خارجی نمی‌آیند. iOS اجازه نمی‌دهد اپ بسته‌شده بی‌وقفه کار کند، پس اگر اپ را کامل ببندی ممکن است اعلان «آماده شد» چند دقیقه دیرتر برسد؛ نتیجه همیشه در «فایل‌ها» هست. یادآورها فقط ساعت ۹ تا ۲۱ و حداکثر روزی یکی می‌آیند.")
        }
    }

    private var storageSection: some View {
        Section {
            Toggle("ذخیره‌ی خودکار روی گوشی", isOn: $autoSave)
            LabeledContent("ذخیره‌شده", value: "\(m.library.count.fa) فایل • \(formatBytes(m.library.reduce(0) { $0 + $1.size }))")
            if !m.library.isEmpty {
                Button("پاک کردن فایل‌های ذخیره‌شده", role: .destructive) { confirmClear = true }
            }
        } header: {
            Text("ذخیره‌سازی")
        } footer: {
            Text("فایل‌ها روی سرور فقط ۲۴ ساعت می‌مانند؛ با این گزینه یک نسخه (تا ۴۰ فایل اخیر) روی گوشی می‌ماند و در برنامه‌ی Files ← On My iPhone ← پاورپوینت‌ساز هم دیده می‌شود. با خروج از حساب این فایل‌ها پاک می‌شوند.")
        }
    }

    private var securitySection: some View {
        Section {
            Toggle("قفل اپ با \(AppLock.methodName())", isOn: Binding(
                get: { lockOn },
                set: { on in
                    if on && !AppLock.available() {
                        m.toast("برای قفل اپ، اول در تنظیمات iOS رمز گوشی بگذار.")
                        return
                    }
                    lockOn = on
                }
            ))
        } header: {
            Text("امنیت")
        } footer: {
            Text("با روشن بودن، هر بار که به اپ برمی‌گردی باید هویتت را تأیید کنی و محتوای اپ در نمای چندوظیفگی پنهان می‌شود.")
        }
    }

    private func swatch(_ t: Opt, selected: Bool) -> some View {
        Button {
            Haptic.select()
            m.setSetting("theme", t.key)
        } label: {
            VStack(spacing: 6) {
                ZStack {
                    Circle().fill(Color(hex: t.color ?? "#888888")).frame(width: 44, height: 44)
                    if selected { Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundColor(.white) }
                }
                .overlay(Circle().stroke(selected ? Theme.brand : Color.clear, lineWidth: 3).padding(-4))
                Text(t.name).font(.caption2).foregroundColor(.secondary).lineLimit(1)
            }
            .frame(width: 58)
        }
        .buttonStyle(.plain)
    }
}

struct TemplatePicker: View {
    @EnvironmentObject var m: AppModel
    @Environment(\.dismiss) private var dismiss
    let selected: String

    var body: some View {
        List(m.cfg.templates) { t in
            Button {
                Haptic.select()
                m.setSetting("template", t.key)
                dismiss()
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(t.name).font(.body.weight(.medium)).foregroundColor(.primary)
                        if !t.hint.isEmpty { Text(t.hint).font(.caption).foregroundColor(.secondary).multilineTextAlignment(.leading) }
                    }
                    Spacer()
                    if t.key == selected { Image(systemName: "checkmark.circle.fill").foregroundColor(Theme.brand) }
                }
            }
        }
        .navigationTitle("قالب")
        .navigationBarTitleDisplayMode(.inline)
    }
}
