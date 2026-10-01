import AVFoundation
import Accelerate
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
    var sourceURL: String?
  }

  enum State: Equatable {
    case idle
    case choosingRecording
    case startingRecording
    case choosingScreenshot
    case recording
    case stopping
    case failed(String)
  }

  @Published private(set) var state: State = .idle
  @Published private(set) var startedAt: Date?

  var overlayModel: RecordingOverlayModel { overlay.model }

  var onFinished: ((Result) -> Void)?
  var onScreenshotCaptured: ((ScreenshotResult) -> Void)?
  var onStopRequested: (() -> Void)?

  private let presentPicker: (any SCContentSharingPickerObserver) -> Void
  private let dismissPicker: (any SCContentSharingPickerObserver) -> Void
  private let selectionTimeout: Duration
  private let startupTimeout: Duration
  private var pickerObserver: RecordingPickerObserver?
  private var timeoutTask: Task<Void, Never>?
  private final class RecordingAttempt {
    let id = UUID()
    var isCanceled = false
  }
  private var recordingAttempt: RecordingAttempt?
  var recordingAttemptID: UUID? { recordingAttempt?.id }
  private var lastCaptureWasRecording = true
  private var stream: SCStream?
  private var recordingOutput: SCRecordingOutput?
  private var outputURL: URL?
  private var discardCurrentRecording = false
  private let overlay = RecordingOverlayController()
  private let microphoneQueue = DispatchQueue(label: "ai.polyform.jessee.microphone-meter")
  private var recordingContentRect: CGRect = .zero
  private var recordingDisplayID: CGDirectDisplayID?
  private var pendingBrowserApplication: BrowserApplicationContext?
  private var pendingScreenshotSourceURL: String?
  private var recordingSourceURL: String?

  init(
    selectionTimeout: Duration = .seconds(90),
    startupTimeout: Duration = .seconds(30),
    presentPicker: @escaping (any SCContentSharingPickerObserver) -> Void = { observer in
      let picker = SCContentSharingPicker.shared
      var configuration = SCContentSharingPickerConfiguration()
      configuration.allowedPickerModes = [.singleDisplay, .singleWindow, .singleApplication]
      configuration.excludedBundleIDs = [Bundle.main.bundleIdentifier ?? "ai.polyform.jessee"]
      configuration.allowsChangingSelectedContent = false
      picker.defaultConfiguration = configuration
      picker.maximumStreamCount = 1
      picker.add(observer)
      picker.isActive = true
      picker.present()
    },
    dismissPicker: @escaping (any SCContentSharingPickerObserver) -> Void = { observer in
      let picker = SCContentSharingPicker.shared
      picker.remove(observer)
      picker.isActive = false
    }
  ) {
    self.selectionTimeout = selectionTimeout
    self.startupTimeout = startupTimeout
    self.presentPicker = presentPicker
    self.dismissPicker = dismissPicker
    super.init()
  }

  func chooseWhatToRecord() {
    guard state == .idle || isFailure else { return }
    lastCaptureWasRecording = true
    let attempt = RecordingAttempt()
    recordingAttempt = attempt
    let attemptID = attempt.id
    pendingBrowserApplication = BrowserURLReader.frontmostSupportedBrowser()
    state = .choosingRecording
    let observer = RecordingPickerObserver(coordinator: self, attemptID: attemptID)
    pickerObserver = observer
    scheduleTimeout(
      after: selectionTimeout, attemptID: attemptID, expectedState: .choosingRecording,
      message: "Screen selection did not finish. Retry to reopen the screen picker, or cancel.")
    presentPicker(observer)
  }

  var canRetryRecording: Bool {
    state == .choosingRecording || state == .startingRecording
      || (isFailure && lastCaptureWasRecording)
  }

  func retryRecording() {
    guard canRetryRecording else { return }
    cancelRecordingSetup()
    chooseWhatToRecord()
  }

  func cancelRecordingSetup() {
    guard canRetryRecording else { return }
    resetRecording()
    state = .idle
  }

  func chooseScreenshot() {
    guard state == .idle || isFailure else { return }
    lastCaptureWasRecording = false
    pendingBrowserApplication = BrowserURLReader.frontmostSupportedBrowser()
    pendingScreenshotSourceURL = pendingBrowserApplication.flatMap {
      BrowserURLReader.currentPage(for: $0)?.url
    }
    state = .choosingScreenshot
    Task { await captureInteractiveScreenshot() }
  }

  func stop() {
    stop(notifyUser: true)
  }

  private func stop(notifyUser: Bool) {
    guard state == .recording, let stream else { return }
    state = .stopping
    overlay.setStopping()
    if notifyUser { onStopRequested?() }
    Task {
      do { try await stream.stopCapture() } catch {
        guard self.stream === stream else { return }
        finishWithError(error.localizedDescription)
      }
    }
  }

  func redo() {
    guard state == .recording else { return }
    discardCurrentRecording = true
    stop(notifyUser: false)
  }

  func dismissError() {
    if isFailure {
      resetRecording()
      state = .idle
    }
  }

  private var isFailure: Bool {
    if case .failed = state { return true }
    return false
  }

  // Change state before awaiting macOS so duplicate selections cannot create two streams.
  func beginRecordingStartup(attemptID: UUID) -> Bool {
    guard recordingAttemptID == attemptID, state == .choosingRecording else { return false }
    state = .startingRecording
    scheduleTimeout(
      after: startupTimeout, attemptID: attemptID, expectedState: .startingRecording,
      message: "Recording did not start. Check any macOS permission prompts, then retry or cancel.")
    return true
  }

  fileprivate func startRecording(filter: SCContentFilter, attemptID: UUID) async {
    guard beginRecordingStartup(attemptID: attemptID), let attempt = recordingAttempt else {
      return
    }
    let microphoneAllowed = await AVCaptureDevice.requestAccess(for: .audio)
    guard recordingAttemptID == attemptID, state == .startingRecording else { return }
    guard microphoneAllowed else {
      finishWithError(
        "Microphone access is needed to narrate a recording. Enable JesSee in System Settings → Privacy & Security → Microphone, then retry.")
      return
    }
    recordingSourceURL = selectedSourceURL(for: filter)
    recordingContentRect = filter.contentRect
    if #available(macOS 15.2, *) {
      recordingDisplayID = filter.includedDisplays.first?.displayID
      // contentRect can be local to the capture. The overlay needs global screen coordinates.
      if filter.style == .window, let window = filter.includedWindows.first {
        recordingContentRect = window.frame
      } else if filter.style == .display, let display = filter.includedDisplays.first {
        recordingContentRect = display.frame
      }
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
    // Window shadows add pixels outside the bounds used by the drawing overlay.
    streamConfiguration.ignoreShadowsSingleWindow = true

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
      // Cancellation can race with startCapture; stop again if it completed after cancellation.
      if attempt.isCanceled {
        try? await stream.stopCapture()
        try? FileManager.default.removeItem(at: tempURL)
      }
    } catch {
      guard recordingAttemptID == attemptID else {
        if attempt.isCanceled { try? FileManager.default.removeItem(at: tempURL) }
        return
      }
      finishWithError(error.localizedDescription)
    }
  }

  private func scheduleTimeout(
    after duration: Duration, attemptID: UUID, expectedState: State, message: String
  ) {
    timeoutTask?.cancel()
    timeoutTask = Task { [weak self] in
      do { try await Task.sleep(for: duration) } catch { return }
      guard let self, self.recordingAttemptID == attemptID, self.state == expectedState else {
        return
      }
      self.finishWithError(message)
    }
  }

  private func resetRecording() {
    let abandonedStream = stream
    let abandonedURL = outputURL
    recordingAttempt?.isCanceled = true
    recordingAttempt = nil
    timeoutTask?.cancel()
    timeoutTask = nil
    if let observer = pickerObserver { dismissPicker(observer) }
    pickerObserver = nil
    overlay.cancel()
    startedAt = nil
    stream = nil
    recordingOutput = nil
    outputURL = nil
    pendingBrowserApplication = nil
    pendingScreenshotSourceURL = nil
    recordingSourceURL = nil
    discardCurrentRecording = false
    recordingContentRect = .zero
    recordingDisplayID = nil
    // Clear identity first so callbacks from the stopped stream cannot affect a retry.
    Task {
      if let abandonedStream { try? await abandonedStream.stopCapture() }
      if let abandonedURL { try? FileManager.default.removeItem(at: abandonedURL) }
    }
  }

  fileprivate func finishWithError(_ message: String) {
    resetRecording()
    state = .failed(message)
  }

  private func completeRecording() {
    let finishedURL = outputURL
    let shouldRedo = discardCurrentRecording
    let markups = overlay.finish()
    let sourceURL = recordingSourceURL
    recordingAttempt = nil
    timeoutTask?.cancel()
    timeoutTask = nil
    if let observer = pickerObserver { dismissPicker(observer) }
    pickerObserver = nil
    state = .idle
    startedAt = nil
    stream = nil
    recordingOutput = nil
    outputURL = nil
    discardCurrentRecording = false
    recordingSourceURL = nil
    pendingBrowserApplication = nil

    if shouldRedo {
      if let finishedURL { try? FileManager.default.removeItem(at: finishedURL) }
      chooseWhatToRecord()
    } else if let finishedURL {
      onFinished?(Result(url: finishedURL, markups: markups, sourceURL: sourceURL))
    }
  }

  private func captureInteractiveScreenshot() async {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("JesSee-Screenshot-\(UUID().uuidString).png")
    do {
      _ = try await Self.runSystemScreenshotCapture(at: url)
      guard FileManager.default.fileExists(atPath: url.path) else {
        pendingBrowserApplication = nil
        pendingScreenshotSourceURL = nil
        state = .idle
        return
      }
      let sourceURL = pendingScreenshotSourceURL
      pendingBrowserApplication = nil
      pendingScreenshotSourceURL = nil
      state = .idle
      onScreenshotCaptured?(ScreenshotResult(url: url, sourceURL: sourceURL))
    } catch {
      try? FileManager.default.removeItem(at: url)
      finishWithError(error.localizedDescription)
    }
  }

  private nonisolated static func runSystemScreenshotCapture(at url: URL) async throws -> Int32 {
    try await Task.detached(priority: .userInitiated) {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
      process.arguments = ["-i", "-Jselection", "-t", "png", url.path]
      try process.run()
      process.waitUntilExit()
      return process.terminationStatus
    }.value
  }

  private func selectedSourceURL(for filter: SCContentFilter) -> String? {
    defer { pendingBrowserApplication = nil }
    guard #available(macOS 15.2, *),
      let application = pendingBrowserApplication,
      let context = BrowserURLReader.currentPage(for: application)
    else { return nil }
    if !filter.includedWindows.isEmpty {
      guard let windowID = context.windowID else { return nil }
      return filter.includedWindows.contains(where: { $0.windowID == windowID })
        ? context.url : nil
    }
    if filter.includedApplications.contains(where: {
      $0.processID == context.application.processIdentifier
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

// A fresh observer captures each attempt's identity, including callbacks already queued at cancel.
private final class RecordingPickerObserver: NSObject, SCContentSharingPickerObserver {
  private weak var coordinator: RecordingCoordinator?
  private let attemptID: UUID

  init(coordinator: RecordingCoordinator, attemptID: UUID) {
    self.coordinator = coordinator
    self.attemptID = attemptID
  }

  nonisolated func contentSharingPicker(
    _ picker: SCContentSharingPicker,
    didCancelFor stream: SCStream?
  ) {
    guard stream == nil else { return }
    Task { @MainActor [weak coordinator, attemptID] in
      guard let coordinator, coordinator.recordingAttemptID == attemptID,
        coordinator.state == .choosingRecording
      else { return }
      coordinator.cancelRecordingSetup()
    }
  }

  nonisolated func contentSharingPicker(
    _ picker: SCContentSharingPicker,
    didUpdateWith filter: SCContentFilter,
    for stream: SCStream?
  ) {
    guard stream == nil else { return }
    Task { @MainActor [weak coordinator, attemptID] in
      await coordinator?.startRecording(filter: filter, attemptID: attemptID)
    }
  }

  nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
    Task { @MainActor [weak coordinator, attemptID] in
      guard let coordinator, coordinator.recordingAttemptID == attemptID,
        coordinator.state == .choosingRecording
      else { return }
      coordinator.finishWithError(error.localizedDescription)
    }
  }
}

extension RecordingCoordinator: SCRecordingOutputDelegate {
  nonisolated func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    Task { @MainActor [self] in
      guard self.recordingOutput === recordingOutput, self.state == .startingRecording else {
        return
      }
      self.timeoutTask?.cancel()
      self.timeoutTask = nil
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
    Task { @MainActor in
      guard self.recordingOutput === recordingOutput else { return }
      self.finishWithError(error.localizedDescription)
    }
  }

  nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    Task { @MainActor in
      guard self.recordingOutput === recordingOutput else { return }
      guard self.state == .recording || self.state == .stopping else {
        self.finishWithError("Recording ended before it could start. Retry or cancel.")
        return
      }
      self.completeRecording()
    }
  }
}

extension RecordingCoordinator: SCStreamDelegate {
  nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
    Task { @MainActor in
      guard self.stream === stream else { return }
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
    Task { @MainActor in
      guard self.stream === stream, self.state == .recording else { return }
      self.overlay.updateMicLevel(level)
    }
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
