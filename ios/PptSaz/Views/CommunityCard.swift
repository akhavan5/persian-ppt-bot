import SwiftUI

/// آمار عمومی سرویس + اسلایدر نظرات کاربران (تب «حساب»). هر خطا ⇒ بخش نمایش داده نمی‌شود و صفحه سالم می‌ماند.
struct CommunityCard: View {
    struct Stat: Identifiable { let id: String; let emoji: String; let title: String; let value: Int }
    struct Review: Identifiable { let id: Int; let name: String; let src: String; let text: String; let stars: Int }

    /// آخرین دریافت؛ تا ۳۰ دقیقه با هر بار باز شدن تب «حساب» دوباره از سرور نمی‌گیریم
    private static var cache: (at: Date, stats: [Stat], reviews: [Review], avg: String, count: String, stores: [String])?

    @State private var stats: [Stat] = []
    @State private var reviews: [Review] = []
    @State private var avg = ""
    @State private var count = ""
    @State private var stores: [String] = []
    @State private var page = 0
    @State private var pausedUntil = Date.distantPast

    private let ticker = Timer.publish(every: 5, on: .main, in: .common).autoconnect()
    private let gold = Color(red: 0.96, green: 0.65, blue: 0.14)

    var body: some View {
        VStack(spacing: 16) {
            if !stats.isEmpty { statsSection }
            if !reviews.isEmpty { reviewsSection }
        }
        .task { await load() }
    }

    // MARK: آمار

    private var statsSection: some View {
        VStack(spacing: 8) {
            SectionHeader(title: "پاورپوینت‌ساز در یک نگاه")
            HStack(spacing: 10) {
                ForEach(stats) { s in
                    VStack(spacing: 2) {
                        Text(s.emoji).font(.title2)
                        Text(Self.nice(s.value)).font(.headline).foregroundColor(Theme.brand).lineLimit(1).minimumScaleFactor(0.7)
                        Text(s.title).font(.caption2).foregroundColor(.secondary).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .padding(.horizontal, 4)
                    .background(Color(.secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
            }
        }
    }

    /// مثل صفحه‌ی اصلی سایت: زیر هزار همان عدد، بالاتر صدگان گرد و «+»
    static func nice(_ n: Int) -> String {
        if n < 1000 { return n.faGrouped }
        if n < 1_000_000 { return (n / 100 * 100).faGrouped + "+" }
        let m = Double(n / 100_000) / 10
        return Fa.digits(String(m).replacingOccurrences(of: ".", with: "٫")) + " میلیون+"
    }

    // MARK: نظرات

    private var reviewsSection: some View {
        VStack(spacing: 8) {
            SectionHeader(title: "کاربران چه می‌گویند؟")
            VStack(alignment: .leading, spacing: 12) {
                if !avg.isEmpty {
                    HStack(spacing: 12) {
                        Text(Fa.digits(avg)).font(.system(size: 34, weight: .bold))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("★★★★★").font(.subheadline).foregroundColor(gold)
                            Text("از \(Fa.digits(count)) امتیاز کاربران").font(.caption).foregroundColor(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    if !stores.isEmpty {
                        HStack(spacing: 8) {
                            ForEach(stores, id: \.self) { t in
                                Text(Fa.digits(t)).font(.caption2.weight(.semibold)).padding(.horizontal, 10).padding(.vertical, 3)
                                    .background(Color(.tertiarySystemGroupedBackground)).clipShape(Capsule())
                            }
                        }
                    }
                }
                // اسلایدر واقعی: کشیدن با لمس در هر دو جهت (جهت راست‌به‌چپ از layoutDirection اپ گرفته می‌شود)
                TabView(selection: $page) {
                    ForEach(Array(reviews.enumerated()), id: \.offset) { i, r in
                        reviewCard(r).padding(.horizontal, 2).tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(height: 176)
                .simultaneousGesture(DragGesture(minimumDistance: 8).onChanged { _ in pausedUntil = Date().addingTimeInterval(8) })
                if reviews.count > 1 { navBar }
            }
            .card()
        }
        .onReceive(ticker) { _ in
            guard reviews.count > 1, Date() > pausedUntil else { return }
            go(page + 1)
        }
    }

    private func reviewCard(_ r: Review) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if r.stars > 0 {
                Text(String(repeating: "★", count: r.stars) + String(repeating: "☆", count: max(0, 5 - r.stars))).font(.footnote).foregroundColor(gold)
            }
            Text("«\(r.text)»").font(.subheadline).lineSpacing(5).lineLimit(5).frame(maxHeight: .infinity, alignment: .topLeading)
            HStack(spacing: 8) {
                Text(String(r.name.first ?? "ک")).font(.footnote.weight(.bold)).foregroundColor(.white)
                    .frame(width: 28, height: 28).background(Theme.gradient).clipShape(Circle())
                Text(r.name).font(.footnote.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 4)
                if !r.src.isEmpty {
                    Text(r.src).font(.caption2).foregroundColor(.secondary).lineLimit(1)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Color(.secondarySystemGroupedBackground)).clipShape(Capsule())
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.tertiarySystemGroupedBackground).opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var navBar: some View {
        HStack(spacing: 12) {
            // قبلی: سمت راست و فلش به راست؛ بعدی: سمت چپ و فلش به چپ (نمادهای right/left فیزیکی‌اند و در RTL آینه نمی‌شوند)
            navButton("chevron.right", "نظر قبلی") { pausedUntil = Date().addingTimeInterval(8); go(page - 1) }
            Spacer(minLength: 0)
            if reviews.count <= 12 {
                HStack(spacing: 6) {
                    ForEach(0..<reviews.count, id: \.self) { i in
                        Capsule().fill(i == page ? Theme.brand : Color(.tertiaryLabel).opacity(0.4))
                            .frame(width: i == page ? 18 : 7, height: 7)
                    }
                }
                .animation(.easeInOut(duration: 0.25), value: page)
            } else {
                Text("\((page + 1).fa) / \(reviews.count.fa)").font(.caption).foregroundColor(.secondary)
            }
            Spacer(minLength: 0)
            navButton("chevron.left", "نظر بعدی") { pausedUntil = Date().addingTimeInterval(8); go(page + 1) }
        }
    }

    private func navButton(_ symbol: String, _ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.subheadline.weight(.bold)).foregroundColor(Theme.brand)
                .frame(width: 38, height: 38).background(Color(.tertiarySystemGroupedBackground)).clipShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func go(_ i: Int) {
        guard !reviews.isEmpty else { return }
        let n = reviews.count
        withAnimation(.easeInOut(duration: 0.35)) { page = ((i % n) + n) % n }
    }

    // MARK: بارگذاری

    private func load() async {
        if let c = Self.cache {
            stats = c.stats; reviews = c.reviews; avg = c.avg; count = c.count; stores = c.stores
            if Date().timeIntervalSince(c.at) < 1800 { return }
        }
        if let j = try? await Api.shared.publicStats() {
            let all = [
                Stat(id: "users", emoji: "👥", title: "کاربر", value: j["users"].int),
                Stat(id: "decks", emoji: "📊", title: "ارائه ساخته‌شده", value: j["decks"].int),
                Stat(id: "plans", emoji: "👑", title: "پلن فعال‌شده", value: j["plans"].int),
            ]
            stats = all.filter { $0.value > 0 }
        }
        if let j = try? await Api.shared.publicReviews() {
            reviews = j["items"].arr.enumerated().compactMap { (i, o) -> Review? in
                let t = o["t"].str
                return t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil
                    : Review(id: i, name: o["n"].str.isEmpty ? "کاربر" : o["n"].str, src: o["s"].str, text: t, stars: min(5, max(0, o["r"].int)))
            }
            let r = j["rating"]
            avg = r["avg"].str
            count = r["count"].str
            stores = r["avg"].exists ? ["مایکت \(r["myket"].str)", "کافه‌بازار \(r["bazaar"].str)"] : []
        }
        if !stats.isEmpty || !reviews.isEmpty { Self.cache = (Date(), stats, reviews, avg, count, stores) }
    }
}
