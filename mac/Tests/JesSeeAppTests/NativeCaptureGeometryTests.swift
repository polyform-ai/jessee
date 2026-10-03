import AppKit
import CoreImage
import Foundation
@testable import JesSeeCore
@preconcurrency import ScreenCaptureKit
import Testing

private struct NativeCaptureSample: @unchecked Sendable {
  var image: CGImage
  var contentRect: CGRect
  var screenRect: CGRect
  var scaleFactor: Double
  var contentScale: Double
}

private final class NativeGeometryProbe: NSObject, SCStreamOutput, @unchecked Sendable {
  private let lock = NSLock()
  private var samples: [NativeCaptureSample] = []
  private let context = CIContext()

  func latest() -> NativeCaptureSample? {
    lock.lock(); defer { lock.unlock() }
    return samples.last
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer,
    of outputType: SCStreamOutputType) {
    guard let pixels = buffer.imageBuffer,
      let info = (CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false)
        as? [[SCStreamFrameInfo: Any]])?.first,
      info[.status] as? Int == SCFrameStatus.complete.rawValue,
      let content = info[.contentRect] as? [String: Any],
      let rect = CGRect(dictionaryRepresentation: content as CFDictionary),
      let screen = info[.screenRect] as? [String: Any],
      let screenRect = CGRect(dictionaryRepresentation: screen as CFDictionary),
      let factor = info[.scaleFactor] as? Double,
      let contentScale = info[.contentScale] as? Double,
      let image = context.createCGImage(CIImage(cvPixelBuffer: pixels),
        from: CGRect(x: 0, y: 0, width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels)))
    else { return }
    lock.lock()
    samples.append(.init(image: image, contentRect: rect, screenRect: screenRect, scaleFactor: factor, contentScale: contentScale))
    lock.unlock()
  }
}

@MainActor private final class CaptureQATarget: NSView {
  override var isFlipped: Bool { true }
  override func draw(_ rect: NSRect) {
    NSColor.white.setFill(); bounds.fill()
    NSColor.blue.setFill()
    CGRect(x: bounds.width * 0.25 - 8, y: bounds.height * 0.25 - 8, width: 16, height: 16).fill()
  }
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["JESSEE_NATIVE_CAPTURE_QA"] == "1"
  && (CGSessionCopyCurrentDictionary() as? [String: Any])?["CGSSessionScreenIsLocked"] as? Bool != true))
@MainActor func nativeCaptureMetadataAlignsMarksAfterMovingAndResizingTheWindow() async throws {
  _ = NSApplication.shared
  NSApp.setActivationPolicy(.accessory)
  let panel = NSPanel(contentRect: CGRect(x: 200, y: 400, width: 1000, height: 600),
    styleMask: [.borderless], backing: .buffered, defer: false)
  panel.contentView = CaptureQATarget()
  panel.title = "JesSee alignment QA"
  panel.orderFrontRegardless()
  defer { panel.close() }
  try await Task.sleep(for: .milliseconds(500))
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
  print("QA window: \(panel.windowNumber), visible: \(panel.isVisible), own capture windows: \(content.windows.filter { $0.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier }.map(\.windowID))")
  let window = try #require(content.windows.first { $0.windowID == CGWindowID(panel.windowNumber) })
  let filter = SCContentFilter(desktopIndependentWindow: window)
  let config = SCStreamConfiguration()
  config.width = 1000; config.height = 600
  config.ignoreShadowsSingleWindow = true
  config.showsCursor = false
  let probe = NativeGeometryProbe()
  let stream = SCStream(filter: filter, configuration: config, delegate: nil)
  try stream.addStreamOutput(probe, type: .screen, sampleHandlerQueue: DispatchQueue(label: "qa.capture"))
  try await stream.startCapture()
  do {
    for phase in 0...1 {
      if phase == 1 {
        panel.setFrame(CGRect(x: 300, y: 450, width: 800, height: 400), display: true)
        panel.contentView?.needsDisplay = true
      }
      try await Task.sleep(for: .milliseconds(350))
      let sample = try #require(probe.latest())
      print("Native capture phase \(phase): rect=\(sample.contentRect), screen=\(sample.screenRect), factor=\(sample.scaleFactor), contentScale=\(sample.contentScale), surface=\(sample.image.width)x\(sample.image.height)")
      let geometry = RecordingFrameGeometry(seconds: 0, contentRect: sample.contentRect,
        scaleFactor: sample.scaleFactor,
        surfaceSize: CGSize(width: sample.image.width, height: sample.image.height))
      let rect = RecordingFrameGeometry.contentRect(at: 0, in: [geometry])
      #expect(rect.width <= 1.001 && rect.height <= 1.001)
      let x = Int((rect.minX + rect.width * 0.25) * Double(sample.image.width))
      let y = Int((rect.minY + rect.height * 0.25) * Double(sample.image.height))
      let raw = NSBitmapImageRep(cgImage: sample.image)
      let target = try #require(raw.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB))
      #expect(target.blueComponent > 0.8 && target.redComponent < 0.3)
      let stroke = RecordingMarkupStroke(kind: .pen, points: [
        .init(x: 0.24, y: 0.25), .init(x: 0.26, y: 0.25)], createdAtSeconds: 0)
      let marked = MediaTools.applyMarkups([stroke], at: 0, to: sample.image, contentRect: rect)
      let pixel = try #require(NSBitmapImageRep(cgImage: marked).colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB))
      #expect(pixel.redComponent > 0.8 && pixel.blueComponent < 0.5)
      let folder = ProcessInfo.processInfo.environment["JESSEE_QA_OUTPUT"].map { URL(fileURLWithPath: $0) }
      if let folder {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let data = try #require(NSBitmapImageRep(cgImage: marked).representation(using: .png, properties: [:]))
        try data.write(to: folder.appendingPathComponent("native-alignment-\(phase).png"))
      }
    }
    try await stream.stopCapture()
  } catch {
    try? await stream.stopCapture()
    throw error
  }
}
