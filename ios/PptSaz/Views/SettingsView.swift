import SwiftUI

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
                    } footer: {
                        Text("فونت‌های Vazirmatn و B Nazanin باید روی دستگاهی که ارائه را باز می‌کند نصب باشند؛ Tahoma و Arial همه‌جا کار می‌کنند.")
                    }

                    Section {
                        ForEach(modes) { mode in
                            Button {
                                Haptic.select()
                                m.setSetting("mode", mode.id)
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(mode.name).font(.body.weight(.medium)).foregroundColor(.primary)
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
                }
                .navigationTitle("تنظیمات")
            } else {
                ProgressView()
            }
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
