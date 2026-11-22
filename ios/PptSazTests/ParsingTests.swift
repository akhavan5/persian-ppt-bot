import XCTest
@testable import PptSaz

final class ParsingTests: XCTestCase {
    func testMobileNormalization() {
        XCTAssertEqual(normalizeIranMobile("09123456789"), "09123456789")
        XCTAssertEqual(normalizeIranMobile("۰۹۱۲۳۴۵۶۷۸۹"), "09123456789")
        XCTAssertEqual(normalizeIranMobile("9123456789"), "09123456789")
        XCTAssertEqual(normalizeIranMobile("+989123456789"), "09123456789")
        XCTAssertEqual(normalizeIranMobile("00989123456789"), "09123456789")
        XCTAssertEqual(normalizeIranMobile("989123456789"), "09123456789")
        XCTAssertNil(normalizeIranMobile("0812345678"))
        XCTAssertNil(normalizeIranMobile("12345"))
    }

    func testEmailAndLoginId() {
        XCTAssertEqual(normalizeEmail(" Name@Example.com "), "name@example.com")
        XCTAssertNil(normalizeEmail("name@example"))
        XCTAssertNil(normalizeEmail("@example.com"))
        XCTAssertEqual(normalizeLoginId("user@mail.ir"), "user@mail.ir")
        XCTAssertEqual(normalizeLoginId("09121234567"), "09121234567")
        XCTAssertNil(normalizeLoginId("user@"))
    }

    func testDigits() {
        XCTAssertEqual(Fa.digits("399"), "۳۹۹")
        XCTAssertEqual(Fa.normalize("۱۲۳٤٥٦"), "123456")
        XCTAssertEqual(599.fa, "۵۹۹")
    }

    func testOtpExtraction() {
        XCTAssertEqual(extractOtp("کد تأیید شما: ۱۲۳۴۵۶"), "123456")
        XCTAssertNil(extractOtp("بدون کد"))
    }

    func testParseMe() throws {
        let json = """
        {"user":{"name":"رضا","mobile":"09121234567","email":""},
         "credit":{"total":5,"plan":5,"bonus":0,"unlimited":false},
         "premium":true,"maxSlides":20,"maxImages":4,
         "plan":{"id":"plus","exp":1800000000000},
         "settings":{"theme":"ocean","slides":10,"mode":"student","images":true},
         "plans":[{"id":"plus","name":"پلاس","price":790,"credits":5,"days":30,"maxSlides":20,"maxImages":4},
                  {"id":"pro","name":"پرو","price":1340,"credits":11,"days":30,"maxSlides":35,"maxImages":7}]}
        """
        let obj = try JSONSerialization.jsonObject(with: Data(json.utf8))
        let me = try XCTUnwrap(parseMe(J(obj)))
        XCTAssertEqual(me.name, "رضا")
        XCTAssertEqual(me.credits, 5)
        XCTAssertTrue(me.premium)
        XCTAssertEqual(me.planId, "plus")
        XCTAssertEqual(me.settings.mode, "student")
        XCTAssertEqual(me.plans.map { $0.price }, [790, 1340])
    }

    func testParseMeLoggedOut() throws {
        let obj = try JSONSerialization.jsonObject(with: Data("{\"user\":null}".utf8))
        XCTAssertNil(parseMe(J(obj)))
    }

    func testParseFilesAndConfig() throws {
        let files = try JSONSerialization.jsonObject(with: Data("""
        {"files":[{"id":"a1","title":"ارائه","slides":8,"t":1700000000000,"extras":["audio","bogus","poster"]},
                  {"id":"s1","title":"نمونه","sample":true,"audio":"podcast"}]}
        """.utf8))
        let list = parseFiles(J(files))
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(list[0].extras, ["audio", "poster"])
        XCTAssertEqual(FileKind(list[1]), .podcast)

        let cfg = try JSONSerialization.jsonObject(with: Data("""
        {"payEnabled":true,"otp":true,"tones":{"persuasive":"متقاعدکننده","formal":"رسمی"},"slideChoices":[5,8,10]}
        """.utf8))
        let c = parseConfig(J(cfg))
        XCTAssertTrue(c.payEnabled)
        XCTAssertEqual(c.tones.map { $0.key }, ["formal", "persuasive"])
        XCTAssertEqual(c.slideChoices, [5, 8, 10])
    }
}
