import AppKit
import Testing
@testable import JesSeeApp

@MainActor
struct RecordingOverlayTests {
  @Test func captureCoordinatesKeepWindowOriginAndFullOffscreenExtent() {
    let source = CGRect(x: 120, y: 30, width: 1_200, height: 900)
    let frame = RecordingOverlayController.convertCaptureFrame(
      source, displayBounds: CGRect(x: 0, y: 0, width: 1_000, height: 800),
      screenFrame: CGRect(x: 0, y: 0, width: 1_000, height: 800))
    #expect(frame == CGRect(x: 120, y: -130, width: 1_200, height: 900))
    let model = RecordingOverlayModel()
    model.toggle(.pen)
    model.beginStroke(at: CGPoint(x: 300, y: 225), size: frame.size)
    model.finishStroke(at: CGPoint(x: 600, y: 450), size: frame.size)
    #expect(model.strokes[0].points.first?.x == 0.25)
    #expect(model.strokes[0].points.first?.y == 0.25)
    #expect(model.strokes[0].points.last?.y == 0.5)
  }

  @Test func captureCoordinatesRespectAnOffsetSecondaryDisplay() {
    let frame = RecordingOverlayController.convertCaptureFrame(
      CGRect(x: -1_000, y: -250, width: 600, height: 400),
      displayBounds: CGRect(x: -1_280, y: -300, width: 1_280, height: 720),
      screenFrame: CGRect(x: -1_280, y: 480, width: 1_280, height: 720))
    #expect(frame == CGRect(x: -1_000, y: 750, width: 600, height: 400))
  }
}
