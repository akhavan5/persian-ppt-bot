import SwiftUI

struct AccountView: View {
    @EnvironmentObject var m: AppModel
    @State private var showProfile = false
    @State private var showInvite = false
    @State private var showSupport = false
    @State private var showPrivacy = false
    @State private var confirmLogout = false
    @State private var buying: String?

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            ScrollView {
                if let me = m.me {
                    VStack(spacing: 16) {
                        profileCard(me)
                        creditCard(me)
                        if me.giftAvailable && me.giftCredits > 0 { giftCard(me) }
                        channelsSection(me)
                        plansSection(me).id("plans")
                        linksSection
                        Button(role: .destructive) { confirmLogout = true } label: {
                            Label("خروج از حساب", systemImage: "rectangle.portrait.and.arrow.right")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .padding(.top, 4)
                        Text("نسخه‌ی \(appVersion)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(16)
                } else {
                    ProgressView().padding(40)
                }
            }
            .onAppear {
                if m.isDemo && UserDefaults.standard.bool(forKey: "demoScroll") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        withAnimation { proxy.scrollTo("plans", anchor: .top) }
                    }
                }
            }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("حساب")
            .refreshable { await m.refreshMe() }
            .sheet(isPresented: $showProfile) { ProfileSheet().environmentObject(m) }
            .sheet(isPresented: $showInvite) { InviteSheet().environmentObject(m) }
            .sheet(isPresented: $showSupport) { SupportChatSheet().environmentObject(m) }
            .sheet(isPresented: $showPrivacy) {
                if let u = URL(string: Api.base + "/privacy") { SafariView(url: u).ignoresSafeArea() }
            }
            .sheet(isPresented: $m.needMobile) { ProfileSheet(startWithMobile: true).environmentObject(m) }
            .confirmationDialog("از حساب خارج می‌شوی؟", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("خروج", role: .destructive) { Task { await m.logout() } }
                Button("انصراف", role: .cancel) {}
            }
        }
    }

    private var appVersion: String {
        Fa.digits(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0")
    }

    // MARK: کارت‌ها

    private func profileCard(_ me: Me) -> some View {
        Button { showProfile = true } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(Theme.gradient).frame(width: 56, height: 56)
                    Text(String(me.displayName.prefix(1)))
                        .font(.title2.bold())
                        .foregroundColor(.white)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(me.name.isEmpty ? "نام خود را وارد کن" : me.name)
                        .font(.headline)
                        .foregroundColor(.primary)
                    if !me.mobile.isEmpty { Text(Fa.digits(me.mobile)).font(.subheadline).foregroundColor(.secondary) }
                    if !me.email.isEmpty { Text(me.email).font(.caption).foregroundColor(.secondary) }
                }
                Spacer()
                Image(systemName: "chevron.left").font(.footnote.weight(.semibold)).foregroundColor(Color(.tertiaryLabel))
            }
            .card()
        }
        .buttonStyle(.plain)
    }

    private func creditCard(_ me: Me) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("اعتبار من").font(.headline)
                Spacer()
                if let p = me.plans.first(where: { $0.id == me.planId }) {
                    Text("پلن \(p.name)")
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Theme.gradient)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(me.unlimited ? "∞" : me.credits.fa)
                    .font(.system(size: 44, weight: .bold))
                    .foregroundStyle(Theme.gradient)
                Text(me.unlimited ? "نامحدود" : "اعتبار")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            if me.planId != nil && me.planExp > 0 {
                Label("اعتبار پلن تا \(persianDate(me.planExp))", systemImage: "calendar")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
            if me.bonus > 0 {
                Label("\(me.bonus.fa) اعتبار هدیه", systemImage: "gift.fill")
                    .font(.footnote)
                    .foregroundColor(.orange)
            }
            if me.dailyFree && m.cfg.dailyFree > 0 {
                Label("اعتبار رایگان امروز آماده است", systemImage: "sun.max.fill")
                    .font(.footnote)
                    .foregroundColor(Theme.success)
            }
        }
        .card()
    }

    private func giftCard(_ me: Me) -> some View {
        Button { showProfile = true } label: {
            HStack(spacing: 12) {
                IconBadge(symbol: "gift.fill", color: .orange, size: 40)
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(me.giftCredits.fa) اعتبار هدیه بگیر")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(.primary)
                    Text(me.giftNote.isEmpty ? "با ثبت و تأیید شماره‌ی موبایل یا ایمیل در پروفایل" : me.giftNote)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
            }
            .card(padding: 14)
        }
        .buttonStyle(.plain)
    }

    private func plansSection(_ me: Me) -> some View {
        VStack(spacing: 12) {
            SectionHeader(title: "پلن‌ها")
            ForEach(me.plans) { p in
                let current = me.planId == p.id
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(p.name).font(.title3.bold())
                        if p.id == "pro" {
                            Text("به‌صرفه‌ترین")
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color.orange.opacity(0.15))
                                .foregroundColor(.orange)
                                .clipShape(Capsule())
                        }
                        Spacer()
                        Text(p.price.faGrouped).font(.title2.bold()).foregroundStyle(Theme.gradient)
                        Text("هزار تومان / ماه").font(.caption).foregroundColor(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        feature("\(p.credits.fa) اعتبار (ارائه) در ماه")
                        feature("تا \(p.maxSlides.fa) اسلاید در هر ارائه")
                        feature("تا \(p.maxImages.fa) تصویر در هر ارائه")
                        feature("مدل‌های ویژه‌ی هوش مصنوعی")
                        feature("بدون واترمارک • \(p.days.fa) روز اعتبار، بدون تمدید خودکار")
                    }
                    Button {
                        Task {
                            buying = p.id
                            await m.startPay(p)
                            buying = nil
                        }
                    } label: {
                        if buying == p.id { ProgressView().tint(.white) }
                        else { Text(current ? "تمدید پلن \(p.name)" : "خرید پلن \(p.name)") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(buying != nil)
                }
                .card()
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(current ? Theme.brand : Color.clear, lineWidth: 2)
                )
            }
            Text("پرداخت از درگاه امن انجام می‌شود و به‌صورت خودکار تمدید نمی‌شود.")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }

    private func feature(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.circle.fill").foregroundColor(Theme.success).font(.footnote).padding(.top, 2)
            Text(text).font(.subheadline)
        }
    }

    private static let iosStores: [(String, String)] = [
        ("سیبچه", "https://sibche.com/applications/paorpoyntsaz"), ("سیب ایرانی", "https://sibirani.com/apps/pptsaz-ir/"), ("سیب‌اپ", "https://sibapp.com/applications/pptsaz"),
        ("اناردونی", "https://anardoni.com/ios/app/irpptsazapp"), ("آی‌اپس", "https://iapps.ir/app/paorpoynt-saz-hosh-msnoaay/714593784191"), ("اپ‌استار", "https://app-star.store/app.php?id=pptsaz"),
    ]

    private func openURL(_ s: String) { if let u = URL(string: s) { UIApplication.shared.open(u) } }

    /// کارت یک پلتفرم: آیکن رنگی، نام، وضعیت، توضیح و دکمه‌ها
    private func platformCard<Actions: View>(_ icon: String, _ color: Color, _ name: String, status: String = "", ok: Bool = false, desc: String = "", @ViewBuilder actions: () -> Actions) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(icon).font(.system(size: 21)).frame(width: 42, height: 42)
                .background(color.opacity(0.16)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(name).font(.subheadline.weight(.bold))
                    Spacer()
                    if !status.isEmpty { Text(status).font(.caption2).foregroundColor(ok ? color : .secondary) }
                }
                if !desc.isEmpty { Text(desc).font(.caption).foregroundColor(.secondary) }
                actions()
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(ok ? color : Color(.separator), lineWidth: 1))
    }

    private func linkChip(_ title: String, _ color: Color, filled: Bool = false, _ url: String) -> some View {
        Button(title) { openURL(url) }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 12).padding(.vertical, 6)
            .foregroundColor(filled ? .white : color)
            .background(filled ? color : Color.clear)
            .overlay(Capsule().stroke(color, lineWidth: 1))
            .clipShape(Capsule())
    }

    /// اتصال پلتفرم‌ها: به ترتیب سایت، اندروید (بازار و مایکت)، بله، ایتا، اپل، سروش‌پلاس، تلگرام (روبیکا آخر)؛ اتصال فقط با تأیید شماره‌ی موبایل است
    @ViewBuilder
    private func channelsSection(_ me: Me) -> some View {
        let chans = Dictionary(uniqueKeysWithValues: me.channels.filter { $0.connected || $0.available }.map { ($0.key, $0) })
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "اتصال پلتفرم‌ها")
            Text("حسابت را به چند پلتفرم وصل کن؛ اعتبار و ارائه‌هایت همه‌جا یکی است و اعلان‌ها هم به همه‌ی آن‌ها می‌رسد.")
                .font(.footnote).foregroundColor(.secondary)
            platformCard("🌐", .blue, "سایت پاورپوینت‌ساز", desc: "ساخت پاورپوینت با هوش مصنوعی مستقیم در مرورگر، بدون نیاز به نصب برنامه.") {
                linkChip("pptsaz.ir", .blue, "https://pptsaz.ir")
            }
            platformCard("🤖", .green, "اپ اندروید", status: me.devApp ? "✅ وصل است" : "⬜ نصب نشده", ok: me.devApp,
                         desc: me.devApp ? "اپ روی گوشی‌ات وصل است." : "اپ را نصب کن و با همین شماره وارد شو.") {
                if !me.devApp {
                    HStack {
                        linkChip("دانلود از کافه‌بازار", .green, filled: true, "https://cafebazaar.ir/app/ir.pptsaz.app")
                        linkChip("دانلود از مایکت", .green, filled: true, "https://myket.ir/app/ir.pptsaz.app")
                    }
                }
            }
            ForEach(["bale", "eitaa", "apple", "splus", "tg"], id: \.self) { key in
                if key == "apple" {
                    platformCard("🍎", .gray, "اپ iOS (اپل)", status: "✅ همین برنامه", ok: true, desc: "همین حالا از اپ iOS استفاده می‌کنی.") {}
                } else if let c = chans[key] {
                    let color: Color = key == "bale" ? .green : key == "eitaa" ? .orange : key == "splus" ? .cyan : .blue
                    let icon = key == "bale" ? "💬" : key == "eitaa" ? "🟠" : key == "splus" ? "🔵" : "✈️"
                    let url = c.url.isEmpty ? (key == "tg" ? "https://t.me/pptsaz_bot" : "") : c.url
                    platformCard(icon, color, c.label,
                                 status: c.connected ? "✅ متصل" + (c.shown.isEmpty ? "" : " (\(Fa.digits(c.shown)))") : "⬜ وصل نیست", ok: c.connected,
                                 desc: c.connected ? "🔔 اعلان‌ها همیشه روشن است." : "ربات را باز کن و شماره‌ات را تأیید کن؛ همان لحظه وصل می‌شود.") {
                        HStack {
                            if !url.isEmpty { linkChip(c.connected ? "باز کردن \(c.label)" : "ورود به \(c.label) و تأیید شماره", color, filled: !c.connected, url) }
                        }
                    }
                }
            }
            Text("\(me.devWeb ? "✅" : "⬜") اعلان مرورگر · \(me.devEmail ? "✅" : "⬜") ایمیل")
                .font(.caption).foregroundColor(.secondary)
            Text(me.mobile.isEmpty
                 ? "اول شماره‌ی موبایلت را در کارت پروفایل ثبت کن؛ بعد در هر پلتفرم همان شماره را تأیید کن."
                 : "برای وصل‌کردن پلتفرم دیگر، در همان ربات این شماره (\(Fa.digits(me.mobile))) را تأیید کن.")
                .font(.footnote).foregroundColor(.secondary)
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var linksSection: some View {
        VStack(spacing: 0) {
            linkRow("gift.fill", .orange, "دعوت دوستان و اعتبار هدیه") { showInvite = true }
            Divider().padding(.leading, 56)
            linkRow("bubble.left.and.bubble.right.fill", Theme.brand, "پشتیبانی هوشمند") { showSupport = true }
            Divider().padding(.leading, 56)
            linkRow("paperplane.fill", .cyan, "ربات تلگرام پاورپوینت‌ساز") {
                if let u = URL(string: "https://t.me/pptsaz_bot") { UIApplication.shared.open(u) }
            }
            Divider().padding(.leading, 56)
            linkRow("lock.shield.fill", .gray, "شرایط استفاده و حریم خصوصی") { showPrivacy = true }
        }
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func linkRow(_ symbol: String, _ color: Color, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                IconBadge(symbol: symbol, color: color, size: 32)
                Text(title).foregroundColor(.primary)
                Spacer()
                Image(systemName: "chevron.left").font(.footnote.weight(.semibold)).foregroundColor(Color(.tertiaryLabel))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - پروفایل

struct ProfileSheet: View {
    @EnvironmentObject var m: AppModel
    @Environment(\.dismiss) private var dismiss
    var startWithMobile = false

    @State private var name = ""
    @State private var savingName = false
    @State private var kind = "mobile"
    @State private var value = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var busy = false
    @State private var message: String?
    @State private var isError = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("نام", text: $name)
                    Button {
                        Task {
                            savingName = true
                            if await m.updateName(name.trimmingCharacters(in: .whitespacesAndNewlines)) { Haptic.success(); m.toast("نام ذخیره شد.") }
                            savingName = false
                        }
                    } label: {
                        if savingName { ProgressView() } else { Text("ذخیره‌ی نام") }
                    }
                    .disabled(savingName || name.trimmingCharacters(in: .whitespaces).isEmpty)
                } header: {
                    Text("نام")
                }

                Section {
                    if let me = m.me {
                        if !me.mobile.isEmpty { LabeledContent("موبایل", value: Fa.digits(me.mobile)) }
                        if !me.email.isEmpty { LabeledContent("ایمیل", value: me.email) }
                    }
                } header: {
                    Text("اطلاعات ورود")
                }

                if !missing.isEmpty {
                    Section {
                        if missing.count > 1 {
                            Picker("نوع", selection: $kind) {
                                ForEach(missing, id: \.self) { Text($0 == "mobile" ? "موبایل" : "ایمیل").tag($0) }
                            }
                            .pickerStyle(.segmented)
                            .onChange(of: kind) { _ in codeSent = false; code = ""; message = nil }
                        }
                        TextField(kind == "mobile" ? "۰۹۱۲۳۴۵۶۷۸۹" : "name@example.com", text: $value)
                            .keyboardType(kind == "mobile" ? .phonePad : .emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .environment(\.layoutDirection, .leftToRight)
                            .disabled(codeSent)
                        if codeSent {
                            TextField("کد تأیید", text: $code)
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)
                                .environment(\.layoutDirection, .leftToRight)
                        }
                        Button {
                            Task { if codeSent { await verify() } else { await send() } }
                        } label: {
                            if busy { ProgressView() } else { Text(codeSent ? "تأیید و ثبت" : "ارسال کد") }
                        }
                        .disabled(busy || value.isEmpty || (codeSent && code.isEmpty))
                        if let msg = message {
                            Text(msg).font(.footnote).foregroundColor(isError ? .red : Theme.success)
                        }
                    } header: {
                        Text(kind == "mobile" ? "ثبت شماره‌ی موبایل" : "ثبت ایمیل")
                    } footer: {
                        if let me = m.me, me.giftAvailable, me.giftCredits > 0 {
                            Text("با تأیید، \(me.giftCredits.fa) اعتبار هدیه می‌گیری.")
                        }
                    }
                }
            }
            .navigationTitle("پروفایل")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("بستن") { dismiss() } }
            }
            .onAppear {
                name = m.me?.name ?? ""
                if startWithMobile || !missing.contains("email") { kind = "mobile" } else { kind = missing.first ?? "mobile" }
                if let first = missing.first, !missing.contains(kind) { kind = first }
            }
        }
    }

    /// موردهایی که هنوز روی حساب ثبت نشده و سرور ثبتشان را پشتیبانی می‌کند
    private var missing: [String] {
        guard let me = m.me else { return [] }
        if !me.giftMissing.isEmpty { return me.giftMissing.filter { $0 == "mobile" || $0 == "email" } }
        var r: [String] = []
        if me.mobile.isEmpty { r.append("mobile") }
        if me.email.isEmpty && m.cfg.emailOtp { r.append("email") }
        return r
    }

    private func normalized() -> String? {
        kind == "mobile" ? normalizeIranMobile(value) : normalizeEmail(value)
    }

    private func send() async {
        guard let v = normalized() else {
            message = kind == "mobile" ? "شماره‌ی موبایل معتبر وارد کن." : "ایمیل معتبر وارد کن."
            isError = true
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await Api.shared.contactSend(kind: kind, value: v)
            value = v
            codeSent = true
            message = "کد ارسال شد."
            isError = false
        } catch {
            message = (error as? ApiError)?.message ?? error.localizedDescription
            isError = true
        }
    }

    private func verify() async {
        guard let v = normalized() else { return }
        busy = true
        defer { busy = false }
        do {
            let reward = try await Api.shared.contactVerify(kind: kind, value: v, code: Fa.normalize(code))
            Haptic.success()
            await m.refreshMe()
            m.toast(reward > 0 ? "ثبت شد و \(reward.fa) اعتبار هدیه گرفتی 🎁" : "ثبت شد.")
            dismiss()
        } catch {
            message = (error as? ApiError)?.message ?? error.localizedDescription
            isError = true
        }
    }
}

// MARK: - دعوت دوستان

struct InviteSheet: View {
    @EnvironmentObject var m: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var info: InviteInfo?
    @State private var loading = true
    @State private var claim = ""
    @State private var claiming = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if loading {
                        ProgressView().padding(40)
                    } else if let i = info {
                        VStack(spacing: 12) {
                            IconBadge(symbol: "gift.fill", color: .orange, size: 56)
                            Text("به هر \(i.every.fa) دوستی که با لینک تو ثبت‌نام کند، اعتبار هدیه می‌گیری.")
                                .multilineTextAlignment(.center)
                                .font(.subheadline)
                            ProgressView(value: Double(min(i.count, i.max)), total: Double(max(i.max, 1)))
                            Text("\(i.count.fa) دعوت موفق از حداکثر \(i.max.fa)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            if let url = URL(string: i.link), !i.link.isEmpty {
                                ShareLink(item: url, message: Text("با پاورپوینت‌ساز فارسی در چند دقیقه ارائه بساز!")) {
                                    Label("اشتراک‌گذاری لینک دعوت", systemImage: "square.and.arrow.up")
                                }
                                .buttonStyle(PrimaryButtonStyle())
                                Text(i.link)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .environment(\.layoutDirection, .leftToRight)
                                    .textSelection(.enabled)
                            }
                        }
                        .card()
                        if i.canClaim {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("کد یا لینک دعوت دوستت را داری؟").font(.headline)
                                TextField("کد یا لینک دعوت", text: $claim)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .environment(\.layoutDirection, .leftToRight)
                                    .padding(12)
                                    .background(Color(.tertiarySystemGroupedBackground))
                                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                if let e = error { Text(e).font(.footnote).foregroundColor(.red) }
                                Button {
                                    Task { await submitClaim() }
                                } label: {
                                    if claiming { ProgressView() } else { Text("ثبت کد دعوت") }
                                }
                                .buttonStyle(SoftButtonStyle())
                                .disabled(claiming || claim.trimmingCharacters(in: .whitespaces).isEmpty)
                            }
                            .card()
                        }
                    } else {
                        EmptyStateView(symbol: "wifi.exclamationmark", title: "دریافت اطلاعات ممکن نشد")
                    }
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("دعوت دوستان")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("بستن") { dismiss() } } }
            .task { await load() }
        }
    }

    private func load() async {
        loading = true
        info = try? await Api.shared.invite()
        loading = false
    }

    private func submitClaim() async {
        claiming = true
        error = nil
        defer { claiming = false }
        do {
            try await Api.shared.inviteClaim(claim)
            Haptic.success()
            m.toast("کد دعوت ثبت شد 🎁")
            claim = ""
            await m.refreshMe()
            await load()
        } catch {
            self.error = (error as? ApiError)?.message ?? error.localizedDescription
        }
    }
}

// MARK: - گفتگوی پشتیبانی

struct SupportChatSheet: View {
    @EnvironmentObject var m: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var data = SupportData(msgs: [], remaining: 10, limit: 10)
    @State private var loading = true
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            bubble(fromUser: false, text: "سلام! من دستیار هوشمند پاورپوینت‌ساز هستم. درباره‌ی ساخت ارائه، اعتبار، پلن‌ها و مشکلات اپ بپرس.", flagged: false)
                            ForEach(data.msgs) { msg in
                                bubble(fromUser: msg.fromUser, text: msg.text, flagged: msg.flagged).id(msg.id)
                            }
                            if sending {
                                HStack { ProgressView(); Text("در حال نوشتن…").font(.caption).foregroundColor(.secondary); Spacer() }
                                    .padding(.horizontal, 4)
                                    .id("typing")
                            }
                        }
                        .padding(16)
                    }
                    .onChange(of: data.msgs.count) { _ in
                        if let last = data.msgs.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                    .onChange(of: sending) { s in
                        if s { withAnimation { proxy.scrollTo("typing", anchor: .bottom) } }
                    }
                }
                if let e = error {
                    Text(e).font(.footnote).foregroundColor(.red).padding(.horizontal, 16).padding(.top, 6)
                }
                inputBar
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("پشتیبانی")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("بستن") { dismiss() } } }
            .task { await load() }
        }
    }

    private var inputBar: some View {
        VStack(spacing: 6) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("پیامت را بنویس…", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color(.secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 34))
                        .foregroundStyle(canSend ? AnyShapeStyle(Theme.gradient) : AnyShapeStyle(Color.gray.opacity(0.5)))
                }
                .disabled(!canSend)
            }
            Text("\(data.remaining.fa) پیام از \(data.limit.fa) پیام امروز باقی مانده")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(12)
        .background(.bar)
    }

    private var canSend: Bool {
        !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && data.remaining > 0
    }

    private func bubble(fromUser: Bool, text: String, flagged: Bool) -> some View {
        HStack {
            if fromUser { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 4) {
                Text(text)
                    .font(.subheadline)
                    .foregroundColor(fromUser ? .white : .primary)
                if flagged {
                    Text("ارجاع‌شده به پشتیبان انسانی").font(.caption2).foregroundColor(fromUser ? .white.opacity(0.8) : .secondary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(fromUser ? AnyShapeStyle(Theme.gradient) : AnyShapeStyle(Color(.secondarySystemGroupedBackground)))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            if !fromUser { Spacer(minLength: 40) }
        }
    }

    private func load() async {
        loading = true
        if let d = try? await Api.shared.supportHistory() { data = d }
        loading = false
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = true
        error = nil
        draft = ""
        // پیام کاربر بلافاصله دیده شود؛ پاسخ سرور بعداً جایگزین می‌شود
        data.msgs.append(SupportMsg(fromUser: true, text: text, flagged: false))
        defer { sending = false }
        do {
            data = try await Api.shared.supportSend(text)
            Haptic.light()
        } catch {
            self.error = (error as? ApiError)?.message ?? error.localizedDescription
            if let d = try? await Api.shared.supportHistory() { data = d }
        }
    }
}
