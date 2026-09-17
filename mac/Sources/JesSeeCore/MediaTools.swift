import AVFoundation
import AppKit
import Foundation

public struct MediaDetails: Sendable, Equatable {
  public var duration: Double
  public var hasAudio: Bool

  public init(duration: Double, hasAudio: Bool) {
    self.duration = duration
    self.hasAudio = hasAudio
  }
}

public struct CapturedFrame: Sendable, Equatable {
  public var seconds: Double
  public var filename: String
  public var hasVisibleMarkup: Bool

  public init(seconds: Double, filename: String, hasVisibleMarkup: Bool = false) {
    self.seconds = seconds
    self.filename = filename
    self.hasVisibleMarkup = hasVisibleMarkup
  }
}

public enum MediaTools {
  public static func inspect(_ url: URL) async throws -> MediaDetails {
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration).seconds
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    return MediaDetails(duration: max(duration, 0), hasAudio: !tracks.isEmpty)
  }

  public static func extractAudio(from mediaURL: URL, to audioURL: URL) async throws {
    let asset = AVURLAsset(url: mediaURL)
    guard !(try await asset.loadTracks(withMediaType: .audio)).isEmpty else {
      throw JesSeeError.mediaHasNoAudio
    }
    guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A)
    else {
      throw JesSeeError.invalidResponse("JesSee could not prepare the recording's audio.")
    }
    if FileManager.default.fileExists(atPath: audioURL.path) {
      try FileManager.default.removeItem(at: audioURL)
    }
    try await exporter.export(to: audioURL, as: .m4a)
  }

  public static func frameTimes(
    duration: Double,
    segments: [TranscriptSegment],
    notableTimes: [Double] = [],
    maximum: Int = 18
  )
    -> [Double]
  {
    guard duration > 0, maximum > 0 else { return [] }
    let candidates: [Double]
    if segments.isEmpty {
      let count = min(maximum, max(1, Int(ceil(duration / 8))))
      candidates = (0..<count).map { index in
        min(duration - 0.05, (Double(index) + 0.5) * duration / Double(count))
      }
    } else {
      candidates = segments.map { max(0, min(duration - 0.05, ($0.start + $0.end) / 2)) }
    }

    let notable = notableTimes.map { max(0, min(duration - 0.05, $0 + 0.05)) }
      .sorted()
      .reduce(into: [Double]()) { result, time in
        if result.last.map({ abs($0 - time) >= 0.4 }) ?? true { result.append(time) }
      }
    if notable.count >= maximum { return evenlySampled(notable, count: maximum) }

    let narrative = candidates.sorted().reduce(into: [Double]()) { result, time in
      guard !notable.contains(where: { abs($0 - time) < 0.8 }) else { return }
      if result.last.map({ abs($0 - time) >= 1.0 }) ?? true { result.append(time) }
    }
    let remaining = maximum - notable.count
    let selectedNarrative =
      narrative.count > remaining ? evenlySampled(narrative, count: remaining) : narrative
    return (notable + selectedNarrative).sorted()
  }

  public static func extractFrames(
    from mediaURL: URL,
    times: [Double],
    to directoryURL: URL,
    maximumWidth: CGFloat = 1920,
    recordingMarkups: [RecordingMarkupStroke] = []
  ) async throws -> [CapturedFrame] {
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    let asset = AVURLAsset(url: mediaURL)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: maximumWidth, height: maximumWidth)
    generator.requestedTimeToleranceBefore = CMTime(seconds: 0.35, preferredTimescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.35, preferredTimescale: 600)

    var frames: [CapturedFrame] = []
    for (index, seconds) in times.enumerated() {
      let image = try await generator.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
        .image
      let markedImage = applyMarkups(recordingMarkups, at: seconds, to: image)
      let bitmap = NSBitmapImageRep(cgImage: markedImage)
      guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.88])
      else {
        continue
      }
      let filename = String(format: "frame-%03d.jpg", index + 1)
      try data.write(to: directoryURL.appendingPathComponent(filename), options: .atomic)
      frames.append(
        CapturedFrame(
          seconds: seconds,
          filename: "screenshots/\(filename)",
          hasVisibleMarkup: recordingMarkups.contains {
            $0.isVisible(at: seconds) && $0.points.count > 1
          }))
    }
    return frames
  }

  public static func srt(from transcript: TranscriptDocument) -> String {
    transcript.segments.enumerated().map { index, segment in
      "\(index + 1)\n\(captionTime(segment.start, decimal: ",")) --> \(captionTime(segment.end, decimal: ","))\n\(segment.text.trimmingCharacters(in: .whitespacesAndNewlines))\n"
    }.joined(separator: "\n")
  }

  public static func vtt(from transcript: TranscriptDocument) -> String {
    let body = transcript.segments.map { segment in
      "\(captionTime(segment.start, decimal: ".")) --> \(captionTime(segment.end, decimal: "."))\n\(segment.text.trimmingCharacters(in: .whitespacesAndNewlines))"
    }.joined(separator: "\n\n")
    return "WEBVTT\n\n\(body)\n"
  }

  public static func nearestFrame(to seconds: Double, frames: [CapturedFrame]) -> CapturedFrame? {
    frames.min { abs($0.seconds - seconds) < abs($1.seconds - seconds) }
  }

  static func applyMarkups(
    _ markups: [RecordingMarkupStroke], at seconds: Double, to image: CGImage
  ) -> CGImage {
    let visible = markups.filter { $0.isVisible(at: seconds) && $0.points.count > 1 }
    guard !visible.isEmpty,
      let context = CGContext(
        data: nil,
        width: image.width,
        height: image.height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return image }

    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    context.draw(image, in: bounds)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    for markup in visible {
      let path = CGMutablePath()
      let first = markup.points[0]
      path.move(
        to: CGPoint(
          x: clamped(first.x) * bounds.width,
          y: (1 - clamped(first.y)) * bounds.height))
      for point in markup.points.dropFirst() {
        path.addLine(
          to: CGPoint(
            x: clamped(point.x) * bounds.width,
            y: (1 - clamped(point.y)) * bounds.height))
      }
      switch markup.kind {
      case .pen:
        context.setStrokeColor(NSColor.systemRed.cgColor)
        context.setLineWidth(max(5, bounds.width * 0.0045))
      case .highlight:
        context.setStrokeColor(NSColor.systemYellow.withAlphaComponent(0.48).cgColor)
        context.setLineWidth(max(18, bounds.width * 0.018))
      }
      context.addPath(path)
      context.strokePath()
    }
    return context.makeImage() ?? image
  }

  private static func clamped(_ value: Double) -> CGFloat {
    CGFloat(max(0, min(1, value)))
  }

  private static func evenlySampled(_ values: [Double], count: Int) -> [Double] {
    guard count > 0, values.count > count else { return count > 0 ? values : [] }
    guard count > 1 else { return [values[values.count / 2]] }
    return (0..<count).map { index in
      let position = Double(index) * Double(values.count - 1) / Double(count - 1)
      return values[Int(position.rounded())]
    }
  }

  private static func captionTime(_ value: Double, decimal: Character) -> String {
    let totalMilliseconds = max(0, Int((value * 1000).rounded()))
    let hours = totalMilliseconds / 3_600_000
    let minutes = (totalMilliseconds / 60_000) % 60
    let seconds = (totalMilliseconds / 1_000) % 60
    let milliseconds = totalMilliseconds % 1_000
    return String(
      format: "%02d:%02d:%02d%c%03d", hours, minutes, seconds, String(decimal).utf8.first!,
      milliseconds)
  }
}
