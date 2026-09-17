import AppKit
import Foundation
import PDFKit
import Testing

@testable import JesSeeCore

@Test func setupResumesAfterPersistedSteps() {
  #expect(JesSeeConfiguration().pendingSetupStep(hasAPIKey: false) == 0)
  #expect(JesSeeConfiguration().pendingSetupStep(hasAPIKey: true) == 1)
  #expect(
    JesSeeConfiguration(email: "person@example.com").pendingSetupStep(hasAPIKey: true) == 2)
  #expect(
    JesSeeConfiguration(email: "person@example.com", outputFolderPath: "/tmp/JesSee")
      .pendingSetupStep(hasAPIKey: true) == 3)
}

@Test func keychainRoundTripPersistsAcrossCalls() throws {
  let service = "ai.polyform.jessee.tests.\(UUID().uuidString)"
  let key = "sk-test-\(UUID().uuidString)"
  defer { try? JesSeeKeychain.removeAPIKey(service: service) }

  try JesSeeKeychain.saveAPIKey(key, service: service)
  #expect(try JesSeeKeychain.loadAPIKey(service: service) == key)
  try JesSeeKeychain.removeAPIKey(service: service)
  #expect(try JesSeeKeychain.loadAPIKey(service: service) == nil)
}

@Test func captureDimensionsPreserveAspectRatioWithinEncoderBounds() {
  #expect(
    CaptureDimensions.fitted(pointWidth: 960, pointHeight: 540, pointPixelScale: 2)
      == CaptureDimensions(width: 1920, height: 1080))
  #expect(
    CaptureDimensions.fitted(pointWidth: 1080, pointHeight: 1920, pointPixelScale: 1)
      == CaptureDimensions(width: 810, height: 1440))
  #expect(
    CaptureDimensions.fitted(pointWidth: 3440, pointHeight: 1440, pointPixelScale: 1)
      == CaptureDimensions(width: 2560, height: 1070))
}

@Test func frameTimesFollowTranscriptAndStayBounded() {
  let segments = (0..<30).map {
    TranscriptSegment(id: $0, start: Double($0 * 2), end: Double($0 * 2 + 1), text: "Step \($0)")
  }
  let times = MediaTools.frameTimes(duration: 60, segments: segments, maximum: 8)
  #expect(times.count == 8)
  #expect(times == times.sorted())
  #expect(times.allSatisfy { $0 >= 0 && $0 < 60 })
}

@Test func frameTimesKeepRecordingMarkupMoments() {
  let segments = (0..<30).map {
    TranscriptSegment(id: $0, start: Double($0 * 2), end: Double($0 * 2 + 1), text: "Step \($0)")
  }
  let times = MediaTools.frameTimes(
    duration: 60, segments: segments, notableTimes: [17.2], maximum: 8)
  #expect(times.count == 8)
  #expect(times.contains { abs($0 - 17.25) < 0.001 })
}

@Test func recordingMarkupsFollowTheirVisibleTimeline() {
  let stroke = RecordingMarkupStroke(
    kind: .pen,
    points: [RecordingMarkupPoint(x: 0.1, y: 0.2), RecordingMarkupPoint(x: 0.8, y: 0.7)],
    createdAtSeconds: 2,
    removedAtSeconds: 5)
  #expect(!stroke.isVisible(at: 1.9))
  #expect(stroke.isVisible(at: 2))
  #expect(stroke.isVisible(at: 4.9))
  #expect(!stroke.isVisible(at: 5))
}

@Test func recordingMarkupIsBakedIntoExtractedVisuals() throws {
  guard
    let context = CGContext(
      data: nil, width: 100, height: 100, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return }
  context.setFillColor(NSColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: 100, height: 100))
  guard let image = context.makeImage() else { return }
  let stroke = RecordingMarkupStroke(
    kind: .pen,
    points: [RecordingMarkupPoint(x: 0.2, y: 0.5), RecordingMarkupPoint(x: 0.8, y: 0.5)],
    createdAtSeconds: 1)
  let marked = MediaTools.applyMarkups([stroke], at: 2, to: image)
  let color = NSBitmapImageRep(cgImage: marked).colorAt(x: 50, y: 50)
  #expect((color?.redComponent ?? 0) > (color?.greenComponent ?? 1))
}

@Test func configurationFromOlderBuildGetsSafePrivacyDefault() throws {
  let data = Data(#"{"email":"a@b.com","outputFolderPath":"/tmp","setupCompleted":true}"#.utf8)
  let configuration = try JesSeeJSON.decoder().decode(JesSeeConfiguration.self, from: data)
  #expect(configuration.shareScreenshotsWithOpenAI)
}

@Test func captionsPreserveSegmentTiming() {
  let transcript = TranscriptDocument(
    text: "Hello world",
    segments: [
      TranscriptSegment(id: 0, start: 1.25, end: 3.5, text: "Hello world")
    ])
  #expect(MediaTools.srt(from: transcript).contains("00:00:01,250 --> 00:00:03,500"))
  #expect(MediaTools.vtt(from: transcript).contains("00:00:01.250 --> 00:00:03.500"))
}

@Test func storyKeyPointsDecodeLegacyStringsWithStableIdentities() throws {
  let data = Data(
    #"{"title":"Legacy","summary":"Summary","keyPoints":["First","Second"],"steps":[]}"#.utf8)
  let story = try JesSeeJSON.decoder().decode(StoryDocument.self, from: data)
  #expect(story.keyPoints.map(\.text) == ["First", "Second"])
  #expect(Set(story.keyPoints.map(\.id)).count == 2)
}

@Test func storyStepsDecodeWithoutRichEditorFields() throws {
  let data = Data(
    #"{"title":"Legacy","summary":"Summary","keyPoints":[],"steps":[{"id":"step-1","startSeconds":0,"endSeconds":2,"title":"Open settings","narrative":"Choose Settings.","transcript":"settings"}]}"#
      .utf8)
  let story = try JesSeeJSON.decoder().decode(StoryDocument.self, from: data)
  #expect(story.steps.first?.narrativeHTML == nil)
  #expect(story.steps.first?.imageAnnotations.isEmpty == true)
}

@Test func storySummaryHTMLIsBackwardCompatibleAndRoundTrips() throws {
  let legacy = Data(#"{"title":"Legacy","summary":"Summary","keyPoints":[],"steps":[]}"#.utf8)
  #expect(try JesSeeJSON.decoder().decode(StoryDocument.self, from: legacy).summaryHTML == nil)

  let story = StoryDocument(
    title: "Rich summary", summary: "Read this first.",
    summaryHTML: "<p>Read <strong>this</strong> first.</p>", keyPoints: [], steps: [])
  let decoded = try JesSeeJSON.decoder().decode(
    StoryDocument.self, from: JesSeeJSON.encoder().encode(story))
  #expect(decoded.summaryHTML == story.summaryHTML)
}

@Test func workspaceKeepsImportedMediaAndHistory() async throws {
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }
  let source = temporary.appendingPathComponent("walkthrough.mp4")
  try Data("video".utf8).write(to: source)

  let workspace = CaptureWorkspace(rootURL: temporary)
  _ = try await workspace.load()
  let record = try await workspace.importMedia(from: source, source: .importedVideo)
  #expect(FileManager.default.fileExists(atPath: workspace.mediaURL(for: record).path))

  let reloaded = CaptureWorkspace(rootURL: temporary)
  let history = try await reloaded.load()
  #expect(history.count == 1)
  #expect(history.first?.title == "walkthrough")
}

@Test @MainActor func rendererCreatesOneLongPDFAndEditableHTML() throws {
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }
  let story = StoryDocument(
    title: "A clearer workflow",
    summary: "The finished explanation stands on its own.",
    summaryHTML: "<p>The finished explanation <strong>stands</strong> on its own.</p>",
    keyPoints: ["Capture the intent", "Keep the evidence"],
    steps: [
      StoryStep(
        startSeconds: 0, endSeconds: 4, title: "Start here",
        narrative: "Explain the desired outcome directly.", transcript: "")
    ]
  )
  let output = try DocumentRenderer.render(story: story, in: temporary)
  let document = PDFDocument(url: temporary.appendingPathComponent(output.pdf))
  #expect(document?.pageCount == 1)
  #expect(
    try String(contentsOf: temporary.appendingPathComponent(output.html), encoding: .utf8).contains(
      "<strong>stands</strong>"))
}

@Test func mediaToolsReadVideoExtractAudioAndCreateFrames() async throws {
  let ffmpeg = URL(fileURLWithPath: "/opt/homebrew/bin/ffmpeg")
  guard FileManager.default.isExecutableFile(atPath: ffmpeg.path) else { return }
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }
  let video = temporary.appendingPathComponent("sample.mp4")
  let process = Process()
  process.executableURL = ffmpeg
  process.arguments = [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "2", "-pix_fmt", "yuv420p", "-c:v", "h264", "-c:a", "aac", video.path,
  ]
  try process.run()
  process.waitUntilExit()
  #expect(process.terminationStatus == 0)

  let details = try await MediaTools.inspect(video)
  #expect(details.hasAudio)
  #expect(details.duration > 1.8)
  let audio = temporary.appendingPathComponent("audio.m4a")
  try await MediaTools.extractAudio(from: video, to: audio)
  #expect(FileManager.default.fileExists(atPath: audio.path))
  let frames = try await MediaTools.extractFrames(
    from: video, times: [0.5, 1.5], to: temporary.appendingPathComponent("frames"))
  #expect(frames.count == 2)
}
