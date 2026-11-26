import Foundation

// MARK: - زمان تهران

enum Tehran {
    /// UTC+3:30 (ایران ساعت تابستانی ندارد)
    static let offset: Double = 12_600_000
    static let hour: Double = 3_600_000
    static let day: Double = 86_400_000

    static func dayStart(_ t: Double) -> Double { floor((t + offset) / day) * day - offset }

    static func hourOf(_ t: Double) -> Int {
        let r = (t + offset).truncatingRemainder(dividingBy: day)
        return Int(r / hour)
    }

    /// اگر t بیرون از ۹ تا ۲۱ تهران است، به اولین ساعت ۱۰ بعدی می‌برد
    static func snap(_ t: Double) -> Double {
        let h = hourOf(t)
        if h < 9 { return dayStart(t) + 10 * hour }
        if h >= 21 { return dayStart(t) + day + 10 * hour }
        return t
    }

    /// اولین ساعت ۱۰ صبح تهران که از t کمتر نباشد
    static func next10(_ t: Double) -> Double {
        let d = dayStart(t) + 10 * hour
        return d >= t ? d : d + day
    }
}

// MARK: - مدل

struct ReminderLog: Codable, Equatable {
    var t: Double
    var kind: String
}

struct PlannedReminder: Codable, Equatable {
    var kind: String
    var key: String
    var at: Double
    var title: String
    var body: String
    var tab: Int
    var topic: String?
    var url: String?
}

/// عکس لحظه‌ای وضعیت حساب برای تصمیم‌گیری یادآورها
struct ReminderState: Codable {
    var signedIn = false
    var firstSeen: Double = 0
    var lastOpen: Double = 0
    var decks = 0
    var credits = 0
    var unlimited = false
    var planId = ""
    var planName = ""
    var planExp: Double = 0
    var planCredits = 0
    var everPlan = false
    var planOutExp: Double = 0
    var planOutAt: Double = 0
    var dailyFreeOn = false
    var deckDoneAt: Double = 0
    var extraMadeAt: Double = 0
    var gift = false
    var giftCredits = 0
    var giftMissing: [String] = []
    var lowFor: Double = 0
    var lowAt: Double = 0
    var lowDeadline: Double = 0
    var legacyBuy48At: Double = 0
    var sent: [String] = []
    var log: [ReminderLog] = []
    var pending: [PlannedReminder] = []
}

// MARK: - برنامه‌ریز (تابع خالص؛ قابل آزمون)

/// قواعد همان نسخه‌ی اندروید است: ساعت ۹ تا ۲۱ تهران؛ حداکثر ۱ در روز و ۳ در هفته؛ «بازگشت» حداکثر ۲ بار در ماه؛
/// هر یادآور برای هر کلید فقط یک‌بار. تفاوت با اندروید: در iOS شرط‌ها هنگام زمان‌بندی (هر بار باز شدن اپ و هر بار رویداد) سنجیده می‌شود،
/// چون هنگام نمایش اعلان هیچ کدی اجرا نمی‌شود؛ پس فهرست هر بار از نو ساخته و جایگزین می‌شود.
enum ReminderPlanner {
    static let sampleTopics = [
        "فتوسنتز و نقش آن در حیات", "هوش مصنوعی در پزشکی", "تاریخ ایران باستان", "اصول مدیریت زمان", "تغییرات اقلیمی و راه‌حل‌ها"
    ]
    static let supportURL = "https://pptsaz.ir/support?utm_source=app&utm_medium=local&utm_campaign=coffee"

    static func topic(at t: Double) -> String {
        sampleTopics[max(0, Int(t / Tehran.day)) % sampleTopics.count]
    }

    private static func fa(_ n: Int) -> String { Fa.digits(String(n)) }

    static func seasonalIdea(at t: Double) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 12_600) ?? .current
        let d = Date(timeIntervalSince1970: t / 1000)
        let md = cal.component(.month, from: d) * 100 + cal.component(.day, from: d)
        switch md {
        case 923...1116: return "ترم تازه شروع شده؛ ارائه‌ی کلاسی‌ت رو توی چند دقیقه آماده کن."
        case 1117...1205: return "هفته‌ی پژوهش نزدیکه؛ ارائه‌ی طرح یا مقاله‌ت رو با هوش مصنوعی بساز."
        case 421...722: return "فصل دفاع پایان‌نامه‌ست؛ ارائه‌ی دفاعت رو توی چند دقیقه بساز."
        case 219...420: return "قبل از شلوغی پایان سال، ارائه‌ها و پروژه‌های عقب‌مونده‌ت رو سریع جمع کن."
        case 1206...1231, 101...218: return "امتحان‌ها نزدیکه؛ خلاصه‌ی درس‌هات رو به اسلاید تبدیل کن تا مرورش راحت‌تر بشه."
        default: return "ترم جدید نزدیکه؛ از الان ارائه‌ی جلسه‌ی اولت رو آماده کن."
        }
    }

    static func plan(_ s: ReminderState, now: Double) -> [PlannedReminder] {
        let D = Tehran.day, H = Tehran.hour
        var cands: [(r: PlannedReminder, deadline: Double)] = []

        func add(_ kind: String, key: String = "once", at: Double, deadline: Double, title: String, body: String,
                 tab: Int, topic: String? = nil, url: String? = nil) {
            if s.sent.contains("\(kind)|\(key)") { return }
            let t = Tehran.snap(max(at, now + 120_000))
            if deadline > 0 && t >= deadline { return }
            cands.append((PlannedReminder(kind: kind, key: key, at: t, title: title, body: body, tab: tab, topic: topic, url: url), deadline))
        }

        guard s.signedIn else { return [] }
        let planActive = !s.planId.isEmpty && s.planExp > now
        let first = s.firstSeen > 0 ? s.firstSeen : now
        let done = s.deckDoneAt

        // فعال‌سازی: هنوز ارائه‌ای نساخته
        if s.decks == 0 && !s.unlimited {
            if first + D > now {
                add("act1", key: "once", at: first + D, deadline: first + 4 * D,
                    title: s.credits > 0 ? "🎁 \(fa(s.credits)) ارائه‌ی رایگان منتظر توست" : "🎁 اولین ارائه‌ات منتظر توست",
                    body: "یه موضوع بنویس تا هوش مصنوعی در چند دقیقه همه‌ی اسلایدها رو برات آماده کنه.", tab: 0)
            }
            if first + 5 * D > now {
                let t = Tehran.snap(first + 5 * D)
                let tp = topic(at: t)
                add("act2", key: "once", at: first + 5 * D, deadline: first + 8 * D,
                    title: "یه ایده برای شروع ✨", body: "امتحانش کن: «\(tp)» — فقط بزن روش تا آماده‌ی ساخت بشه.", tab: 0, topic: tp)
            }
        }

        // اعتبار رایگان روزانه
        if !s.unlimited && s.credits == 0 && s.dailyFreeOn {
            let boundary = (floor(now / D) + 1) * D // نیمه‌شب UTC = ۰۳:۳۰ تهران؛ ریست سهم روزانه‌ی سرور
            let t = Tehran.next10(boundary)
            add("daily", key: String(Int(Tehran.dayStart(t))), at: t, deadline: t + 2 * D,
                title: "🎁 اعتبار رایگان امروزت آماده‌ست", body: "بیا یه ارائه‌ی تازه بساز؛ فقط چند دقیقه طول می‌کشه.", tab: 0)
        }

        // انقضای پلن
        if planActive && s.planCredits > 0 {
            let name = s.planName.isEmpty ? "ویژه" : s.planName
            let body = "\(fa(s.planCredits)) اعتبار هنوز مونده؛ ازش استفاده کن یا پلن رو تمدید کن (اعتبار جدید روی باقی‌مانده جمع می‌شه)."
            let t3 = Tehran.snap(s.planExp - 3 * D)
            let t1 = Tehran.snap(s.planExp - D)
            if t3 > now && t3 < s.planExp {
                add("plan3", key: String(Int(s.planExp)), at: t3, deadline: s.planExp, title: "⏳ پلن \(name) ۳ روز دیگه تموم می‌شه", body: body, tab: 3)
            }
            if t1 > now && t1 < s.planExp {
                add("plan1", key: String(Int(s.planExp)), at: t1, deadline: s.planExp, title: "⏳ پلن \(name) فردا تموم می‌شه", body: body, tab: 3)
            }
        } else if !planActive && s.planOutAt > 0 && s.planOutExp > now && s.planOutAt < s.planOutExp {
            let days = max(1, Int(ceil((s.planOutExp - now) / D)))
            add("planout", key: String(Int(s.planOutExp)), at: s.planOutAt, deadline: s.planOutExp,
                title: "اعتبار پلنت تموم شد", body: "\(fa(days)) روز از مدت پلنت مونده؛ با تمدید، ۳۰ روز تازه با اعتبار جدید می‌گیری.", tab: 3)
        }

        // کم‌شدن اعتبار پلن
        if planActive && s.planCredits == 1 && s.lowAt > 0 && s.lowDeadline > now && s.planExp - s.lowAt > 2 * D {
            let name = s.planName.isEmpty ? "ویژه" : s.planName
            let days = max(1, Int(ceil((s.planExp - now) / D)))
            add("low", key: String(Int(s.planExp)), at: s.lowAt, deadline: s.lowDeadline,
                title: "فقط ۱ اعتبار از پلنت مونده", body: "پلن \(name) تا \(fa(days)) روز دیگه فعاله؛ برای ادامه تمدیدش کن.", tab: 3)
        }

        // بعد از ساخت ارائه
        if s.decks >= 1 && done > 0 {
            if s.extraMadeAt < done {
                let t = Tehran.snap(done + 30 * H)
                add("extras", key: String(Int(done)), at: t, deadline: t + 3 * D,
                    title: "ارائه‌ات رو کامل‌تر کن 📝",
                    body: "برای ارائه‌ی اخیرت جزوه‌ی Word، پوستر یا پادکست هم بساز؛ هرکدام ۱ اعتبار جدا.", tab: 1)
            }
            // فایل‌ها ۲۴ ساعت می‌مانند؛ اگر بعد از ساخت اپ را دوباره باز نکرده یادآوری می‌کنیم
            if s.lastOpen - done < 30 * 60_000 {
                add("files1", key: String(Int(done)), at: done + H, deadline: done + 20 * H,
                    title: "فایل ارائه‌ات آماده‌ی دانلوده 📂",
                    body: "فایل‌های ساخته‌شده ۲۴ ساعت می‌مونن؛ اگه هنوز نگرفتیش از بخش فایل‌ها دانلودش کن.", tab: 1)
            }
            if s.gift && !s.giftMissing.isEmpty {
                let both = s.giftMissing.count > 1
                let what = both ? "شماره‌ی موبایل و ایمیل" : (s.giftMissing[0] == "mobile" ? "شماره‌ی موبایل" : "ایمیل")
                let n = fa(s.giftCredits)
                let gift = both ? "\(n) اعتبار هدیه برای هر مورد" : "\(n) اعتبار هدیه"
                add("pf", key: "once", at: done + 26 * H, deadline: done + 8 * D,
                    title: "🎁 هدیه‌ی تکمیل پروفایل", body: "با ثبت و تایید \(what)، \(gift) بگیر (برای هر مورد فقط یک‌بار).", tab: 3)
            }
            if !s.unlimited && !planActive && !s.everPlan {
                add("buy48", key: "once", at: done + 2 * D, deadline: done + 9 * D,
                    title: "🚀 ارائه‌های بیشتر و بلندتر می‌خوای؟", body: "با پلن ماهانه ارائه و اسلاید بیشتری داری؛ پلن‌ها رو ببین.", tab: 3)
            }
            if s.decks <= 2 {
                let t = Tehran.snap(done + 3 * D)
                let tp = topic(at: t)
                add("next", key: String(Int(done)), at: done + 3 * D, deadline: done + 5 * D,
                    title: "ارائه‌ی بعدی‌ات چیه؟ 💡", body: "ایده: «\(tp)» — بزن روش تا آماده‌ی ساخت بشه.", tab: 0, topic: tp)
            }
            if s.decks >= 2 {
                add("coffee", key: "once", at: done + D, deadline: done + 4 * D,
                    title: "☕ یه قهوه مهمونم می‌کنی؟", body: "اگه از pptساز خوشت اومده، یه قهوه مهمونم کن 💛", tab: 0, url: supportURL)
            }
            if s.decks >= 2 && s.decks <= 6 {
                add("invite", key: "once", at: done + 3 * H, deadline: done + 3 * D,
                    title: "🙌 به دوستانت هم معرفی کن",
                    body: "با دعوت دوستانت اعتبار هدیه بگیر؛ لینک اختصاصی‌ات توی بخش «حساب» آماده‌ست.", tab: 3)
            }
        } else if s.decks > 0 && done == 0 && s.legacyBuy48At > 0 && !s.unlimited && !planActive && !s.everPlan {
            // کاربران قدیمی که زمان آخرین ارائه‌شان ثبت نشده
            add("buy48", key: "once", at: s.legacyBuy48At + 2 * D, deadline: s.legacyBuy48At + 9 * D,
                title: "🚀 ارائه‌های بیشتر و بلندتر می‌خوای؟", body: "با پلن ماهانه ارائه و اسلاید بیشتری داری؛ پلن‌ها رو ببین.", tab: 3)
        }

        // بازگشت: ۷ و ۲۱ روز بعد از آخرین باز شدن
        if s.lastOpen > 0 {
            let k = String(Int(s.lastOpen))
            let t7 = Tehran.snap(s.lastOpen + 7 * D)
            let t21 = Tehran.snap(s.lastOpen + 21 * D)
            add("inactive7", key: k, at: s.lastOpen + 7 * D, deadline: s.lastOpen + 9 * D,
                title: "دلمون برات تنگ شده 👋", body: seasonalIdea(at: t7), tab: 0)
            add("inactive21", key: k, at: s.lastOpen + 21 * D, deadline: s.lastOpen + 23 * D,
                title: "یه ایده‌ی تازه برای ارائه‌هات 💡", body: seasonalIdea(at: t21), tab: 0)
        }

        return applyCaps(cands, s: s, now: now)
    }

    /// سقف‌ها: ۱ در روز، ۳ در هفته، «بازگشت» ۲ بار در ماه، «تکمیل‌کننده» هر ۱۴ روز یک‌بار
    static func applyCaps(_ cands: [(r: PlannedReminder, deadline: Double)], s: ReminderState, now: Double) -> [PlannedReminder] {
        var times: [ReminderLog] = s.log.filter { now - $0.t < 30 * Tehran.day }
        var out: [PlannedReminder] = []
        for c in cands.sorted(by: { $0.r.at < $1.r.at }) {
            var r = c.r
            if r.kind.hasPrefix("inactive") && times.filter({ $0.kind.hasPrefix("inactive") }).count >= 2 { continue }
            if r.kind == "extras" && times.contains(where: { $0.kind == "extras" && abs(r.at - $0.t) < 14 * Tehran.day }) { continue }
            var t = r.at
            var ok = false
            for _ in 0..<15 {
                let sameDay = times.contains { Tehran.dayStart($0.t) == Tehran.dayStart(t) }
                let week = times.filter { $0.t <= t && t - $0.t < 7 * Tehran.day }.count
                if !sameDay && week < 3 { ok = true; break }
                t = Tehran.next10(Tehran.dayStart(t) + Tehran.day)
            }
            if !ok || (c.deadline > 0 && t >= c.deadline) { continue }
            r.at = t
            times.append(ReminderLog(t: t, kind: r.kind))
            out.append(r)
        }
        return out.sorted { $0.at < $1.at }
    }
}

// MARK: - مدیر یادآورها

@MainActor
final class ReminderCenter {
    static let shared = ReminderCenter()
    private let key = "pptsaz.reminders.v1"

    var enabled: Bool { Pref.bool(Pref.reminders, true) }

    private func load() -> ReminderState {
        guard let d = UserDefaults.standard.data(forKey: key),
              let s = try? JSONDecoder().decode(ReminderState.self, from: d) else { return ReminderState() }
        return s
    }

    private func save(_ s: ReminderState) {
        if let d = try? JSONEncoder().encode(s) { UserDefaults.standard.set(d, forKey: key) }
    }

    private var nowMs: Double { Date().timeIntervalSince1970 * 1000 }

    /// هر بار که حساب از سرور خوانده می‌شود. opened = false یعنی خواندن در پس‌زمینه بوده (باز شدن اپ حساب نمی‌شود)
    func onMe(_ me: Me, dailyFreeOn: Bool, opened: Bool = true) {
        var s = load()
        let now = nowMs
        let D = Tehran.day, H = Tehran.hour
        s.signedIn = true
        if s.firstSeen == 0 { s.firstSeen = now }
        if opened { s.lastOpen = now }
        s.decks = max(me.decks, s.decks)
        s.credits = me.credits
        s.unlimited = me.unlimited
        s.dailyFreeOn = dailyFreeOn
        s.gift = me.giftAvailable && me.giftCredits > 0 && !me.giftMissing.isEmpty
        s.giftCredits = me.giftCredits
        s.giftMissing = me.giftMissing

        let planActive = me.planId != nil && me.planExp > now
        if planActive {
            s.planId = me.planId ?? ""
            s.planExp = me.planExp
            s.planCredits = me.planCredits
            s.planName = me.plans.first { $0.id == me.planId }?.name ?? ""
            s.planOutAt = 0
            s.planOutExp = 0
        } else {
            // «اعتبار پلن تمام شد ولی روز مانده»: پلنی که تا الان فعال بود، اعتبار داشت و حالا سرور فعالش نمی‌داند
            if s.planExp > now && s.planCredits > 0 {
                s.planOutExp = s.planExp
                s.planOutAt = Tehran.next10(now + 6 * H)
            }
            s.planId = ""
            s.planExp = 0
            s.planCredits = 0
            s.planName = ""
        }
        if me.planId != nil { s.everPlan = true }

        if planActive && me.planCredits == 1 && me.planExp - now > 2 * D && now - s.deckDoneAt < 2 * D {
            if s.lowFor != me.planExp {
                s.lowFor = me.planExp
                s.lowAt = Tehran.snap(now + H)
                s.lowDeadline = now + 2 * D
            }
        } else {
            s.lowAt = 0
        }

        if s.decks > 0 && !me.unlimited && !planActive && !s.everPlan && s.deckDoneAt == 0 && s.legacyBuy48At == 0 {
            s.legacyBuy48At = now
        }
        apply(&s)
    }

    func onOpen() {
        var s = load()
        guard s.signedIn else { return }
        s.lastOpen = nowMs
        apply(&s)
    }

    func onDeckDone() {
        var s = load()
        s.decks += 1
        s.deckDoneAt = nowMs
        s.signedIn = true
        apply(&s)
    }

    func onExtraMade() {
        var s = load()
        s.extraMadeAt = nowMs
        apply(&s)
    }

    func onLogout() {
        UserDefaults.standard.removeObject(forKey: key)
        Task { await Notify.shared.cancelReminders() }
    }

    /// بعد از تغییر کلید «یادآورهای هوشمند» در تنظیمات
    func refresh() {
        var s = load()
        apply(&s)
    }

    private func apply(_ s: inout ReminderState) {
        let now = nowMs
        // یادآورهایی که زمانشان گذشته، فرض می‌شود نشان داده شده‌اند (مبنای سقف‌ها و «فقط یک‌بار»)
        for p in s.pending where p.at <= now {
            s.log.append(ReminderLog(t: p.at, kind: p.kind))
            s.sent.append("\(p.kind)|\(p.key)")
        }
        s.log = s.log.filter { now - $0.t < 30 * Tehran.day }
        if s.sent.count > 60 { s.sent = Array(s.sent.suffix(60)) }
        let plan = enabled ? ReminderPlanner.plan(s, now: now) : []
        s.pending = plan
        save(s)
        Task { await Notify.shared.replaceReminders(plan) }
    }
}
