import AppKit
import AVFoundation
import Foundation
import Testing
@testable import JesSeeCore

private func waveFile(withSignal: Bool) throws -> URL {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID()).wav")
  var pcm = Data()
  for index in 0..<32_000 {
    // Exercise late, quiet speech in only the second channel after initial silence.
    for channel in 0..<2 {
      var sample = Int16(withSignal && index > 24_000 && channel == 1
        ? sin(Double(index) * 0.1) * 32 : 0).littleEndian
      withUnsafeBytes(of: &sample) { pcm.append(contentsOf: $0) }
    }
  }
  var data = Data()
  func text(_ value: String) { data.append(contentsOf: value.utf8) }
  func integer<T: FixedWidthInteger>(_ value: T) {
    var little = value.littleEndian
    withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
  }
  text("RIFF"); integer(UInt32(36 + pcm.count)); text("WAVEfmt ")
  integer(UInt32(16)); integer(UInt16(1)); integer(UInt16(2))
  integer(UInt32(16_000)); integer(UInt32(64_000))
  integer(UInt16(4)); integer(UInt16(16))
  text("data"); integer(UInt32(pcm.count)); data.append(pcm)
  try data.write(to: url)
  return url
}

@Test func silentTrackIsRejectedAndQuietLateSecondChannelSignalIsAccepted() async throws {
  let silent = try waveFile(withSignal: false)
  let quiet = try waveFile(withSignal: true)
  defer { try? FileManager.default.removeItem(at: silent); try? FileManager.default.removeItem(at: quiet) }
  await #expect(throws: JesSeeError.mediaHasSilentAudio) {
    try await AudioSignal.requireSignal(in: silent)
  }
  try await AudioSignal.requireSignal(in: quiet)
  #expect(!CaptureProcessingRetryPolicy.shouldRetry(JesSeeError.mediaHasSilentAudio))
}

@Test func silentRecordingNeverReachesTheTranscriptionService() async throws {
  let silent = try waveFile(withSignal: false)
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: silent); try? FileManager.default.removeItem(at: root) }
  let workspace = CaptureWorkspace(rootURL: root)
  _ = try await workspace.load()
  let record = try await workspace.importMedia(from: silent, source: .recording)
  let processor = CaptureProcessor(workspace: workspace, service: .openAI(
    client: DirectOpenAIClient(), apiKey: "unused-never-sent"))
  await #expect(throws: JesSeeError.mediaHasSilentAudio) {
    try await processor.process(recordID: record.id)
  }
  #expect(FileManager.default.fileExists(atPath: workspace.mediaURL(for: record).path))
  #expect(!FileManager.default.fileExists(atPath:
    workspace.directoryURL(for: record).appendingPathComponent("transcript.json").path))
}

@Test func recordingGeometryRoundTripsAndLegacyConfigurationKeepsSystemDefault() throws {
  let geometry = RecordingFrameGeometry(
    seconds: 2, contentRect: CGRect(x: 25, y: 50, width: 400, height: 200),
    scaleFactor: 2, surfaceSize: CGSize(width: 1000, height: 600))
  #expect(RecordingFrameGeometry.contentRect(at: 1, in: [geometry])
    == CGRect(x: 0, y: 0, width: 1, height: 1))
  #expect(RecordingFrameGeometry.contentRect(at: 2, in: [geometry])
    == CGRect(x: 0.05, y: 1.0 / 6, width: 0.8, height: 2.0 / 3))
  let record = CaptureRecord(title: "New", source: .recording, mediaFilename: "recording.mp4",
    recordingGeometry: [geometry])
  let decoded = try JesSeeJSON.decoder().decode(CaptureRecord.self, from: JesSeeJSON.encoder().encode(record))
  #expect(decoded.recordingGeometry == [geometry])
  let legacy = try JesSeeJSON.decoder().decode(JesSeeConfiguration.self, from: Data("{}".utf8))
  #expect(legacy.microphoneInputID == nil)
  let preference = JesSeeConfiguration(microphoneInputID: "usb-mic")
  #expect(try JesSeeJSON.decoder().decode(JesSeeConfiguration.self,
    from: JesSeeJSON.encoder().encode(preference)).microphoneInputID == "usb-mic")
}

@Test @MainActor func markupPixelsRespectVideoPaddingAndChangingContentBounds() throws {
  let context = try #require(CGContext(data: nil, width: 1000, height: 600, bitsPerComponent: 8,
    bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
  context.setFillColor(NSColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: 1000, height: 600))
  let image = try #require(context.makeImage())
  let strokes = [RecordingMarkupStroke(kind: .pen,
    points: [.init(x: 0.25, y: 0.25), .init(x: 0.35, y: 0.25)], createdAtSeconds: 0)]
  let frames = [
    RecordingFrameGeometry(seconds: 0, contentRect: CGRect(x: 100, y: 60, width: 800, height: 400),
      scaleFactor: 1, surfaceSize: CGSize(width: 1000, height: 600)),
    RecordingFrameGeometry(seconds: 1, contentRect: CGRect(x: 0, y: 0, width: 1000, height: 600),
      scaleFactor: 1, surfaceSize: CGSize(width: 1000, height: 600))]
  for (seconds, x, y) in [(0.0, 340, 160), (1.0, 300, 150)] {
    let rendered = MediaTools.applyMarkups(strokes, at: seconds, to: image,
      contentRect: RecordingFrameGeometry.contentRect(at: seconds, in: frames))
    let bitmap = NSBitmapImageRep(cgImage: rendered)
    let pixel = try #require(bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB))
    #expect(pixel.redComponent > 0.8 && pixel.greenComponent < 0.5)
    let outside = try #require(bitmap.colorAt(x: x, y: y + 30)?.usingColorSpace(.deviceRGB))
    #expect(outside.greenComponent > 0.9)
  }
}

@Test(arguments: ["int16", "int32", "float32", "float64"])
func microphoneMeterReadsStereoDevicePCMFormats(format: String) throws {
  let bits: UInt32 = format == "int16" ? 16 : format == "float64" ? 64 : 32
  let isFloat = format.hasPrefix("float")
  let bytes = bits / 8
  var description = AudioStreamBasicDescription(mSampleRate: 48000,
    mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: (isFloat ? kAudioFormatFlagIsFloat : kAudioFormatFlagIsSignedInteger) | kAudioFormatFlagIsPacked,
    mBytesPerPacket: bytes * 2, mFramesPerPacket: 1, mBytesPerFrame: bytes * 2,
    mChannelsPerFrame: 2, mBitsPerChannel: bits, mReserved: 0)
  var pcm = Data()
  func append<T>(_ value: T) {
    var value = value
    withUnsafeBytes(of: &value) { pcm.append(contentsOf: $0) }
  }
  for _ in 0..<2 {
    switch format {
    case "int16": append(Int16(0)); append(Int16(8192))
    case "int32": append(Int32(0)); append(Int32(536870912))
    case "float32": append(Float(0)); append(Float(0.25))
    default: append(Double(0)); append(Double(0.25))
    }
  }
  var audioDescription: CMAudioFormatDescription?
  #expect(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault,
    asbd: &description, layoutSize: 0, layout: nil, magicCookieSize: 0,
    magicCookie: nil, extensions: nil, formatDescriptionOut: &audioDescription) == noErr)
  var block: CMBlockBuffer?
  #expect(CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil,
    blockLength: pcm.count, blockAllocator: kCFAllocatorDefault, customBlockSource: nil,
    offsetToData: 0, dataLength: pcm.count, flags: 0, blockBufferOut: &block) == noErr)
  let dataBlock = try #require(block)
  pcm.withUnsafeBytes { pointer in
    #expect(CMBlockBufferReplaceDataBytes(with: pointer.baseAddress!, blockBuffer: dataBlock,
      offsetIntoDestination: 0, dataLength: pcm.count) == noErr)
  }
  var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000),
    presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
  var sample: CMSampleBuffer?
  #expect(CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: dataBlock,
    formatDescription: audioDescription, sampleCount: 2, sampleTimingEntryCount: 1,
    sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil,
    sampleBufferOut: &sample) == noErr)
  let buffer = try #require(sample)
  let rms = try #require(AudioSignal.rms(in: buffer))
  #expect(abs(rms - 0.25 / sqrt(2)) < 0.000001)
}
