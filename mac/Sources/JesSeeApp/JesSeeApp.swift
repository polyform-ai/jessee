import JesSeeCore
import SwiftUI

@main
struct JesSeeMacApp: App {
  @StateObject private var store = AppStore()
  private let softwareUpdates = SoftwareUpdateController.shared

  var body: some Scene {
    MenuBarExtra {
      MenuPopoverView(store: store)
    } label: {
      RecorderMenuIcon(store: store)
    }
    .menuBarExtraStyle(.window)

    Window("Welcome to JesSee", id: "welcome") {
      WelcomeView(store: store)
    }
    .defaultSize(width: 520, height: 600)
    .defaultLaunchBehavior(store.isConfigured ? .suppressed : .presented)

    Window("JesSee Library", id: "library") {
      LibraryView(store: store)
    }
    .defaultSize(width: 1040, height: 720)
    .defaultLaunchBehavior(.suppressed)

    Settings {
      SettingsView(store: store)
    }
  }
}

private struct RecorderMenuIcon: View {
  @ObservedObject var store: AppStore
  @ObservedObject private var recorder: RecordingCoordinator
  @Environment(\.openWindow) private var openWindow
  @Environment(\.openSettings) private var openSettings
  @State private var handledLaunchRequest = false

  init(store: AppStore) {
    self.store = store
    self._recorder = ObservedObject(wrappedValue: store.recorder)
  }

  var body: some View {
    Group {
      if store.isSavingScreenshot {
        Label("JesSee is saving a screenshot", systemImage: "arrow.down.circle.fill")
      } else {
        switch recorder.state {
        case .recording, .stopping:
          Label("JesSee is recording", systemImage: "record.circle.fill")
        case .choosingRecording, .choosingScreenshot:
          Label("JesSee is choosing a screen", systemImage: "rectangle.dashed.badge.record")
        default:
          Label("JesSee", systemImage: "viewfinder.circle.fill")
        }
      }
    }
    .task {
      guard !handledLaunchRequest else { return }
      if ProcessInfo.processInfo.arguments.contains("--open-settings") {
        handledLaunchRequest = true
        openSettings()
      } else if ProcessInfo.processInfo.arguments.contains("--open-library") {
        handledLaunchRequest = true
        openWindow(id: "library")
      } else if store.isConfigured {
        handledLaunchRequest = true
        openWindow(id: "library")
      } else {
        return
      }
      NSApp.activate(ignoringOtherApps: true)
    }
    .onChange(of: store.readyCaptureID) { _, captureID in
      guard let captureID else { return }
      store.selectedCaptureID = captureID
      openWindow(id: "library")
      NSApp.activate(ignoringOtherApps: true)
      store.consumeReadyCapture(captureID)
    }
  }

}
