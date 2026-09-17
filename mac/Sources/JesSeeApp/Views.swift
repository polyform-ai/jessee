import AppKit
import JesSeeCore
import SwiftUI

private let accent = Color(red: 0.35, green: 0.32, blue: 1.0)

struct MenuPopoverView: View {
  @ObservedObject var store: AppStore
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    VStack(spacing: 0) {
      HeaderView(store: store, openLibrary: { openWindow(id: "library") })
      Divider()
      Group {
        if store.isConfigured {
          HomeView(store: store, openLibrary: { openWindow(id: "library") })
        } else {
          SetupView(store: store)
        }
      }
      .padding(18)
    }
    .frame(width: 390)
    .background(Color(nsColor: .windowBackgroundColor))
    .overlay(alignment: .top) { NoticeView(notice: store.notice).padding(.top, 58) }
  }
}

private struct HeaderView: View {
  @ObservedObject var store: AppStore
  let openLibrary: () -> Void

  var body: some View {
    HStack(spacing: 11) {
      ZStack {
        RoundedRectangle(cornerRadius: 10).fill(accent.gradient)
        Image(systemName: "viewfinder").font(.system(size: 19, weight: .bold)).foregroundStyle(
          .white)
      }
      .frame(width: 36, height: 36)
      VStack(alignment: .leading, spacing: 1) {
        Text("JesSee").font(.headline)
        Text("Turn a walkthrough into a story").font(.caption).foregroundStyle(.secondary)
      }
      Spacer()
      if store.isConfigured {
        Button(action: openLibrary) { Image(systemName: "books.vertical") }.help("Open Library")
        Button(action: SoftwareUpdateController.shared.checkForUpdates) {
          Image(systemName: "arrow.triangle.2.circlepath")
        }.help("Check for Updates")
        Button(action: store.openSettings) { Image(systemName: "gearshape") }.help("Settings")
        Button {
          NSApp.terminate(nil)
        } label: {
          Image(systemName: "power")
        }.help("Quit JesSee")
      }
    }
    .buttonStyle(.borderless)
    .padding(14)
  }
}

private struct HomeView: View {
  @ObservedObject var store: AppStore
  @ObservedObject private var recorder: RecordingCoordinator
  let openLibrary: () -> Void

  init(store: AppStore, openLibrary: @escaping () -> Void) {
    self.store = store
    self.recorder = store.recorder
    self.openLibrary = openLibrary
  }

  var body: some View {
    VStack(spacing: 16) {
      switch recorder.state {
      case .recording, .stopping:
        RecordingControls(recorder: recorder)
      case .choosing:
        StatusCard(
          icon: "rectangle.dashed.badge.record", title: "Choose what to share",
          detail: "Pick one window, app, or display in the system panel.")
      case .failed(let message):
        StatusCard(
          icon: "exclamationmark.triangle", title: "Recording did not start", detail: message,
          action: recorder.dismissError)
      case .idle:
        StartCard(store: store)
      }

      GuideView()
      RecentCapturesView(store: store, openLibrary: openLibrary)
    }
  }
}

private struct StartCard: View {
  @ObservedObject var store: AppStore

  var body: some View {
    VStack(spacing: 10) {
      Button(action: store.recorder.chooseWhatToRecord) {
        Label("Start a recording", systemImage: "record.circle.fill")
          .frame(maxWidth: .infinity).padding(.vertical, 7)
      }
      .buttonStyle(.borderedProminent).tint(accent).controlSize(.large)
      Button(action: store.importVideo) {
        Label("Import a video", systemImage: "square.and.arrow.down")
          .frame(maxWidth: .infinity).padding(.vertical, 4)
      }
      .buttonStyle(.bordered).controlSize(.large)
    }
  }
}

private struct RecordingControls: View {
  @ObservedObject var recorder: RecordingCoordinator
  @ObservedObject private var overlayModel: RecordingOverlayModel

  init(recorder: RecordingCoordinator) {
    self.recorder = recorder
    self.overlayModel = recorder.overlayModel
  }

  var body: some View {
    VStack(spacing: 14) {
      HStack {
        Circle().fill(.red).frame(width: 10, height: 10)
        Text("Recording").font(.headline)
        MicrophoneMeter(level: overlayModel.micLevel)
        Spacer()
        RecordingElapsedTime(startedAt: recorder.startedAt ?? .now)
          .font(.title3.weight(.semibold))
      }
      HStack(spacing: 10) {
        Button(action: recorder.redo) { Label("Redo", systemImage: "arrow.counterclockwise") }
          .buttonStyle(.bordered).disabled(recorder.state == .stopping)
          .keyboardShortcut("r", modifiers: .command)
        Button(action: recorder.stop) {
          Label("Stop & process", systemImage: "stop.fill").frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent).tint(.red).disabled(recorder.state == .stopping)
        .keyboardShortcut("s", modifiers: .option)
        .help("Stop and process (⌥S)")
      }
      Text("Floating controls: ⌥D draw · ⌥H highlight · ⌥Z undo · ⌥C clear · ⌥S stop")
        .font(.caption2).foregroundStyle(.secondary)
    }
    .padding(16)
    .background(.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 16))
  }

}

private struct GuideView: View {
  private let steps = [
    ("1", "Frame it", "Say what you want the reader to understand."),
    ("2", "Show it", "Move through the important states at a steady pace."),
    ("3", "Land it", "Finish with the decision, request, or next step."),
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("A simple recording guide").font(.subheadline.weight(.semibold))
      ForEach(steps, id: \.0) { step in
        HStack(alignment: .top, spacing: 10) {
          Text(step.0).font(.caption.weight(.bold)).foregroundStyle(accent)
            .frame(width: 22, height: 22).background(accent.opacity(0.12), in: Circle())
          VStack(alignment: .leading, spacing: 1) {
            Text(step.1).font(.subheadline.weight(.semibold))
            Text(step.2).font(.caption).foregroundStyle(.secondary).fixedSize(
              horizontal: false, vertical: true)
          }
        }
      }
    }
    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14))
  }
}

private struct RecentCapturesView: View {
  @ObservedObject var store: AppStore
  let openLibrary: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Recent").font(.subheadline.weight(.semibold))
        Spacer()
        if !store.captures.isEmpty { Button("See all", action: openLibrary).buttonStyle(.link) }
      }
      if store.recentCaptures.isEmpty {
        Text("Your recordings and imported videos will appear here.")
          .font(.caption).foregroundStyle(.secondary).padding(.vertical, 8)
      } else {
        ForEach(store.recentCaptures) { record in CaptureRow(record: record, store: store) }
      }
    }
  }
}

private struct CaptureRow: View {
  let record: CaptureRecord
  @ObservedObject var store: AppStore

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: record.source == .recording ? "record.circle" : "film")
        .foregroundStyle(record.stage == .failed ? .red : accent)
      VStack(alignment: .leading, spacing: 2) {
        Text(record.title).lineLimit(1).font(.subheadline.weight(.medium))
        Text(record.stage.label).font(.caption).foregroundStyle(
          record.stage == .failed ? .red : .secondary)
      }
      Spacer()
      if record.stage.isProcessing { ProgressView().controlSize(.small) }
      Menu {
        if record.pdfFilename != nil { Button("Open PDF") { store.openPDF(record) } }
        Button("Show in Finder") { store.reveal(record) }
        if record.stage == .failed { Button("Try again") { store.retry(record) } }
      } label: {
        Image(systemName: "ellipsis")
      }.menuStyle(.borderlessButton)
    }
    .padding(.vertical, 4)
  }
}

struct SetupView: View {
  @ObservedObject var store: AppStore
  var onFinished: (() -> Void)? = nil

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Set up JesSee").font(.title2.weight(.bold))
        Text("Four quick steps, then JesSee lives in your menu bar.")
          .font(.subheadline).foregroundStyle(.secondary)
      }
      SetupProgress(step: store.setupStep)
      Group {
        switch store.setupStep {
        case 0: APIKeyStep(store: store)
        case 1: EmailStep(store: store)
        case 2: FolderStep(store: store)
        default: MicrophoneStep(store: store, onFinished: onFinished)
        }
      }
      .padding(16).background(
        Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 16))
    }
  }
}

private struct SetupProgress: View {
  let step: Int
  private let labels = ["Key", "Email", "Folder", "Mic"]
  var body: some View {
    HStack(spacing: 5) {
      ForEach(labels.indices, id: \.self) { index in
        VStack(spacing: 5) {
          Capsule().fill(index <= step ? accent : .gray.opacity(0.2)).frame(height: 4)
          Text(labels[index]).font(.caption2).foregroundStyle(index == step ? .primary : .secondary)
        }
      }
    }
  }
}

private struct APIKeyStep: View {
  @ObservedObject var store: AppStore
  @State private var key = ""
  @State private var errorMessage: String?
  var body: some View {
    VStack(alignment: .leading, spacing: 11) {
      Label("Connect OpenAI", systemImage: "sparkles").font(.headline)
      Text(
        "Your key stays in this Mac's Keychain. Narration and selected screenshots are sent directly to OpenAI for transcription and story creation."
      ).font(.caption).foregroundStyle(.secondary)
      SecureField("sk-…", text: $key).textFieldStyle(.roundedBorder)
      Button(store.isTestingAPI ? "Checking…" : "Save and test") {
        Task {
          errorMessage = nil
          if await store.saveAPIKey(key) {
            key = ""
          } else if case .error(let message) = store.notice {
            errorMessage = message
          }
        }
      }
      .buttonStyle(.borderedProminent).tint(accent).disabled(key.isEmpty || store.isTestingAPI)
      if let errorMessage {
        Label(errorMessage, systemImage: "exclamationmark.circle.fill")
          .font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}

private struct EmailStep: View {
  @ObservedObject var store: AppStore
  @State private var email = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 11) {
      Label("Add your email", systemImage: "envelope").font(.headline)
      Text("Saved in this app's settings to identify your local setup.").font(.caption)
        .foregroundStyle(.secondary)
      TextField("you@company.com", text: $email).textFieldStyle(.roundedBorder)
      Button("Continue") { if store.saveEmail(email) { store.setupStep = 2 } }
        .buttonStyle(.borderedProminent).tint(accent).disabled(email.isEmpty)
    }.onAppear { email = store.configuration.email }
  }
}

private struct FolderStep: View {
  @ObservedObject var store: AppStore
  var body: some View {
    VStack(alignment: .leading, spacing: 11) {
      Label("Choose your library", systemImage: "folder").font(.headline)
      Text(
        "Every recording, transcript, screenshot, and finished story stays in a folder you control."
      ).font(.caption).foregroundStyle(.secondary)
      if !store.configuration.outputFolderPath.isEmpty {
        Text(store.configuration.outputFolderPath).font(.caption).lineLimit(2).padding(8)
          .background(.quaternary, in: RoundedRectangle(cornerRadius: 7))
      }
      Button(store.configuration.outputFolderPath.isEmpty ? "Choose folder" : "Continue") {
        if !store.configuration.outputFolderPath.isEmpty || store.chooseOutputFolder() {
          store.setupStep = 3
        }
      }.buttonStyle(.borderedProminent).tint(accent)
      if !store.configuration.outputFolderPath.isEmpty {
        Button("Choose a different folder") { _ = store.chooseOutputFolder() }.buttonStyle(.link)
      }
    }
  }
}

private struct MicrophoneStep: View {
  @ObservedObject var store: AppStore
  var onFinished: (() -> Void)?
  var body: some View {
    VStack(alignment: .leading, spacing: 11) {
      Label("Enable your microphone", systemImage: "mic").font(.headline)
      Text("JesSee needs your narration to understand the screenshots and build the story.").font(
        .caption
      ).foregroundStyle(.secondary)
      Button(store.microphoneAllowed ? "Finish setup" : "Enable microphone") {
        Task {
          if store.microphoneAllowed {
            store.finishSetup()
            onFinished?()
          } else if await store.requestMicrophone() {
            store.finishSetup()
            onFinished?()
          } else {
            store.openMicrophoneSettings()
          }
        }
      }.buttonStyle(.borderedProminent).tint(accent)
    }
  }
}

private struct StatusCard: View {
  let icon: String
  let title: String
  let detail: String
  var action: (() -> Void)? = nil
  var body: some View {
    VStack(spacing: 9) {
      Image(systemName: icon).font(.system(size: 28)).foregroundStyle(accent)
      Text(title).font(.headline)
      Text(detail).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
      if let action { Button("Try again", action: action).buttonStyle(.bordered) }
    }.frame(maxWidth: .infinity).padding(20).background(
      accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 16))
  }
}

private struct NoticeView: View {
  let notice: AppStore.Notice?
  var body: some View {
    if notice != nil {
      HStack(spacing: 8) {
        Image(systemName: isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
        Text(message).font(.caption.weight(.medium)).lineLimit(2)
      }
      .foregroundStyle(isError ? .red : .green)
      .padding(.horizontal, 12).padding(.vertical, 9)
      .background(.regularMaterial, in: Capsule()).shadow(radius: 8, y: 3).transition(
        .move(edge: .top).combined(with: .opacity))
    }
  }
  private var isError: Bool {
    if case .error = notice { return true }
    return false
  }
  private var message: String {
    switch notice {
    case .success(let value), .error(let value): value
    case nil: ""
    }
  }
}

struct LibraryView: View {
  @ObservedObject var store: AppStore
  @State private var selection: String?

  var body: some View {
    NavigationSplitView {
      List(store.captures, selection: $selection) { record in
        VStack(alignment: .leading, spacing: 3) {
          Text(record.title).lineLimit(1).font(.headline)
          HStack {
            Text(record.createdAt, style: .date)
            Text("·")
            Text(record.stage.label)
          }
          .font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 5).tag(record.id)
      }
      .navigationTitle("Library")
      .toolbar {
        Button(action: store.importVideo) { Label("Import video", systemImage: "plus") }
          .help("Import a video")
      }
    } detail: {
      if let id = selection, let record = store.captures.first(where: { $0.id == id }) {
        CaptureDetailView(store: store, record: record)
      } else {
        ContentUnavailableView(
          "Choose a story", systemImage: "doc.richtext",
          description: Text("Review its steps, images, and saved files."))
      }
    }
    .frame(minWidth: 900, minHeight: 620)
    .onAppear { selection = selection ?? store.captures.first?.id }
  }
}

private struct CaptureDetailView: View {
  private struct LoadedStory {
    let recordID: String
    var document: StoryDocument
  }

  @ObservedObject var store: AppStore
  let record: CaptureRecord
  @State private var loadedStory: LoadedStory?

  var body: some View {
    VStack(spacing: 0) {
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 4) {
          Text(record.title).font(.title2.weight(.bold)).lineLimit(1)
          Label(record.stage.label, systemImage: stageIcon).foregroundStyle(stageColor).font(
            .caption)
        }
        Spacer()
        if record.pdfFilename != nil {
          Button("Open PDF") { store.openPDF(record) }.buttonStyle(.borderedProminent).tint(accent)
        }
        Button("Show in Finder") { store.reveal(record) }
        if record.stage == .failed {
          Button("Try again") { store.retry(record) }.buttonStyle(.borderedProminent).tint(accent)
        }
      }
      .padding(.horizontal, 22).padding(.vertical, 14)
      Divider()

      if let error = record.error {
        Text(error).foregroundStyle(.red).padding(12).frame(
          maxWidth: .infinity, alignment: .leading
        )
        .background(.red.opacity(0.08))
      }

      if let loadedStory, loadedStory.recordID == record.id,
        let directory = store.captureDirectory(for: record)
      {
        StoryWebEditor(story: loadedStory.document, record: record, directoryURL: directory) {
          updatedStory, shouldOpenPDF, completion in
          Task {
            let saved = await store.saveStory(updatedStory, for: record)
            if saved {
              self.loadedStory = LoadedStory(recordID: record.id, document: updatedStory)
              if shouldOpenPDF { store.openPDF(recordID: record.id) }
            }
            completion(
              saved,
              saved
                ? (shouldOpenPDF ? "PDF updated and opened" : "Saved")
                : "JesSee could not save these changes.")
          }
        }
        .id(record.id)
      } else if record.stage.isProcessing {
        VStack(spacing: 14) {
          ProgressView().controlSize(.large)
          Text("JesSee is building the story in the background…").foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ContentUnavailableView(
          "Story not ready", systemImage: "doc.badge.clock",
          description: Text("Try processing this recording again."))
      }
    }
    .task(id: "\(record.id):\(record.storyFilename ?? "")") {
      loadedStory = nil
      let document = await store.loadStory(for: record)
      guard !Task.isCancelled, let document else { return }
      loadedStory = LoadedStory(recordID: record.id, document: document)
    }
  }

  private var stageIcon: String {
    record.stage == .ready
      ? "checkmark.circle.fill"
      : record.stage == .failed ? "exclamationmark.triangle.fill" : "clock.fill"
  }
  private var stageColor: Color {
    record.stage == .ready ? .green : record.stage == .failed ? .red : accent
  }
}

struct WelcomeView: View {
  @ObservedObject var store: AppStore
  @Environment(\.dismissWindow) private var dismissWindow
  var body: some View {
    SetupView(store: store) { dismissWindow(id: "welcome") }
      .padding(30).frame(width: 500, height: 470)
      .overlay(alignment: .top) { NoticeView(notice: store.notice).padding(.top, 16) }
  }
}

struct SettingsView: View {
  @ObservedObject var store: AppStore
  @State private var email = ""
  @State private var key = ""
  @State private var apiSaved = false
  @State private var emailSaved = false
  @State private var apiError: String?
  @State private var emailError: String?

  var body: some View {
    Form {
      Section("OpenAI") {
        SecureField("Replace API key", text: $key)
        Button(store.isTestingAPI ? "Checking…" : "Save and test key") {
          Task {
            apiSaved = await store.saveAPIKey(key)
            if apiSaved {
              key = ""
              apiError = nil
            } else if case .error(let message) = store.notice {
              apiError = message
            }
          }
        }
        .disabled(key.isEmpty || store.isTestingAPI)
        if apiSaved {
          Label("Connected and saved in Keychain", systemImage: "checkmark.circle.fill")
            .font(.caption).foregroundStyle(.green)
        } else if let apiError {
          Label(apiError, systemImage: "exclamationmark.circle.fill")
            .font(.caption).foregroundStyle(.red)
        }
      }
      Section("Account") {
        TextField("Email", text: $email)
        Button("Save email") {
          emailSaved = store.saveEmail(email)
          emailError = nil
          if !emailSaved, case .error(let message) = store.notice { emailError = message }
        }
        if emailSaved {
          Label("Email saved", systemImage: "checkmark.circle.fill")
            .font(.caption).foregroundStyle(.green)
        } else if let emailError {
          Label(emailError, systemImage: "exclamationmark.circle.fill")
            .font(.caption).foregroundStyle(.red)
        }
      }
      Section("Library") {
        Text(
          store.configuration.outputFolderPath.isEmpty
            ? "No folder chosen" : store.configuration.outputFolderPath
        ).font(.caption).textSelection(.enabled)
        Button("Choose a different folder") { _ = store.chooseOutputFolder() }
      }
      Section("Recording") {
        LabeledContent("Microphone", value: store.microphoneAllowed ? "Enabled" : "Needs access")
        if !store.microphoneAllowed {
          Button("Enable microphone") {
            Task {
              if !(await store.requestMicrophone()) { store.openMicrophoneSettings() }
            }
          }
        }
        Text("You choose one window, app, or display each time a recording starts.")
          .font(.caption).foregroundStyle(.secondary)
      }
      Section("Privacy") {
        Toggle(
          "Share selected screenshots with OpenAI",
          isOn: Binding(
            get: { store.configuration.shareScreenshotsWithOpenAI },
            set: { store.setScreenshotSharing($0) }
          )
        )
        Text(
          store.configuration.shareScreenshotsWithOpenAI
            ? "Improves visual understanding. Original videos and the full library stay in your folder."
            : "Only narration, timestamps, and screenshot timing are used to plan the story."
        ).font(.caption).foregroundStyle(.secondary)
      }
      Section("Software Updates") {
        LabeledContent("Installed", value: SoftwareUpdateController.shared.displayVersion)
        Button("Check for Updates…") { SoftwareUpdateController.shared.checkForUpdates() }
        Text("JesSee checks for signed updates automatically and lets you install them in place.")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped).padding().frame(width: 560, height: 580)
    .onAppear { email = store.configuration.email }
  }
}
