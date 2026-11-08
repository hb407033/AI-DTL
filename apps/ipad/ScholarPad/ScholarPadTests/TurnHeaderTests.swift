import XCTest
@testable import ScholarPad

final class TurnHeaderTests: XCTestCase {
    func testParsesHeaderSplitAcrossDeltas() {
        var parser = TurnHeaderParser()
        XCTAssertNil(parser.feed("{\"transcr"))
        let header = parser.feed("ipt\":\"帮我\",\"kind\":\"help\"}")
        XCTAssertEqual(header, TurnHeader(transcript: "帮我", kind: .help))
    }

    func testStripsJsonFence() {
        var parser = TurnHeaderParser()
        let header = parser.feed("```json\n{\"transcript\":\"帮我\",\"kind\":\"question\"}\n```")
        XCTAssertEqual(header?.kind, .question)
        XCTAssertEqual(header?.transcript, "帮我")
    }

    func testTrailingTextIsKeptOutOfHeader() {
        var parser = TurnHeaderParser()
        let header = parser.feed("{\"transcript\":\"帮我\",\"kind\":\"help\"}后面这些字不能当头")
        XCTAssertEqual(header?.transcript, "帮我")
        XCTAssertEqual(parser.trailing, "后面这些字不能当头")
    }

    func testMalformedHeaderReturnsNil() {
        var parser = TurnHeaderParser()
        XCTAssertNil(parser.feed("{not json}"))
    }

    func testUnknownKindReturnsNil() {
        var parser = TurnHeaderParser()
        XCTAssertNil(parser.feed("{\"transcript\":\"帮我\",\"kind\":\"song\"}"))
    }
}
