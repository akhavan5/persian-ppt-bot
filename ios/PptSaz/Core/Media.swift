import UIKit
import AVFoundation
import MediaPlayer

// MARK: - آماده‌سازی عکس برای استخراج متن

enum ImageTools {
    /// هر عکس (HEIC/PNG/WebP/…) را با جهت درست و حجم مناسب (زیر ~۳٫۸ مگابایت) به JPEG تبدیل می‌کند
    static func normalizedJPEG(_ data: Data, maxSide: CGFloat = 2400) -> Data? {
        guard let img = UIImage(data: data) else { return nil }
        var side = maxSide
        var quality: CGFloat = 0.85
        for _ in 0..<5 {
            let scale = min(1, side / max(img.size.width, img.size.height))
            let size = CGSize(width: max(1, (img.size.width * scale).rounded()), height: max(1, (img.size.height * scale).rounded()))
            let fmt = UIGraphicsImageRendererFormat.default()
            fmt.scale = 1
            fmt.opaque = true
            let r = UIGraphicsImageRenderer(size: size, format: fmt)
            let out = r.image { ctx in
                UIColor.white.setFill()
                ctx.fill(CGRect(origin: .zero, size: size))
                img.draw(in: CGRect(origin: .zero, size: size))
            }
            if let j = out.jpegData(compressionQuality: quality), j.count <= 3_800_000 { return j }
            side *= 0.75
            quality = max(0.5, quality - 0.1)
        }
        return nil
    }

    static func normalizedJPEG(_ image: UIImage) -> Data? {
        guard let d = image.jpegData(compressionQuality: 0.9) else { return nil }
        return normalizedJPEG(d)
    }
}

// MARK: - ضبط صدا (ورودی صوتی موضوع)

/// درخواست مجوز میکروفون (جدا از کلاس‌های MainActor تا بازگشت سیستم روی صف دیگر مشکلی نسازد)
func requestMicPermission() async -> Bool {
    await withCheckedContinuation { c in
        AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) }
    }
}

/// ضبط کوتاه (حداکثر ۳ دقیقه) به‌صورت m4a؛ فایل بعداً روی سرور (Deepgram) به متن تبدیل می‌شود.
@MainActor
final class VoiceRecorder: NSObject, ObservableObject {
    @Published var recording = false
    @Published var seconds = 0

    static let maxSeconds = 180
    private var rec: AVAudioRecorder?
    private var timer: Timer?
    private var url: URL?
    var onAutoStop: (() -> Void)?

    /// nil = شروع شد؛ وگرنه پیام خطا
    func start() async -> String? {
        guard await requestMicPermission() else {
            return "دسترسی به میکروفون داده نشده؛ از تنظیمات iOS اجازه بده."
        }
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try s.setActive(true)
            let u = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 48_000
            ]
            let r = try AVAudioRecorder(url: u, settings: settings)
            guard r.record() else { return "ضبط شروع نشد." }
            rec = r
            url = u
            seconds = 0
            recording = true
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                guard let self = self else { return }
                self.seconds += 1
                if self.seconds >= VoiceRecorder.maxSeconds { self.onAutoStop?() }
            }
            return nil
        } catch {
            return "ضبط صدا ممکن نشد."
        }
    }

    /// ضبط را تمام می‌کند و بایت‌های m4a را برمی‌گرداند
    func stop() -> Data? {
        timer?.invalidate()
        timer = nil
        rec?.stop()
        rec = nil
        recording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        defer { if let u = url { try? FileManager.default.removeItem(at: u) }; url = nil }
        guard let u = url, let d = try? Data(contentsOf: u), d.count > 1500 else { return nil }
        return d
    }

    func cancel() {
        _ = stop()
    }
}

// MARK: - پخش‌کننده‌ی صدا (اسلاید صوتی و پادکست)

/// پخش از روی فایل محلی؛ با کنترل از صفحه‌ی قفل و Control Center، و ادامه‌ی پخش در پس‌زمینه
final class AudioPlayerModel: ObservableObject {
    @Published var playing = false
    @Published var current: Double = 0
    @Published var duration: Double = 0
    @Published var rate: Float = 1

    private var player: AVPlayer?
    private var timeObs: Any?
    private var endObs: NSObjectProtocol?
    private var title = ""

    func load(_ url: URL, title: String, autoplay: Bool = true) {
        stop()
        self.title = title
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .spokenAudio)
        try? s.setActive(true)
        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        player = p
        timeObs = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] t in
            guard let self = self else { return }
            self.current = t.seconds.isFinite ? t.seconds : 0
            if let d = self.player?.currentItem?.duration.seconds, d.isFinite, d > 0 { self.duration = d }
            self.updateNowPlaying()
        }
        endObs = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.playing = false
            self.player?.seek(to: .zero)
            self.current = 0
            self.updateNowPlaying()
        }
        setupRemote()
        if autoplay { play() }
    }

    func play() {
        guard let p = player else { return }
        p.play()
        p.rate = rate
        playing = true
        updateNowPlaying()
    }

    func pause() {
        player?.pause()
        playing = false
        updateNowPlaying()
    }

    func toggle() { playing ? pause() : play() }

    func seek(to seconds: Double) {
        let t = max(0, min(seconds, duration > 0 ? duration : seconds))
        player?.seek(to: CMTime(seconds: t, preferredTimescale: 600))
        current = t
        updateNowPlaying()
    }

    func skip(_ delta: Double) { seek(to: current + delta) }

    func setRate(_ r: Float) {
        rate = r
        if playing { player?.rate = r }
        updateNowPlaying()
    }

    func stop() {
        if let o = timeObs { player?.removeTimeObserver(o) }
        timeObs = nil
        if let e = endObs { NotificationCenter.default.removeObserver(e) }
        endObs = nil
        player?.pause()
        player = nil
        playing = false
        current = 0
        duration = 0
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.removeTarget(nil)
        c.pauseCommand.removeTarget(nil)
        c.skipForwardCommand.removeTarget(nil)
        c.skipBackwardCommand.removeTarget(nil)
        c.changePlaybackPositionCommand.removeTarget(nil)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func setupRemote() {
        let c = MPRemoteCommandCenter.shared()
        c.skipForwardCommand.preferredIntervals = [15]
        c.skipBackwardCommand.preferredIntervals = [15]
        c.playCommand.addTarget { [weak self] _ in DispatchQueue.main.async { self?.play() }; return .success }
        c.pauseCommand.addTarget { [weak self] _ in DispatchQueue.main.async { self?.pause() }; return .success }
        c.skipForwardCommand.addTarget { [weak self] _ in DispatchQueue.main.async { self?.skip(15) }; return .success }
        c.skipBackwardCommand.addTarget { [weak self] _ in DispatchQueue.main.async { self?.skip(-15) }; return .success }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            if let e = e as? MPChangePlaybackPositionCommandEvent {
                let t = e.positionTime
                DispatchQueue.main.async { self?.seek(to: t) }
            }
            return .success
        }
    }

    private func updateNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title.isEmpty ? "پاورپوینت‌ساز" : title,
            MPMediaItemPropertyArtist: "پاورپوینت‌ساز",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: current,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? Double(rate) : 0.0
        ]
    }

    deinit {
        if let o = timeObs { player?.removeTimeObserver(o) }
        if let e = endObs { NotificationCenter.default.removeObserver(e) }
    }
}

/// «۰۱:۲۳» با ارقام فارسی
func clockText(_ seconds: Double) -> String {
    let s = Int(max(0, seconds))
    return Fa.digits(String(format: "%02d:%02d", s / 60, s % 60))
}
