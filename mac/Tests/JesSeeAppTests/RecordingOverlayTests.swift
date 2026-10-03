import AppKit
import Testing
import JesSeeCore
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

  @Test func appKitCanvasStoresTheActualPointerPositionNearTheMenuBar() throws {
    let model = RecordingOverlayModel()
    let canvas = RecordingMarkupCanvas(model: model)
    let screen = try #require(NSScreen.main)
    let panel = NSPanel(
      contentRect: CGRect(x: screen.frame.minX + 20, y: screen.frame.maxY - 300,
        width: 800, height: 300),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.level = .statusBar
    panel.contentView = canvas
    panel.contentView?.layoutSubtreeIfNeeded()
    defer { panel.close() }
    model.toggle(.pen)
    func event(_ type: NSEvent.EventType, at point: CGPoint) throws -> NSEvent {
      try #require(NSEvent.mouseEvent(with: type,
        location: canvas.convert(point, to: nil), modifierFlags: [], timestamp: 0,
        windowNumber: panel.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1))
    }
    canvas.mouseDown(with: try event(.leftMouseDown, at: CGPoint(x: 200, y: 75)))
    canvas.mouseUp(with: try event(.leftMouseUp, at: CGPoint(x: 400, y: 150)))
    #expect(model.strokes.first?.points.first == RecordingMarkupPoint(x: 0.25, y: 0.25))
    #expect(model.strokes.first?.points.last == RecordingMarkupPoint(x: 0.5, y: 0.5))
    // Resize the actual AppKit content view, then repeat: no safe-area-dependent offset.
    panel.setFrame(CGRect(x: 20, y: screen.frame.maxY - 600, width: 1000, height: 600), display: false)
    canvas.mouseDown(with: try event(.leftMouseDown, at: CGPoint(x: 250, y: 150)))
    canvas.mouseUp(with: try event(.leftMouseUp, at: CGPoint(x: 500, y: 300)))
    #expect(model.strokes.last?.points.first == RecordingMarkupPoint(x: 0.25, y: 0.25))
    #expect(model.strokes.last?.points.last == RecordingMarkupPoint(x: 0.5, y: 0.5))
  }

  @Test func captureCoordinatesRespectAnOffsetSecondaryDisplay() {
    let frame = RecordingOverlayController.convertCaptureFrame(
      CGRect(x: -1_000, y: -250, width: 600, height: 400),
      displayBounds: CGRect(x: -1_280, y: -300, width: 1_280, height: 720),
      screenFrame: CGRect(x: -1_280, y: 480, width: 1_280, height: 720))
    #expect(frame == CGRect(x: -1_000, y: 750, width: 600, height: 400))
  }
}
