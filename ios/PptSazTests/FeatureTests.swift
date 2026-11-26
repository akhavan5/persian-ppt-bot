import XCTest
@testable import PptSaz

final class FeatureTests: XCTestCase {
    // MARK: زمان تهران

    func testTehranSnap() {
        let d0 = Tehran.dayStart(1_800_000_000_000)
        XCTAssertEqual(Tehran.snap(d0 + 3 * Tehran.hour), d0 + 10 * Tehran.hour)
        XCTAssertEqual(Tehran.snap(d0 + 22 * Tehran.hour), d0 + Tehran.day + 10 * Tehran.hour)
        XCTAssertEqual(Tehran.snap(d0 + 12 * Tehran.hour), d0 + 12 * Tehran.hour)
        XCTAssertEqual(Tehran.next10(d0 + 11 * Tehran.hour), d0 + Tehran.day + 10 * Tehran.hour)
        XCTAssertEqual(Tehran.next10(d0 + 5 * Tehran.hour), d0 + 10 * Tehran.hour)
    }

    // MARK: برنامه‌ریز یادآورها

    func testPlannerActivation() {
        let now = Tehran.dayStart(1_800_000_000_000) + 12 * Tehran.hour
        var s = ReminderState()
        s.signedIn = true
        s.firstSeen = now - 2 * Tehran.hour
        let plan = ReminderPlanner.plan(s, now: now)
        XCTAssertTrue(plan.contains { $0.kind == "act1" })
        // حداکثر یک یادآور در هر روز
        let days = plan.map { Tehran.dayStart($0.at) }
        XCTAssertEqual(Set(days).count, days.count)
        // همه در بازه‌ی ۹ تا ۲۱ و در آینده
        for r in plan {
            XCTAssertGreaterThan(r.at, now)
            XCTAssertTrue((9..<21).contains(Tehran.hourOf(r.at)))
        }
    }

    func testPlannerSignedOutAndAlreadyActivated() {
        let now = Tehran.dayStart(1_800_000_000_000) + 12 * Tehran.hour
        XCTAssertTrue(ReminderPlanner.plan(ReminderState(), now: now).isEmpty)
        var s = ReminderState()
        s.signedIn = true
        s.firstSeen = now - 2 * Tehran.hour
        s.decks = 1
        XCTAssertFalse(ReminderPlanner.plan(s, now: now).contains { $0.kind == "act1" })
    }

    // MARK: خواندن اسناد

    func testHtmlAndText() {
        let t = DocReader.htmlToText("<p>سلام</p><script>var q=1</script><p>a &amp; b</p>")
        XCTAssertTrue(t.contains("سلام"))
        XCTAssertTrue(t.contains("a & b"))
        XCTAssertFalse(t.contains("var q"))
        XCTAssertEqual(DocReader.plainText("سلام".data(using: .utf8)!), "سلام")
        var d = Data([0xFF, 0xFE])
        d.append("ab".data(using: .utf16LittleEndian)!)
        XCTAssertEqual(DocReader.plainText(d), "ab")
        XCTAssertEqual(DocReader.unescape("&#1587;&lt;"), "س<")
    }

    func testDocxAndPptx() {
        let docx = Data(base64Encoded: "UEsDBBQAAAAIAOlOel3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgA6U56Xfsx2fRMAAAAiAAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLMpt0rJTy7NTc0rsbMpt0rKT6kE0QUgoghElNjd2Hyz5cbym60KN9bfbLvdc2O5jT5IGEQWgckCDB3rbmwHqe642YpFrT7MGn0kuwFQSwECFAMUAAAACADpTnpdxxwXPAoAAAAIAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAOlOel37Mdn0TAAAAIgAAAARAAAAAAAAAAAAAACAATsAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAAC2AAAAAAA=")!
        XCTAssertEqual(DocReader.docxToText(docx), "سلام دنیا\nخط دوم")
        let pptx = Data(base64Encoded: "UEsDBBQAAAAIAOlOel2x9wSVJgAAADYAAAAVAAAAcHB0L3NsaWRlcy9zbGlkZTIueG1ssymwKs5JsbNJtCoAEUUgosTuxvqbHTdbbfRBbBBZBCaBKvQhygFQSwMEFAAAAAgA6U56XUfR+DVHAAAAcgAAABUAAABwcHQvc2xpZGVzL3NsaWRlMS54bWyzKbAqzkmxs0m0KgARRSCixO7GzpttNztuLL/ZZqMP4oPIIjBZgK70ZuuNVTfbFNQScwusFW6suN1zY8uNVTc2YtGnD7EKAFBLAQIUAxQAAAAIAOlOel2x9wSVJgAAADYAAAAVAAAAAAAAAAAAAACAAQAAAABwcHQvc2xpZGVzL3NsaWRlMi54bWxQSwECFAMUAAAACADpTnpdR9H4NUcAAAByAAAAFQAAAAAAAAAAAAAAgAFZAAAAcHB0L3NsaWRlcy9zbGlkZTEueG1sUEsFBgAAAAACAAIAhgAAANMAAAAAAA==")!
        XCTAssertEqual(DocReader.pptxToText(pptx), "# اسلاید 1\nعنوان\nمتن & بیشتر\n\n# اسلاید 2\nدوم")
        XCTAssertNil(DocReader.docxToText(Data([1, 2, 3, 4, 5])))
    }

    // MARK: کتابخانه و پیش‌نویس

    func testLibraryRoundTrip() {
        let lib = LocalLibrary.shared
        let id = "test-\(UUID().uuidString)|deck"
        let f = lib.save(id: id, title: "تست", kind: "deck", slides: 5, data: Data([1, 2, 3]), fileName: "unit/test:file.pptx")
        XCTAssertNotNil(f)
        XCTAssertTrue(lib.has(id))
        if let f = f {
            XCTAssertFalse(f.fileName.contains("/"))
            XCTAssertTrue(FileManager.default.fileExists(atPath: lib.url(f).path))
            lib.remove(f)
            XCTAssertFalse(lib.has(id))
        }
    }

    func testDraftRoundTrip() {
        Draft.clear()
        XCTAssertTrue(Draft.load().isEmpty)
        Draft.save(DraftForm(topic: "موضوع", handout: true))
        XCTAssertEqual(Draft.load().topic, "موضوع")
        XCTAssertTrue(Draft.load().handout)
        Draft.clear()
        XCTAssertTrue(Draft.load().isEmpty)
    }
}
