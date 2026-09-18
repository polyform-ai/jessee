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
      RecorderMenuIcon(recorder: store.recorder)
    }
    .menuBarExtraStyle(.window)

    Window("Welcome to JesSee", id: "welcome") {
      WelcomeView(store: store)
    }
    .defaultSize(width: 500, height: 470)
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
  @ObservedObject var recorder: RecordingCoordinator
  @Environment(\.openWindow) private var openWindow
  @Environment(\.openSettings) private var openSettings
  @State private var handledLaunchRequest = false

  var body: some View {
    Group {
      switch recorder.state {
      case .recording, .stopping:
        Label("JesSee is recording", systemImage: "record.circle.fill")
      case .choosing:
        Label("JesSee is choosing a screen", systemImage: "rectangle.dashed.badge.record")
      default:
        Label("JesSee", systemImage: "viewfinder.circle.fill")
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
      } else {
        return
      }
      NSApp.activate(ignoringOtherApps: true)
    }
  }
}
