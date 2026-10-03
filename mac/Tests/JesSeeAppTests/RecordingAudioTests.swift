import Foundation
import Testing
@testable import JesSeeApp

@Test func microphoneHealthWarnsForMissingSamplesAndResetsOnSignalOrSwitch() {
  let start = Date(timeIntervalSince1970: 100)
  var health = MicrophoneCaptureHealth()
  health.reset(at: start)
  #expect(!health.isSilent(at: start.addingTimeInterval(7)))
  #expect(health.isSilent(at: start.addingTimeInterval(8)))
  health.receive(rms: 0, at: start.addingTimeInterval(9))
  #expect(health.isSilent(at: start.addingTimeInterval(9)))
  health.receive(rms: 0.01, at: start.addingTimeInterval(10))
  #expect(!health.isSilent(at: start.addingTimeInterval(24)))
  #expect(health.isSilent(at: start.addingTimeInterval(25)))
  health.reset(at: start.addingTimeInterval(30))
  #expect(!health.isSilent(at: start.addingTimeInterval(37)))
}

@Test @MainActor func missingPreferredInputNeverFallsBackToAnUnrelatedMicrophone() {
  let inputs = [RecordingAudioInput(id: "builtin", name: "Mac microphone"),
    RecordingAudioInput(id: "usb", name: "USB microphone")]
  #expect(RecordingAudioModel.resolveInput(preferredID: "usb", defaultID: "builtin", inputs: inputs)?.id == "usb")
  #expect(RecordingAudioModel.resolveInput(preferredID: "", defaultID: "builtin", inputs: inputs)?.id == "builtin")
  #expect(RecordingAudioModel.resolveInput(preferredID: "airpods-disconnected", defaultID: "builtin", inputs: inputs) == nil)
  #expect(RecordingAudioModel.resolveInput(preferredID: "", defaultID: nil, inputs: inputs) == nil)
}
