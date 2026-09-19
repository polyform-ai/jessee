import AVFoundation
import Accelerate
import AppKit
import CoreVideo
import Foundation
import JesSeeCore
@preconcurrency import ScreenCaptureKit

@MainActor
final class RecordingCoordinator: NSObject, ObservableObject {
  struct Result {
    var url: URL
    var markups: [RecordingMarkupStroke]
    var sourceURL: String?
  }

  struct ScreenshotResult {
    var url: URL
  }

  enum State: Equatable {
    case idle
    case choosingRecording
    case choosingScreenshot
    case capturingScreenshot
    case recording
    case stopping
    case failed(String)
  }

  @Published private(set) var state: State = .idle
  @Published private(set) var startedAt: Date?

  var overlayModel: RecordingOverlayModel { overlay.model }

  var onFinished: ((Result) -> Void)?
  var onScreenshotCaptured: ((ScreenshotResult) -> Void)?

  private let picker = SCContentSharingPicker.shared
  private var stream: SCStream?
  private var recordingOutput: SCRecordingOutput?
  private var outputURL: URL?
  private var discardCurrentRecording = false
  private let overlay = RecordingOverlayController()
  private let microphoneQueue = DispatchQueue(label: "ai.polyform.jessee.microphone-meter")
  private var recordingContentRect: CGRect = .zero
  private var recordingDisplayID: CGDirectDisplayID?
  private var pendingPageContext: BrowserPageContext?
  private var recordingSourceURL: String?

  override init() {
    super.init()
    picker.add(self)
    var configuration = SCContentSharingPickerConfiguration()
    configuration.allowedPickerModes = [.singleDisplay, .singleWindow, .singleApplication]
    configuration.excludedBundleIDs = [Bundle.main.bundleIdentifier ?? "ai.polyform.jessee"]
    configuration.allowsChangingSelectedContent = false
    picker.defaultConfiguration = configuration
    picker.maximumStreamCount = 1
    picker.isActive = true
  }

  func chooseWhatToRecord() {
    guard state == .idle || isFailure else { return }
    pendingPageContext = BrowserURLReader.currentPage()
    state = .choosingRecording
    picker.present()
  }

  func chooseScreenshot() {
    guard state == .idle || isFailure else { return }
    pendingPageContext = nil
    state = .choosingScreenshot
    picker.present()
  }

  func stop() {
    guard state == .recording, let stream else { return }
    state = .stopping
    overlay.setStopping()
    Task {
      do { try await stream.stopCapture() } catch { finishWithError(error.localizedDescription) }
    }
  }

  func redo() {
    guard state == .recording else { return }
    discardCurrentRecording = true
    stop()
  }

  func dismissError() {
    if isFailure { state = .idle }
  }

  private var isFailure: Bool {
    if case .failed = state { return true }
    return false
  }

  private func startRecording(filter: SCContentFilter) async {
    recordingSourceURL = selectedSourceURL(for: filter)
    recordingContentRect = filter.contentRect
    if #available(macOS 15.2, *) {
      recordingDisplayID = filter.includedDisplays.first?.displayID
    } else {
      recordingDisplayID = nil
    }
    let streamConfiguration = SCStreamConfiguration()
    let dimensions = CaptureDimensions.fitted(
      pointWidth: Double(filter.contentRect.width),
      pointHeight: Double(filter.contentRect.height),
      pointPixelScale: Double(filter.pointPixelScale)
    )
    streamConfiguration.width = dimensions.width
    streamConfiguration.height = dimensions.height
    streamConfiguration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    streamConfiguration.queueDepth = 5
    streamConfiguration.pixelFormat = kCVPixelFormatType_32BGRA
    streamConfiguration.showsCursor = true
    streamConfiguration.showMouseClicks = true
    streamConfiguration.capturesAudio = false
    streamConfiguration.captureMicrophone = true

    let tempURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("JesSee-\(UUID().uuidString).mp4")
    let outputConfiguration = SCRecordingOutputConfiguration()
    outputConfiguration.outputURL = tempURL
    outputConfiguration.outputFileType = .mp4
    outputConfiguration.videoCodecType = .h264

    let stream = SCStream(filter: filter, configuration: streamConfiguration, delegate: self)
    let output = SCRecordingOutput(configuration: outputConfiguration, delegate: self)
    do {
      try stream.addRecordingOutput(output)
      try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: microphoneQueue)
      self.stream = stream
      recordingOutput = output
      outputURL = tempURL
      discardCurrentRecording = false
      try await stream.startCapture()
    } catch {
      finishWithError(error.localizedDescription)
    }
  }

  private func finishWithError(_ message: String) {
    if let outputURL { try? FileManager.default.removeItem(at: outputURL) }
    overlay.cancel()
    state = .failed(message)
    startedAt = nil
    stream = nil
    recordingOutput = nil
    outputURL = nil
    pendingPageContext = nil
    recordingSourceURL = nil
  }

  private func completeRecording() {
    let finishedURL = outputURL
    let shouldRedo = discardCurrentRecording
    let markups = overlay.finish()
    let sourceURL = recordingSourceURL
    state = .idle
    startedAt = nil
    stream = nil
    recordingOutput = nil
    outputURL = nil
    discardCurrentRecording = false
    recordingSourceURL = nil

    if shouldRedo {
      if let finishedURL { try? FileManager.default.removeItem(at: finishedURL) }
      chooseWhatToRecord()
    } else if let finishedURL {
      onFinished?(Result(url: finishedURL, markups: markups, sourceURL: sourceURL))
    }
  }

  private func captureScreenshot(filter: SCContentFilter) async {
    state = .capturingScreenshot
    let dimensions = CaptureDimensions.fitted(
      pointWidth: Double(filter.contentRect.width),
      pointHeight: Double(filter.contentRect.height),
      pointPixelScale: Double(filter.pointPixelScale)
    )
    let configuration = SCStreamConfiguration()
    configuration.width = dimensions.width
    configuration.height = dimensions.height
    configuration.showsCursor = false
    do {
      let image = try await SCScreenshotManager.captureImage(
        contentFilter: filter, configuration: configuration)
      let representation = NSBitmapImageRep(cgImage: image)
      guard let data = representation.representation(using: .png, properties: [:]) else {
        throw JesSeeError.invalidResponse("JesSee could not create the screenshot image.")
      }
      let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("JesSee-Screenshot-\(UUID().uuidString).png")
      try data.write(to: url, options: .atomic)
      state = .idle
      onScreenshotCaptured?(ScreenshotResult(url: url))
    } catch {
      finishWithError(error.localizedDescription)
    }
  }

  private func selectedSourceURL(for filter: SCContentFilter) -> String? {
    defer { pendingPageContext = nil }
    guard let context = pendingPageContext else { return nil }
    guard #available(macOS 15.2, *) else { return context.url }
    if !filter.includedWindows.isEmpty {
      guard let windowID = context.windowID else { return nil }
      return filter.includedWindows.contains(where: { $0.windowID == windowID })
        ? context.url : nil
    }
    if filter.includedApplications.contains(where: {
      $0.bundleIdentifier == context.bundleIdentifier
    }) {
      return context.url
    }
    if let displayID = context.displayID,
      filter.includedDisplays.contains(where: { $0.displayID == displayID })
    {
      return context.url
    }
    return nil
  }
}

extension RecordingCoordinator: SCContentSharingPickerObserver {
  nonisolated func contentSharingPicker(
    _ picker: SCContentSharingPicker,
    didCancelFor stream: SCStream?
  ) {
    Task { @MainActor in
      self.pendingPageContext = nil
      self.state = .idle
    }
  }

  nonisolated func contentSharingPicker(
    _ picker: SCContentSharingPicker,
    didUpdateWith filter: SCContentFilter,
    for stream: SCStream?
  ) {
    Task { @MainActor in
      switch self.state {
      case .choosingScreenshot:
        await self.captureScreenshot(filter: filter)
      case .choosingRecording:
        await self.startRecording(filter: filter)
      default:
        break
      }
    }
  }

  nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
    Task { @MainActor in self.finishWithError(error.localizedDescription) }
  }
}

extension RecordingCoordinator: SCRecordingOutputDelegate {
  nonisolated func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    Task { @MainActor [self] in
      let startedAt = Date()
      self.startedAt = startedAt
      self.state = .recording
      self.overlay.start(
        contentRect: self.recordingContentRect,
        displayID: self.recordingDisplayID,
        startedAt: startedAt,
        onStop: { [weak self] in self?.stop() },
        onRedo: { [weak self] in self?.redo() })
    }
  }

  nonisolated func recordingOutput(
    _ recordingOutput: SCRecordingOutput, didFailWithError error: any Error
  ) {
    Task { @MainActor in self.finishWithError(error.localizedDescription) }
  }

  nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    Task { @MainActor in self.completeRecording() }
  }
}

extension RecordingCoordinator: SCStreamDelegate {
  nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
    Task { @MainActor in
      if self.state != .stopping { self.finishWithError(error.localizedDescription) }
    }
  }
}

extension RecordingCoordinator: SCStreamOutput {
  nonisolated func stream(
    _ stream: SCStream,
    didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of outputType: SCStreamOutputType
  ) {
    guard outputType == .microphone, sampleBuffer.isValid,
      let level = Self.microphoneLevel(in: sampleBuffer)
    else { return }
    Task { @MainActor in self.overlay.updateMicLevel(level) }
  }

  nonisolated private static func microphoneLevel(in sampleBuffer: CMSampleBuffer) -> Double? {
    var result: Double?
    try? sampleBuffer.withAudioBufferList { audioBufferList, _ in
      guard
        let description = sampleBuffer.formatDescription?.audioStreamBasicDescription,
        let format = AVAudioFormat(
          standardFormatWithSampleRate: description.mSampleRate,
          channels: description.mChannelsPerFrame),
        let samples = AVAudioPCMBuffer(
          pcmFormat: format,
          bufferListNoCopy: audioBufferList.unsafePointer),
        let channel = samples.floatChannelData?.pointee,
        samples.frameLength > 0
      else { return }
      var meanSquare: Float = 0
      vDSP_measqv(channel, 1, &meanSquare, vDSP_Length(samples.frameLength))
      let decibels = 20 * log10(max(sqrt(Double(meanSquare)), 0.000_01))
      result = max(0, min(1, (decibels + 55) / 55))
    }
    return result
  }
}
