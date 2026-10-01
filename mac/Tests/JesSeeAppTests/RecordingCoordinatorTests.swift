import Foundation
@preconcurrency import ScreenCaptureKit
import Testing

@testable import JesSeeApp

@MainActor
private final class PickerHarness {
  var observers: [any SCContentSharingPickerObserver] = []
  var dismissals = 0

  func makeRecorder(
    selectionTimeout: Duration = .seconds(60), startupTimeout: Duration = .seconds(60)
  ) -> RecordingCoordinator {
    RecordingCoordinator(
      selectionTimeout: selectionTimeout, startupTimeout: startupTimeout,
      presentPicker: { self.observers.append($0) },
      dismissPicker: { _ in self.dismissals += 1 })
  }
}

@Suite(.serialized) @MainActor
struct RecordingCoordinatorTests {
  @Test func cancelAndRetryReopenSelectionWithANewAttempt() throws {
    let picker = PickerHarness()
    let recorder = picker.makeRecorder()
    recorder.chooseWhatToRecord()
    let firstAttempt = try #require(recorder.recordingAttemptID)
    #expect(recorder.state == .choosingRecording)
    recorder.chooseWhatToRecord()
    #expect(picker.observers.count == 1)

    recorder.retryRecording()
    #expect(picker.dismissals == 1)
    #expect(picker.observers.count == 2)
    #expect(recorder.recordingAttemptID != firstAttempt)
    #expect(recorder.state == .choosingRecording)

    recorder.cancelRecordingSetup()
    #expect(recorder.state == .idle)
    #expect(recorder.recordingAttemptID == nil)
    #expect(recorder.startedAt == nil)
    #expect(picker.dismissals == 2)
  }

  @Test func missingPickerCallbackTimesOutAndCanRetry() async throws {
    let picker = PickerHarness()
    let recorder = picker.makeRecorder(selectionTimeout: .milliseconds(10))
    recorder.chooseWhatToRecord()
    try await Task.sleep(for: .milliseconds(50))
    guard case .failed(let message) = recorder.state else {
      Issue.record("Missing picker callback did not time out")
      return
    }
    #expect(message.contains("Screen selection"))
    #expect(picker.dismissals == 1)
    #expect(recorder.canRetryRecording)
    recorder.retryRecording()
    #expect(recorder.state == .choosingRecording)
    recorder.cancelRecordingSetup()
  }

  @Test func missingRecordingStartCallbackTimesOutAndCanCancel() async throws {
    let picker = PickerHarness()
    let recorder = picker.makeRecorder(startupTimeout: .milliseconds(10))
    recorder.chooseWhatToRecord()
    let attempt = try #require(recorder.recordingAttemptID)
    #expect(recorder.beginRecordingStartup(attemptID: attempt))
    #expect(recorder.state == .startingRecording)
    #expect(!recorder.beginRecordingStartup(attemptID: attempt))
    try await Task.sleep(for: .milliseconds(50))
    guard case .failed(let message) = recorder.state else {
      Issue.record("Missing recording-start callback did not time out")
      return
    }
    #expect(message.contains("Recording did not start"))
    recorder.cancelRecordingSetup()
    #expect(recorder.state == .idle)
  }

  @Test func latePickerCallbacksCannotCancelOrFailANewerAttempt() async throws {
    let picker = PickerHarness()
    let recorder = picker.makeRecorder()
    recorder.chooseWhatToRecord()
    let oldObserver = try #require(picker.observers.first)
    let oldAttempt = try #require(recorder.recordingAttemptID)
    // Queue these while on the main actor, then retry before they are handled.
    oldObserver.contentSharingPicker(SCContentSharingPicker.shared, didCancelFor: nil)
    oldObserver.contentSharingPickerStartDidFailWithError(NSError(domain: "old", code: 1))
    recorder.retryRecording()
    let newAttempt = recorder.recordingAttemptID
    try await Task.sleep(for: .milliseconds(20))
    #expect(recorder.state == .choosingRecording)
    #expect(recorder.recordingAttemptID == newAttempt)
    #expect(!recorder.beginRecordingStartup(attemptID: oldAttempt))
    recorder.cancelRecordingSetup()
  }

  @Test func pickerCancellationAfterSelectionCannotResetStartup() async throws {
    let picker = PickerHarness()
    let recorder = picker.makeRecorder()
    recorder.chooseWhatToRecord()
    let observer = try #require(picker.observers.first)
    let attempt = try #require(recorder.recordingAttemptID)
    #expect(recorder.beginRecordingStartup(attemptID: attempt))
    observer.contentSharingPicker(SCContentSharingPicker.shared, didCancelFor: nil)
    observer.contentSharingPickerStartDidFailWithError(NSError(domain: "picker", code: 1))
    try await Task.sleep(for: .milliseconds(20))
    #expect(recorder.state == .startingRecording)
    recorder.retryRecording()
    #expect(recorder.state == .choosingRecording)
    recorder.cancelRecordingSetup()
  }

  @Test func canceledStartupTimeoutCannotFailARetry() async throws {
    let picker = PickerHarness()
    let recorder = picker.makeRecorder(startupTimeout: .milliseconds(10))
    recorder.chooseWhatToRecord()
    let attempt = try #require(recorder.recordingAttemptID)
    #expect(recorder.beginRecordingStartup(attemptID: attempt))
    recorder.retryRecording()
    try await Task.sleep(for: .milliseconds(50))
    #expect(recorder.state == .choosingRecording)
    recorder.cancelRecordingSetup()
  }

  @Test func abandonedOutputCallbacksCannotStartFinishOrFailRecording() async throws {
    let picker = PickerHarness()
    let recorder = picker.makeRecorder()
    recorder.chooseWhatToRecord()
    let attempt = try #require(recorder.recordingAttemptID)
    #expect(recorder.beginRecordingStartup(attemptID: attempt))
    recorder.retryRecording()
    let configuration = SCRecordingOutputConfiguration()
    configuration.outputURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("Unused-\(UUID().uuidString).mp4")
    let oldOutput = SCRecordingOutput(configuration: configuration, delegate: recorder)
    var published = false
    recorder.onFinished = { _ in published = true }
    recorder.recordingOutputDidStartRecording(oldOutput)
    recorder.recordingOutputDidFinishRecording(oldOutput)
    recorder.recordingOutput(oldOutput, didFailWithError: NSError(domain: "old", code: 1))
    try await Task.sleep(for: .milliseconds(20))
    #expect(recorder.state == .choosingRecording)
    #expect(recorder.startedAt == nil)
    #expect(!published)
    recorder.cancelRecordingSetup()
  }
}
