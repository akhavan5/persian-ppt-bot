import SwiftUI

struct LoginView: View {
    @EnvironmentObject var m: AppModel
    @State private var id = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var busy = false
    @State private var error: String?
    @State private var cooldown = 0
    @FocusState private var focused: Bool

    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                form
                    .padding(.horizontal, 20)
                    .offset(y: -28)
            }
        }
        .background(Color(.systemGroupedBackground))
        .ignoresSafeArea(edges: .top)
        .scrollDismissesKeyboard(.interactively)
        .onReceive(ticker) { _ in if cooldown > 0 { cooldown -= 1 } }
    }

    private var hero: some View {
        ZStack(alignment: .bottom) {
            Theme.gradient
            VStack(spacing: 14) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .shadow(color: .black.opacity(0.25), radius: 14, y: 6)
                Text("پاورپوینت‌ساز فارسی")
                    .font(.title.bold())
                    .foregroundColor(.white)
                Text("موضوع را بنویس، ارائه‌ی آماده را بگیر")
                    .font(.subheadline)
                    .foregroundColor(.white.opacity(0.9))
            }
            .padding(.top, 90)
            .padding(.bottom, 64)
        }
        .frame(maxWidth: .infinity)
        .clipShape(RoundedCorner(radius: 36, corners: [.bottomLeft, .bottomRight]))
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(codeSent ? "کد تأیید را وارد کن" : "ورود یا ثبت‌نام")
                .font(.title3.bold())
            Text(codeSent
                 ? "کد برای \(Fa.digits(id)) ارسال شد."
                 : (m.cfg.emailOtp ? "شماره‌ی موبایل یا ایمیلت را وارد کن؛ کد تأیید برایت می‌فرستیم." : "شماره‌ی موبایلت را وارد کن؛ کد تأیید را با پیامک می‌فرستیم."))
                .font(.subheadline)
                .foregroundColor(.secondary)

            if !m.cfg.otp {
                Text("ورود با کد در حال حاضر غیرفعال است.")
                    .font(.footnote)
                    .foregroundColor(.orange)
            }

            if codeSent {
                TextField("— — — — — —", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .font(.system(size: 28, weight: .semibold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .environment(\.layoutDirection, .leftToRight)
                    .padding(14)
                    .background(Color(.tertiarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .focused($focused)
                    .onChange(of: code) { v in
                        let n = Fa.normalize(v).filter { $0 >= "0" && $0 <= "9" }
                        if n != v { code = String(n) }
                        if n.count >= 6 && !busy { Task { await verify() } }
                    }
            } else {
                TextField(m.cfg.emailOtp ? "۰۹۱۲۳۴۵۶۷۸۹ یا name@example.com" : "۰۹۱۲۳۴۵۶۷۸۹", text: $id)
                    .keyboardType(m.cfg.emailOtp ? .emailAddress : .phonePad)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.title3)
                    .environment(\.layoutDirection, .leftToRight)
                    .multilineTextAlignment(.leading)
                    .padding(14)
                    .background(Color(.tertiarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .focused($focused)
                    .submitLabel(.go)
                    .onSubmit { Task { await send() } }
            }

            if let e = error {
                Label(e, systemImage: "exclamationmark.circle.fill")
                    .font(.footnote)
                    .foregroundColor(.red)
            }

            Button {
                Task {
                    if codeSent { await verify() } else { await send() }
                }
            } label: {
                if busy { ProgressView().tint(.white) } else { Text(codeSent ? "ورود" : "دریافت کد") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || (codeSent ? code.count < 4 : id.trimmingCharacters(in: .whitespaces).isEmpty))

            if codeSent {
                HStack {
                    Button("ویرایش شماره") { codeSent = false; code = ""; error = nil }
                    Spacer()
                    Button(cooldown > 0 ? "ارسال دوباره (\(cooldown.fa))" : "ارسال دوباره") { Task { await send() } }
                        .disabled(cooldown > 0 || busy)
                }
                .font(.footnote)
            }

            Text("با ورود، شرایط استفاده و حریم خصوصی را می‌پذیری.")
                .font(.caption)
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 4)
        }
        .card(padding: 20)
        .shadow(color: .black.opacity(0.06), radius: 16, y: 6)
    }

    private func send() async {
        guard let norm = normalizeLoginId(id), m.cfg.emailOtp || !norm.contains("@") else {
            error = m.cfg.emailOtp ? "شماره‌ی موبایل یا ایمیل معتبر وارد کن." : "شماره‌ی موبایل معتبر وارد کن؛ مثل ۰۹۱۲۳۴۵۶۷۸۹."
            Haptic.error()
            return
        }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await Api.shared.otpSend(norm)
            id = norm
            codeSent = true
            cooldown = 60
            code = ""
            focused = true
        } catch {
            self.error = (error as? ApiError)?.message ?? error.localizedDescription
            Haptic.error()
        }
    }

    private func verify() async {
        guard let norm = normalizeLoginId(id) else { return }
        let c = Fa.normalize(code)
        guard c.count >= 4 else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await Api.shared.otpVerify(norm, code: c)
            Haptic.success()
            await m.loginSucceeded()
        } catch {
            self.error = (error as? ApiError)?.message ?? error.localizedDescription
            Haptic.error()
        }
    }
}

/// گوشه‌های گرد انتخابی (برای هدر ورود)
struct RoundedCorner: Shape {
    var radius: CGFloat
    var corners: UIRectCorner
    func path(in rect: CGRect) -> Path {
        let p = UIBezierPath(roundedRect: rect, byRoundingCorners: corners, cornerRadii: CGSize(width: radius, height: radius))
        return Path(p.cgPath)
    }
}
