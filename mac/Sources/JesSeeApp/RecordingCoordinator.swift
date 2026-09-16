import AVFoundation
import CoreVideo
import Foundation
@preconcurrency import ScreenCaptureKit

@MainActor
final class RecordingCoordinator: NSObject, ObservableObject {
  enum State: Equatable {
    case idle
    case choosing
    case recording
    case stopping
    case failed(String)
  }

  @Published private(set) var state: State = .idle
  @Published private(set) var startedAt: Date?

  var onFinished: ((URL) -> Void)?

  private let picker = SCContentSharingPicker.shared
  private var stream: SCStream?
  private var recordingOutput: SCRecordingOutput?
  private var outputURL: URL?
  private var discardCurrentRecording = false

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
    state = .choosing
    picker.present()
  }

  func stop() {
    guard state == .recording, let stream else { return }
    state = .stopping
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
    let streamConfiguration = SCStreamConfiguration()
    streamConfiguration.width = 2560
    streamConfiguration.height = 1440
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
    state = .failed(message)
    startedAt = nil
    stream = nil
    recordingOutput = nil
    outputURL = nil
  }

  private func completeRecording() {
    let finishedURL = outputURL
    let shouldRedo = discardCurrentRecording
    state = .idle
    startedAt = nil
    stream = nil
    recordingOutput = nil
    outputURL = nil
    discardCurrentRecording = false

    if shouldRedo {
      if let finishedURL { try? FileManager.default.removeItem(at: finishedURL) }
      chooseWhatToRecord()
    } else if let finishedURL {
      onFinished?(finishedURL)
    }
  }
}

extension RecordingCoordinator: SCContentSharingPickerObserver {
  nonisolated func contentSharingPicker(
    _ picker: SCContentSharingPicker,
    didCancelFor stream: SCStream?
  ) {
    Task { @MainActor in self.state = .idle }
  }

  nonisolated func contentSharingPicker(
    _ picker: SCContentSharingPicker,
    didUpdateWith filter: SCContentFilter,
    for stream: SCStream?
  ) {
    Task { @MainActor in await self.startRecording(filter: filter) }
  }

  nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
    Task { @MainActor in self.finishWithError(error.localizedDescription) }
  }
}

extension RecordingCoordinator: SCRecordingOutputDelegate {
  nonisolated func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    Task { @MainActor in
      self.startedAt = Date()
      self.state = .recording
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
