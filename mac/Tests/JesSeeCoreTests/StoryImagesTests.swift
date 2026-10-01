import AppKit
import Foundation
import PDFKit
import Testing
@testable import JesSeeCore

@Test func sectionPhotosRoundTripWithoutChangingLegacyImages() throws {
  let mark = StoryAnnotation(kind: .redaction, x: 0.2, y: 0.6, width: 0.2, height: 0.1)
  let step = StoryStep(startSeconds: 1, endSeconds: 9, title: "Evidence", narrative: "Two views",
    transcript: "", imageFilename: "first.png", additionalImages: [StoryImage(filename: "second.png", annotations: [mark])])
  let decoded = try JesSeeJSON.decoder().decode(StoryStep.self, from: JesSeeJSON.encoder().encode(step))
  #expect(decoded == step)
  #expect(decoded.images.map(\.filename) == ["first.png", "second.png"])
  #expect(decoded.images[0].annotations.isEmpty)
  #expect(decoded.images[1].annotations == [mark])
  let legacy = Data(#"{"startSeconds":0,"endSeconds":2,"title":"Legacy","narrative":"Text","transcript":"","imageFilename":"first.png","imageAnnotations":[]}"#.utf8)
  #expect(try JesSeeJSON.decoder().decode(StoryStep.self, from: legacy).images == [StoryImage(filename: "first.png")])
  let story = StoryDocument(title: "Photos", summary: "Summary", keyPoints: [], steps: [step])
  var changed = story
  changed.steps[0].additionalImages[0].annotations = []
  #expect(story.pdfPublicationState != changed.pdfPublicationState)
  #expect(story.primaryImagePublicationState() == changed.primaryImagePublicationState())
  #expect(StoryEfficiencyMetrics.estimate(story: story, duration: 20).documentTokens > 2 * StoryEfficiencyMetrics.imageTokens)
  let legacyState = try JesSeeJSON.encoder().encode(StoryDocument(title: "Legacy", summary: "", keyPoints: [], steps: []).pdfPublicationState)
  #expect(try JesSeeJSON.decoder().decode(StoryPDFPublicationState.self, from: legacyState).entries.isEmpty)
}

@Test func sectionBoundaryChoicesIncludeOneAndTwoSecondsBeforeAndAfter() {
  let story = StoryDocument(title: "Frames", summary: "", keyPoints: [], steps: [
    StoryStep(startSeconds: 5, endSeconds: 20, title: "Section", narrative: "", transcript: "")])
  #expect(MediaTools.sectionBoundaryFrameTimes(for: story, duration: 30) == [3, 4, 5, 6, 7, 18, 19, 20, 21, 22])
  #expect(MediaTools.sectionBoundaryFrameTimes(for: story, duration: 0).isEmpty)
  let clipped = MediaTools.sectionBoundaryFrameTimes(for: story, duration: 6)
  #expect(clipped.allSatisfy { $0 >= 0 && $0 < 6 })
  #expect(Set(clipped).count == clipped.count)
}

@Test func olderRecordingsGetNearbyFramesOnceWithoutLosingSavedEditsOrLinks() async throws {
  let ffmpeg = URL(fileURLWithPath: "/opt/homebrew/bin/ffmpeg")
  guard FileManager.default.isExecutableFile(atPath: ffmpeg.path) else { return }
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let video = directory.appendingPathComponent("source.mp4")
  let process = Process()
  process.executableURL = ffmpeg
  process.arguments = ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=5",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", video.path]
  try process.run()
  process.waitUntilExit()
  #expect(process.terminationStatus == 0)
  let workspace = CaptureWorkspace(rootURL: directory)
  _ = try await workspace.load()
  var record = try await workspace.importMedia(from: video, source: .recording)
  record.duration = 5
  record.title = "Saved edits"
  record.storyFilename = "edited-story.json"
  record.publicPDFURL = "https://example.com/existing.pdf"
  try await workspace.save(record)
  let story = StoryDocument(title: "Saved edits", summary: "", keyPoints: [], steps: [
    StoryStep(startSeconds: 1, endSeconds: 3, title: "Section", narrative: "Edited text", transcript: "")])
  let updatedValue = try await workspace.prepareImageChoices(for: record.id, story: story)
  let updated = try #require(updatedValue)
  #expect(updated.imageFilenames.count == 6)
  #expect(updated.title == record.title)
  #expect(updated.storyFilename == record.storyFilename)
  #expect(updated.publicPDFURL == record.publicPDFURL)
  for filename in updated.imageFilenames {
    #expect(FileManager.default.fileExists(atPath: workspace.directoryURL(for: updated).appendingPathComponent(filename).path))
  }
  let repeated = try await workspace.prepareImageChoices(for: record.id, story: story)
  #expect(repeated?.imageFilenames == updated.imageFilenames)
}

@Test @MainActor func multiplePhotosAndTheirAnnotationsRenderInOrder() throws {
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let directory = ProcessInfo.processInfo.environment["JESSEE_PDF_QA_DIRECTORY"].map { URL(fileURLWithPath: $0) } ?? temporary
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { if directory == temporary { try? FileManager.default.removeItem(at: temporary) } }
  for (filename, color) in [("first.png", NSColor.systemBlue), ("second.png", NSColor.systemGreen)] {
    let image = NSImage(size: NSSize(width: 800, height: 400))
    image.lockFocus()
    color.setFill()
    NSRect(x: 0, y: 0, width: 800, height: 400).fill()
    NSColor.white.setFill()
    NSRect(x: 160, y: 120, width: 240, height: 40).fill()
    image.unlockFocus()
    let tiff = try #require(image.tiffRepresentation)
    let bitmap = try #require(NSBitmapImageRep(data: tiff))
    try #require(bitmap.representation(using: .png, properties: [:])).write(to: directory.appendingPathComponent(filename))
  }
  let redaction = StoryAnnotation(kind: .redaction, x: 0.2, y: 0.6, width: 0.3, height: 0.1)
  let story = StoryDocument(title: "Two photos in one section", summary: "Each photo keeps its own markup.", keyPoints: [], steps: [
    StoryStep(startSeconds: 5, endSeconds: 10, title: "Before and after", narrative: "Blue first, green second.", transcript: "",
      imageFilename: "first.png", imageAnnotations: [redaction],
      additionalImages: [StoryImage(filename: "second.png", annotations: [redaction])])])
  let output = try DocumentRenderer.render(story: story, in: directory)
  let html = try String(contentsOf: directory.appendingPathComponent(output.html), encoding: .utf8)
  #expect(html.components(separatedBy: "<figure").count == 3)
  let firstRange = try #require(html.range(of: "src=\"first.png\""))
  let secondRange = try #require(html.range(of: "src=\"second.png\""))
  #expect(firstRange.lowerBound < secondRange.lowerBound)
  let document = try #require(PDFDocument(url: directory.appendingPathComponent(output.pdf)))
  let page = try #require(document.page(at: 0))
  let pageImage = page.thumbnail(of: page.bounds(for: .mediaBox).size, for: .mediaBox)
  let tiff = try #require(pageImage.tiffRepresentation)
  let bitmap = try #require(NSBitmapImageRep(data: tiff))
  if directory != temporary {
    try #require(bitmap.representation(using: .png, properties: [:])).write(to: directory.appendingPathComponent("preview.png"))
  }
  // Find the two colored image bands in the actual rasterized PDF, then verify markup is at the
  // same top-origin position in both photos rather than vertically mirrored or shifted.
  let middle = bitmap.pixelsWide * 3 / 4
  var bands: [(Int, Int)] = []
  var start: Int?
  for y in 0..<bitmap.pixelsHigh {
    let color = bitmap.colorAt(x: middle, y: y)?.usingColorSpace(.deviceRGB)
    let colored = color.map {
      ($0.blueComponent > 0.7 || $0.greenComponent > 0.6)
        && max($0.blueComponent, $0.greenComponent) - $0.redComponent > 0.3
    } ?? false
    if colored, start == nil { start = y }
    if !colored, let beginning = start {
      if y - beginning > 100 { bands.append((beginning, y)) }
      start = nil
    }
  }
  #expect(bands.count == 2)
  for (top, bottom) in bands {
    let y = top + Int(Double(bottom - top) * 0.65)
    let x = Int(Double(bitmap.pixelsWide) * (64 + 0.35 * 664) / 792)
    let color = try #require(bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB))
    #expect(color.redComponent < 0.2 && color.greenComponent < 0.2 && color.blueComponent < 0.2)
  }
}
