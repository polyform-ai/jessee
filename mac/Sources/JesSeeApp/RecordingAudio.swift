import AVFoundation
import Foundation
import SwiftUI

struct RecordingAudioInput: Identifiable, Sendable, Equatable {
  var id: String
  var name: String

  static func available() -> [Self] {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified
    ).devices.map { Self(id: $0.uniqueID, name: $0.localizedName) }
  }
}

struct MicrophoneCaptureHealth {
  private(set) var startedAt: Date = .now
  private(set) var lastSignalAt: Date?

  mutating func reset(at now: Date) {
    startedAt = now
    lastSignalAt = nil
  }

  mutating func receive(rms: Double, at now: Date) {
    if rms.isFinite, rms > 0.0001 { lastSignalAt = now }
  }

  func isSilent(at now: Date) -> Bool {
    now.timeIntervalSince(lastSignalAt ?? startedAt) >= (lastSignalAt == nil ? 8 : 15)
  }
}

@MainActor
final class RecordingAudioModel: ObservableObject {
  @Published private(set) var inputs: [RecordingAudioInput] = []
  @Published var selectedInputID = ""
  @Published private(set) var defaultInputName = "System microphone"
  @Published var activeInputName = "System default"
  @Published var level: Double = 0
  @Published var warning: String?
  @Published var isSwitchingInput = false

  func refreshInputs() {
    inputs = RecordingAudioInput.available()
    defaultInputName = AVCaptureDevice.default(for: .audio)?.localizedName ?? "Unavailable"
  }

  static func resolveInput(
    preferredID: String, defaultID: String?, inputs: [RecordingAudioInput]
  ) -> RecordingAudioInput? {
    let id = preferredID.isEmpty ? defaultID : preferredID
    return inputs.first { $0.id == id }
  }

  func resolvedInput() -> RecordingAudioInput? {
    Self.resolveInput(
      preferredID: selectedInputID, defaultID: AVCaptureDevice.default(for: .audio)?.uniqueID,
      inputs: inputs)
  }
}

struct MicrophoneInputPicker: View {
  @ObservedObject var audio: RecordingAudioModel
  var onSelect: (String) -> Void

  var body: some View {
    Picker("Microphone", selection: Binding(
      get: { audio.selectedInputID }, set: { onSelect($0) }
    )) {
      Text("System default (\(audio.defaultInputName))").tag("")
      ForEach(audio.inputs) { input in Text(input.name).tag(input.id) }
      if !audio.selectedInputID.isEmpty,
        !audio.inputs.contains(where: { $0.id == audio.selectedInputID })
      {
        Text("Selected microphone unavailable").tag(audio.selectedInputID)
      }
    }
    .disabled(audio.isSwitchingInput)
    .onAppear { audio.refreshInputs() }
    .help("Choose the microphone JesSee records. Speak and check the level meter.")
  }
}

struct RecordingMicrophonePicker: View {
  @ObservedObject var recorder: RecordingCoordinator

  var body: some View {
    MicrophoneInputPicker(audio: recorder.audio, onSelect: recorder.selectMicrophone)
      .disabled(!recorder.canSelectMicrophone)
  }
}
