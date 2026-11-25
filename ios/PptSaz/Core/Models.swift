import Foundation

struct Opt: Identifiable, Hashable {
    var id: String { key }
    let key: String
    let name: String
    var color: String? = nil
    var hint: String = ""
}

struct PlanInfo: Identifiable, Hashable {
    var id: String
    var name: String
    var price: Int // هزار تومان
    var credits: Int
    var days: Int
    var maxSlides: Int
    var maxImages: Int
    var url: String
}

struct ModelOpt: Identifiable, Hashable {
    var id: String
    var name: String
    var brand: String
    var free: Bool
}

struct Config {
    var templates: [Opt] = []
    var themes: [Opt] = []
    var tones: [Opt] = []
    var fonts: [String] = []
    var slideChoices: [Int] = [5, 6, 8, 10]
    var payEnabled = false
    var sibapp = false
    var otp = true
    var emailOtp = false
    var link = false
    var poster = false
    var audio = false
    var pdf = false
    var voice = false
    var dailyFree = 0
    var models: [ModelOpt] = []

    static let empty = Config()
}

struct Settings {
    var theme = ""
    var template = ""
    var tone = ""
    var font = ""
    var slides = 6
    var model = ""
    var mode = "normal"
    var digits = false
    var sources = false
    var questions = false
    var notes = true
    var images = true
    var imagesMany = false

    mutating func apply(_ key: String, _ value: Any) {
        switch key {
        case "theme": theme = value as? String ?? theme
        case "template": template = value as? String ?? template
        case "tone": tone = value as? String ?? tone
        case "font": font = value as? String ?? font
        case "model": model = value as? String ?? model
        case "mode": mode = value as? String ?? mode
        case "slides": slides = value as? Int ?? slides
        case "digits": digits = value as? Bool ?? digits
        case "sources": sources = value as? Bool ?? sources
        case "questions": questions = value as? Bool ?? questions
        case "notes": notes = value as? Bool ?? notes
        case "images": images = value as? Bool ?? images
        case "imagesMany": imagesMany = value as? Bool ?? imagesMany
        default: break
        }
    }
}

/// وضعیت اتصال یک پیام‌رسان به حساب (سرور: channels در /api/me)؛ key: tg | bale | eitaa | rubika | splus
struct ChannelInfo: Identifiable {
    var key = ""
    var label = ""
    var connected = false
    var shown = ""
    var notify = false
    var available = false
    var canUnlink = false
    var url = ""
    var id: String { key }
}

struct Me {
    var name = ""
    var mobile = ""
    var email = ""
    var unlimited = false
    var premium = false
    var credits = 0
    var maxSlides = 6
    var maxImages = 1
    var planId: String? = nil
    var planExp: Double = 0
    var planCredits = 0
    var bonus = 0
    var dailyFree = false
    var settings = Settings()
    var activeJob: String? = nil
    var plans: [PlanInfo] = []
    var support = ""
    var decks = 0
    var giftAvailable = false
    var giftCredits = 0
    var giftNote = ""
    var giftMissing: [String] = []
    /// اتصال پلتفرم‌ها: هم‌زمان به چند پیام‌رسان؛ اعلان به همه‌ی روشن‌ها می‌رسد
    var channels: [ChannelInfo] = []
    var devApp = false
    var devWeb = false
    var devEmail = false

    var displayName: String {
        if !name.isEmpty { return name }
        if !mobile.isEmpty { return mobile }
        return email
    }
}

struct FileItem: Identifiable, Hashable {
    let id: String
    var title: String
    var slides: Int
    var t: Double
    var poster: Bool
    var handout: Bool
    var audio: String
    var extras: [String]
    var sample: Bool
    var pdf: Bool
    var label: String
}

enum FileKind {
    case deck, poster, handout, audio, podcast, pdf

    init(_ f: FileItem) {
        if f.poster { self = .poster }
        else if f.handout { self = .handout }
        else if f.audio == "podcast" { self = .podcast }
        else if !f.audio.isEmpty { self = .audio }
        else if f.pdf { self = .pdf }
        else { self = .deck }
    }

    var icon: String {
        switch self {
        case .deck: return "rectangle.on.rectangle.angled"
        case .poster: return "photo.artframe"
        case .handout: return "doc.text"
        case .audio: return "waveform"
        case .podcast: return "mic.fill"
        case .pdf: return "doc.richtext"
        }
    }

    var label: String {
        switch self {
        case .deck: return "ارائه"
        case .poster: return "پوستر"
        case .handout: return "جزوه"
        case .audio: return "اسلاید صوتی"
        case .podcast: return "پادکست"
        case .pdf: return "PDF"
        }
    }
}

let extraKinds = ["audio", "podcast", "handout", "poster"]

func extraName(_ kind: String) -> String {
    switch kind {
    case "audio": return "اسلاید صوتی"
    case "podcast": return "پادکست"
    case "handout": return "جزوه‌ی Word"
    case "poster": return "پوستر"
    default: return kind
    }
}

func extraIcon(_ kind: String) -> String {
    switch kind {
    case "audio": return "waveform"
    case "podcast": return "mic.fill"
    case "handout": return "doc.text"
    default: return "photo.artframe"
    }
}

struct SupportMsg: Identifiable {
    let id = UUID()
    let fromUser: Bool
    let text: String
    let flagged: Bool
}

struct SupportData {
    var msgs: [SupportMsg]
    var remaining: Int
    var limit: Int
}

struct InviteInfo {
    var link: String
    var count: Int
    var max: Int
    var every: Int
    var canClaim: Bool
}

struct JobState {
    var id: String
    var message: String
    var pct: Int = -1
    var done = false
    var failed = false
    var title = ""
    var handoutId: String? = nil
    var posterId: String? = nil
    var posterFailed = false
    var audioWaiting = false
    var podcastWaiting = false
    var audioFailed = false
    var podcastFailed = false

    var running: Bool { !done && !failed }
}

// MARK: - تجزیه‌ی پاسخ سرور

func parseConfig(_ j: J) -> Config {
    var c = Config()
    c.templates = j["templates"].arr.map {
        Opt(key: $0["key"].str, name: ($0["emoji"].str + " " + $0["name"].str).trimmingCharacters(in: .whitespaces), hint: $0["hint"].str)
    }
    c.themes = j["themes"].arr.map {
        Opt(key: $0["key"].str, name: $0["name"].str, color: $0["primary"].str.isEmpty ? nil : $0["primary"].str)
    }
    let tones = j["tones"]
    let order = ["formal", "friendly", "educational", "persuasive"]
    let keys = tones.keys.sorted { a, b in
        let ia = order.firstIndex(of: a) ?? 99, ib = order.firstIndex(of: b) ?? 99
        return ia == ib ? a < b : ia < ib
    }
    c.tones = keys.map { Opt(key: $0, name: tones[$0].str) }
    c.fonts = j["fonts"].arr.map { $0.str }
    let sc = j["slideChoices"].arr.map { $0.int }.filter { $0 > 0 }
    if !sc.isEmpty { c.slideChoices = sc }
    c.payEnabled = j["payEnabled"].bool
    c.sibapp = j["sibapp"].bool
    c.otp = j["otp"].bool
    c.emailOtp = j["emailOtp"].bool
    c.link = j["link"].bool
    c.poster = j["poster"].bool
    c.audio = j["audio"].bool
    c.pdf = j["pdf"].bool
    c.voice = j["voice"].bool
    c.dailyFree = j["dailyFree"].int
    c.models = j["models"].arr.map {
        ModelOpt(id: $0["id"].str, name: $0["name"].str, brand: $0["brand"].str, free: $0["free"].exists ? $0["free"].bool : true)
    }
    return c
}

func parseMe(_ j: J) -> Me? {
    let u = j["user"]
    guard u.exists else { return nil }
    let cr = j["credit"]
    let st = j["settings"]
    var m = Me()
    m.name = u["name"].str
    m.mobile = u["mobile"].str
    m.email = u["email"].str
    m.unlimited = cr["unlimited"].bool
    m.premium = j["premium"].bool
    m.credits = cr["total"].int
    m.maxSlides = j["maxSlides"].exists ? j["maxSlides"].int : 6
    m.maxImages = j["maxImages"].exists ? j["maxImages"].int : 1
    m.planExp = j["plan"]["exp"].double
    m.planCredits = cr["plan"].int
    m.bonus = cr["bonus"].int
    m.dailyFree = j["dailyFree"].bool
    let pid = j["plan"]["id"].str
    m.planId = pid.isEmpty ? nil : pid
    var s = Settings()
    s.theme = st["theme"].str
    s.template = st["template"].str
    s.tone = st["tone"].str
    s.font = st["font"].str
    s.slides = st["slides"].exists ? st["slides"].int : 6
    s.model = st["model"].str
    s.mode = st["mode"].str.isEmpty ? "normal" : st["mode"].str
    s.digits = st["digits"].bool
    s.sources = st["sources"].bool
    s.questions = st["questions"].bool
    s.notes = st["notes"].exists ? st["notes"].bool : true
    s.images = st["images"].exists ? st["images"].bool : true
    s.imagesMany = st["imagesMany"].bool
    m.settings = s
    let aj = j["activeJob"].str
    m.activeJob = aj.isEmpty ? nil : aj
    m.plans = j["plans"].arr.map {
        PlanInfo(id: $0["id"].str, name: $0["name"].str, price: $0["price"].int, credits: $0["credits"].int,
                 days: $0["days"].int, maxSlides: $0["maxSlides"].int, maxImages: $0["maxImages"].int, url: $0["url"].str)
    }
    m.support = j["support"].str
    m.decks = j["decks"].int
    let cw = j["contactReward"]
    m.giftAvailable = cw["available"].bool
    m.giftCredits = cw["credits"].int
    m.giftNote = cw["note"].str
    m.giftMissing = cw["missing"].arr.map { $0.str }
    m.channels = j["channels"].arr.map {
        ChannelInfo(key: $0["key"].str, label: $0["label"].str, connected: $0["connected"].bool, shown: $0["shown"].exists ? $0["shown"].str : "",
                    notify: $0["notify"].bool, available: $0["available"].bool, canUnlink: $0["canUnlink"].bool, url: $0["url"].str)
    }
    m.devApp = j["devices"]["app"].bool
    m.devWeb = j["devices"]["web"].bool
    m.devEmail = j["devices"]["email"].bool
    return m
}

func parseFiles(_ j: J) -> [FileItem] {
    j["files"].arr.map {
        FileItem(
            id: $0["id"].str, title: $0["title"].str, slides: $0["slides"].int, t: $0["t"].double,
            poster: $0["poster"].bool, handout: $0["handout"].bool, audio: $0["audio"].str,
            extras: $0["extras"].arr.map { $0.str }.filter { extraKinds.contains($0) },
            sample: $0["sample"].bool, pdf: $0["pdf"].bool, label: $0["label"].str
        )
    }.filter { !$0.id.isEmpty }
}

func parseSupport(_ j: J) -> SupportData {
    let msgs: [SupportMsg] = j["msgs"].arr.compactMap { (o: J) -> SupportMsg? in
        let t = o["t"].str
        if t.isEmpty { return nil }
        return SupportMsg(fromUser: o["r"].str == "u", text: t, flagged: o["f"].int == 1)
    }
    return SupportData(
        msgs: msgs,
        remaining: j["remaining"].exists ? j["remaining"].int : 10,
        limit: j["limit"].exists ? j["limit"].int : 10
    )
}
