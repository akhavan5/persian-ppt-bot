import Foundation

/// داده‌ی نمونه برای گرفتن اسکرین‌شات‌های معرفی در شبیه‌ساز (فقط با آرگومان اجرای `-demo YES`؛ در اپ عادی هرگز فعال نمی‌شود).
enum DemoData {
    static var config: Config {
        var c = Config()
        c.templates = [
            Opt(key: "modern", name: "✨ مدرن", hint: "طراحی تمیز و امروزی"),
            Opt(key: "classic", name: "📘 کلاسیک", hint: "رسمی و مناسب ارائه‌های دانشگاهی"),
            Opt(key: "bold", name: "🔥 پررنگ", hint: "تیترهای درشت و رنگ‌های قوی")
        ]
        c.themes = [
            Opt(key: "ocean", name: "اقیانوس", color: "#2563EB"),
            Opt(key: "forest", name: "جنگل", color: "#15803D"),
            Opt(key: "sunset", name: "غروب", color: "#EA580C"),
            Opt(key: "violet", name: "بنفش", color: "#7C3AED"),
            Opt(key: "rose", name: "گل‌سرخ", color: "#E11D48"),
            Opt(key: "slate", name: "سنگی", color: "#334155")
        ]
        c.tones = [
            Opt(key: "formal", name: "رسمی و حرفه‌ای"),
            Opt(key: "friendly", name: "دوستانه و ساده"),
            Opt(key: "educational", name: "آموزشی و روشن"),
            Opt(key: "persuasive", name: "متقاعدکننده و انگیزشی")
        ]
        c.fonts = ["Vazirmatn", "B Nazanin", "B Titr", "Tahoma", "Arial"]
        c.slideChoices = [5, 6, 8, 10, 12, 15, 20, 25, 30, 35]
        c.payEnabled = true
        c.poster = true
        c.audio = true
        c.pdf = true
        c.link = true
        c.dailyFree = 1
        c.models = [
            ModelOpt(id: "m1", name: "مدل سریع", brand: "رایگان", free: true),
            ModelOpt(id: "m2", name: "مدل پیشرفته", brand: "ویژه‌ی پلن‌ها", free: false)
        ]
        return c
    }

    static var me: Me {
        var m = Me()
        m.name = "مریم"
        m.mobile = "09121234567"
        m.credits = 5
        m.premium = true
        m.maxSlides = 20
        m.maxImages = 4
        m.planId = "plus"
        m.planExp = Date().timeIntervalSince1970 * 1000 + 20 * 86_400_000
        m.planCredits = 5
        var s = Settings()
        s.theme = "ocean"
        s.template = "modern"
        s.tone = "educational"
        s.font = "Vazirmatn"
        s.slides = 10
        s.model = "m1"
        s.mode = "student"
        s.digits = true
        s.sources = true
        s.images = true
        m.settings = s
        m.plans = [
            PlanInfo(id: "plus", name: "پلاس", price: 490, credits: 5, days: 30, maxSlides: 20, maxImages: 4, url: ""),
            PlanInfo(id: "pro", name: "پرو", price: 740, credits: 11, days: 30, maxSlides: 35, maxImages: 7, url: "")
        ]
        return m
    }

    static var files: [FileItem] {
        let now = Date().timeIntervalSince1970 * 1000
        return [
            FileItem(id: "d1", title: "اصول مدیریت زمان برای دانشجویان", slides: 10, t: now - 2 * 3_600_000, poster: false, handout: false,
                     audio: "", extras: ["audio", "podcast", "handout", "poster"], sample: false, pdf: false, label: ""),
            FileItem(id: "d2", title: "برنامه‌ی بازاریابی دیجیتال", slides: 12, t: now - 5 * 3_600_000, poster: false, handout: false,
                     audio: "", extras: ["handout"], sample: false, pdf: false, label: ""),
            FileItem(id: "d3", title: "هوش مصنوعی در آموزش", slides: 8, t: now - 9 * 3_600_000, poster: false, handout: false,
                     audio: "", extras: [], sample: false, pdf: false, label: ""),
            FileItem(id: "p1", title: "پوستر: تغییرات اقلیمی", slides: 0, t: now - 11 * 3_600_000, poster: true, handout: false,
                     audio: "", extras: [], sample: false, pdf: false, label: "")
        ]
    }
}

extension AppModel {
    func loadDemo() {
        isDemo = true
        let d = UserDefaults.standard
        cfg = DemoData.config
        if d.bool(forKey: "demoLogin") {
            phase = .loggedOut
            return
        }
        me = DemoData.me
        files = DemoData.files
        filesLoaded = true
        selectedTab = d.integer(forKey: "demoTab")
        if d.bool(forKey: "demoJob") {
            job = JobState(id: "demo", message: "در حال نوشتن اسلاید ۵ از ۸…", pct: 55)
        }
        phase = .ready
    }
}
