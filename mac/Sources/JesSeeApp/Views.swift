import AppKit
import JesSeeCore
import SwiftUI

private let accent = Color(red: 0.337, green: 0.325, blue: 0.91)
private let signal = Color(red: 1.0, green: 0.353, blue: 0.373)

struct MenuPopoverView: View {
  @ObservedObject var store: AppStore
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    VStack(spacing: 0) {
      HeaderView(store: store, openLibrary: { presentLibrary() })
      Divider()
      Group {
        if store.isConfigured {
          HomeView(store: store, openLibrary: presentLibrary)
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

  private func presentLibrary(captureID: String? = nil) {
    if let captureID { store.selectedCaptureID = captureID }
    openWindow(id: "library")
    DispatchQueue.main.async { NSApp.activate(ignoringOtherApps: true) }
  }
}

private struct HeaderView: View {
  @ObservedObject var store: AppStore
  let openLibrary: () -> Void
  @State private var hoveredAction: String?

  var body: some View {
    VStack(spacing: 5) {
      HStack(spacing: 11) {
        ZStack {
          RoundedRectangle(cornerRadius: 10).fill(accent.opacity(0.12))
          Image(nsImage: NSApplication.shared.applicationIconImage)
            .resizable().scaledToFit()
        }
        .frame(width: 36, height: 36)
        VStack(alignment: .leading, spacing: 1) {
          Text("JesSee").font(.headline)
          Text("Turn a walkthrough into a story").font(.caption).foregroundStyle(.secondary)
        }
        Spacer()
        if store.isConfigured {
          Button(action: openLibrary) { Image(systemName: "books.vertical") }
            .jesseeHoverHelp("Open Library", onChange: showAction)
          Button(action: SoftwareUpdateController.shared.checkForUpdates) {
            Image(systemName: "arrow.triangle.2.circlepath")
          }.jesseeHoverHelp("Check for Updates", onChange: showAction)
          Button(action: store.openSettings) { Image(systemName: "gearshape") }
            .jesseeHoverHelp("Settings", onChange: showAction)
          Button {
            NSApp.terminate(nil)
          } label: {
            Image(systemName: "power")
          }.jesseeHoverHelp("Quit JesSee", onChange: showAction)
        }
      }
      if store.isConfigured {
        Text(hoveredAction ?? "Hover an icon to see what it does")
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(hoveredAction == nil ? .tertiary : .secondary)
          .frame(maxWidth: .infinity, alignment: .trailing)
          .contentTransition(.opacity)
      }
    }
    .buttonStyle(.borderless)
    .padding(14)
  }

  private func showAction(_ message: String?) {
    withAnimation(.easeOut(duration: 0.1)) { hoveredAction = message }
  }
}

private struct HomeView: View {
  @ObservedObject var store: AppStore
  @ObservedObject private var recorder: RecordingCoordinator
  let openLibrary: (String?) -> Void

  init(store: AppStore, openLibrary: @escaping (String?) -> Void) {
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
  let openLibrary: (String?) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Recent").font(.subheadline.weight(.semibold))
        Spacer()
        if !store.captures.isEmpty {
          Button("See all in Library") { openLibrary(nil) }.buttonStyle(.link)
        }
      }
      if store.recentCaptures.isEmpty {
        Text("Your recordings and imported videos will appear here.")
          .font(.caption).foregroundStyle(.secondary).padding(.vertical, 8)
      } else {
        ForEach(store.recentCaptures) { record in
          CaptureRow(record: record, store: store) { openLibrary(record.id) }
        }
      }
    }
  }
}

private struct CaptureRow: View {
  let record: CaptureRecord
  @ObservedObject var store: AppStore
  let openEditor: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Button(action: openEditor) {
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
          Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
            .foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Menu {
        if record.pdfFilename != nil { Button("Open PDF") { store.openPDF(record) } }
        Button("Show in Finder") { store.reveal(record) }
        if record.stage == .failed { Button("Try again") { store.retry(record) } }
      } label: {
        Image(systemName: "ellipsis").frame(width: 24, height: 24)
      }
      .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
      .help("More actions")
    }
    .padding(.vertical, 2)
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
        case 0: ProviderChoiceStep(store: store)
        case 1:
          if store.configuration.aiProviderMode == .polyformCovered {
            PolyformCoveredStep(store: store)
          } else {
            APIKeyStep(store: store)
          }
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
  private let labels = ["Plan", "Connect", "Folder", "Mic"]
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

private struct ProviderChoiceStep: View {
  @ObservedObject var store: AppStore

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Label("Choose how AI is covered", systemImage: "sparkles").font(.headline)
      Text(
        store.isPolyformCoveredAvailable
          ? "Both options create the same editable story and PDF."
          : "Bring your own OpenAI key to create editable stories and PDFs."
      )
        .font(.caption).foregroundStyle(.secondary)
      if store.isPolyformCoveredAvailable {
        providerButton(
          title: "Polyform Covered",
          detail: "Sign in by email. Polyform covers transcription and AI costs.",
          icon: "heart.fill", mode: .polyformCovered)
      } else {
        Label("Polyform Covered is temporarily unavailable", systemImage: "clock")
          .font(.caption).foregroundStyle(.secondary)
      }
      providerButton(
        title: "Bring Your Own Key",
        detail: "Use your own OpenAI API key, saved securely in this Mac's Keychain.",
        icon: "key.fill", mode: .bringYourOwnKey)
    }
  }

  private func providerButton(
    title: String, detail: String, icon: String, mode: AIProviderMode
  ) -> some View {
    Button {
      store.selectProvider(mode)
    } label: {
      HStack(alignment: .top, spacing: 11) {
        Image(systemName: icon).foregroundStyle(mode == .polyformCovered ? signal : accent)
          .frame(width: 24)
        VStack(alignment: .leading, spacing: 3) {
          Text(title).font(.subheadline.weight(.semibold))
          Text(detail).font(.caption).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer()
        Image(systemName: "chevron.right").foregroundStyle(.tertiary)
      }
      .padding(12).contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .background(accent.opacity(0.055), in: RoundedRectangle(cornerRadius: 11))
    .overlay(RoundedRectangle(cornerRadius: 11).stroke(accent.opacity(0.16)))
  }
}

private struct PolyformCoveredStep: View {
  @ObservedObject var store: AppStore
  @State private var email = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 11) {
      Label("Polyform Covered", systemImage: "heart.fill").font(.headline).foregroundStyle(signal)
      Text("Polyform.AI is the company that built JesSee. We cover the AI cost.")
        .font(.caption).foregroundStyle(.secondary)
      Text("If JesSee helps you, we'd love either:").font(.caption.weight(.semibold))
      Text(
        "• Connect ahmed@polyform.ai with a Series A company hiring a data team or hitting the limits of AI for data.\n• Donate via Venmo @Ahmed-Elsamadisi to cover your own use or sponsor someone else's."
      )
      .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      HStack {
        Link("Email Ahmed", destination: URL(string: "mailto:ahmed@polyform.ai")!)
        Link(
          "Open Venmo", destination: URL(string: "https://account.venmo.com/u/Ahmed-Elsamadisi")!)
      }.font(.caption)

      switch store.authenticationState {
      case .signedIn(let connectedEmail):
        Label("Signed in as \(connectedEmail)", systemImage: "checkmark.circle.fill")
          .font(.caption).foregroundStyle(.green)
        Button("Continue") { store.setupStep = 2 }
          .buttonStyle(.borderedProminent).tint(accent)
      case .requesting:
        ProgressView("Sending your approval email…").controlSize(.small)
      case .waitingForApproval(let pendingEmail):
        Label("Approve the link sent to \(pendingEmail)", systemImage: "envelope.badge")
          .font(.caption).foregroundStyle(.secondary)
        HStack {
          ProgressView().controlSize(.small)
          Text("JesSee will continue automatically.").font(.caption)
          Spacer()
          Button("Cancel") { store.cancelSignIn() }
        }
      case .signedOut:
        TextField("you@company.com", text: $email).textFieldStyle(.roundedBorder)
        Button("Email me a sign-in link") { store.beginSignIn(email) }
          .buttonStyle(.borderedProminent).tint(accent).disabled(email.isEmpty)
      }
      Button("Choose a different option") { store.setupStep = 0 }.buttonStyle(.link)
    }.onAppear { email = store.configuration.email }
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
      if store.hasAPIKey {
        Label("An OpenAI key is already saved", systemImage: "checkmark.circle.fill")
          .font(.caption).foregroundStyle(.green)
        Button("Use saved key") { store.setupStep = 2 }
          .buttonStyle(.borderedProminent).tint(accent)
        Divider()
        Text("Or replace it:").font(.caption.weight(.semibold))
      }
      SecureField("sk-…", text: $key).textFieldStyle(.roundedBorder)
      Button(store.isTestingAPIKey ? "Checking…" : "Save and test") {
        Task {
          errorMessage = nil
          if await store.saveAPIKey(key) {
            key = ""
          } else if case .error(let message) = store.notice {
            errorMessage = message
          }
        }
      }
      .buttonStyle(.borderedProminent).tint(accent).disabled(key.isEmpty || store.isTestingAPIKey)
      if let errorMessage {
        Label(errorMessage, systemImage: "exclamationmark.circle.fill")
          .font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
      }
      Button("Choose a different option") { store.setupStep = 0 }.buttonStyle(.link)
    }
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

  var body: some View {
    NavigationSplitView {
      List(store.captures, selection: $store.selectedCaptureID) { record in
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
      if let id = store.selectedCaptureID,
        let record = store.captures.first(where: { $0.id == id })
      {
        CaptureDetailView(store: store, record: record)
      } else {
        ContentUnavailableView(
          "Choose a story", systemImage: "doc.richtext",
          description: Text("Review its steps, images, and saved files."))
      }
    }
    .frame(minWidth: 900, minHeight: 620)
    .onAppear(perform: selectDefaultCapture)
    .onChange(of: store.captures.map(\.id)) { _, _ in selectDefaultCapture() }
  }

  private func selectDefaultCapture() {
    if let selectedCaptureID = store.selectedCaptureID,
      store.captures.contains(where: { $0.id == selectedCaptureID })
    {
      return
    }
    store.selectedCaptureID = store.captures.first?.id
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
          if store.isPolyformCoveredAvailable,
            store.configuration.aiProviderMode == .polyformCovered
          {
            if record.publicPDFURL != nil {
              Button {
                store.copyPublicPDFLink(record)
              } label: {
                Label("Copy public link", systemImage: "link")
              }
              .disabled(store.publishingCaptureID != nil)
              Button {
                store.publishPDF(record)
              } label: {
                Label("Update link", systemImage: "arrow.triangle.2.circlepath")
              }
              .disabled(store.publishingCaptureID != nil)
            } else {
              Button {
                store.publishPDF(record)
              } label: {
                if store.publishingCaptureID == record.id {
                  ProgressView().controlSize(.small)
                  Text("Creating link…")
                } else {
                  Label("Create public link", systemImage: "link.badge.plus")
                }
              }
              .disabled(store.publishingCaptureID != nil)
            }
          }
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
      .padding(30).frame(width: 520, height: 600)
      .overlay(alignment: .top) { NoticeView(notice: store.notice).padding(.top, 16) }
  }
}

struct SettingsView: View {
  @ObservedObject var store: AppStore
  @State private var email = ""
  @State private var key = ""
  @State private var apiSaved = false
  @State private var apiError: String?

  var body: some View {
    Form {
      Section("AI processing") {
        if store.isPolyformCoveredAvailable {
          Picker(
            "Plan",
            selection: Binding(
              get: { store.configuration.aiProviderMode ?? .polyformCovered },
              set: { store.changeProviderFromSettings($0) }
            )
          ) {
            Text("Polyform Covered").tag(AIProviderMode.polyformCovered)
            Text("Bring Your Own Key").tag(AIProviderMode.bringYourOwnKey)
          }
          .pickerStyle(.segmented)
        } else {
          LabeledContent("Plan", value: "Bring Your Own Key")
          Text("Polyform Covered is temporarily unavailable while its managed service is finalized.")
            .font(.caption).foregroundStyle(.secondary)
        }

        if store.isPolyformCoveredAvailable,
          store.configuration.aiProviderMode == .polyformCovered
        {
          Text(
            "Polyform.AI built JesSee and covers its AI costs. You can support it by introducing ahmed@polyform.ai to a Series A company hiring a data team or hitting the limits of AI for data, or by donating via Venmo @Ahmed-Elsamadisi."
          )
          .font(.caption).foregroundStyle(.secondary)
          HStack {
            Link("Email Ahmed", destination: URL(string: "mailto:ahmed@polyform.ai")!)
            Link(
              "Open Venmo",
              destination: URL(string: "https://account.venmo.com/u/Ahmed-Elsamadisi")!)
          }
          switch store.authenticationState {
          case .signedIn(let connectedEmail):
            Label("Signed in as \(connectedEmail)", systemImage: "checkmark.circle.fill")
              .font(.caption).foregroundStyle(.green)
            Button("Sign out") { store.signOut() }
          case .requesting:
            ProgressView("Sending your approval email…").controlSize(.small)
          case .waitingForApproval(let pendingEmail):
            HStack {
              ProgressView().controlSize(.small)
              Text("Approve the link sent to \(pendingEmail)").font(.caption)
              Spacer()
              Button("Cancel") { store.cancelSignIn() }
            }
          case .signedOut:
            TextField("you@company.com", text: $email)
            Button("Email me a sign-in link") { store.beginSignIn(email) }
              .disabled(email.isEmpty)
          }
        } else {
          SecureField(store.hasAPIKey ? "Replace OpenAI API key" : "OpenAI API key", text: $key)
          Button(store.isTestingAPIKey ? "Checking…" : "Save and test key") {
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
          .disabled(key.isEmpty || store.isTestingAPIKey)
          if apiSaved || store.hasAPIKey {
            Label("Saved securely in this Mac's Keychain", systemImage: "checkmark.circle.fill")
              .font(.caption).foregroundStyle(.green)
          } else if let apiError {
            Label(apiError, systemImage: "exclamationmark.circle.fill")
              .font(.caption).foregroundStyle(.red)
          }
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
          "Share selected screenshots for story creation",
          isOn: Binding(
            get: { store.configuration.shareScreenshotsForStory },
            set: { store.setScreenshotSharing($0) }
          )
        )
        Text(
          store.configuration.shareScreenshotsForStory
            ? "Improves visual understanding. Selected evidence is sent through your chosen AI option. Original videos and the full library stay in your folder."
            : "Only narration, timestamps, and screenshot timing are used to plan the story."
        ).font(.caption).foregroundStyle(.secondary)
        Toggle(
          "Share product analytics",
          isOn: Binding(
            get: { store.configuration.shareAnonymousFeatureUsage },
            set: { store.setAnonymousFeatureUsageSharing($0) }
          )
        )
        Text(
          "Sends completed feature names, app version, counts, and a random installation ID directly to Google Analytics. It never sends your email, recordings, screenshots, narration, story text, filenames, or API keys. Turning this off removes the local analytics ID."
        ).font(.caption).foregroundStyle(.secondary)
      }
      Section("Software Updates") {
        LabeledContent("Installed", value: SoftwareUpdateController.shared.displayVersion)
        Button("Check for Updates…") { SoftwareUpdateController.shared.checkForUpdates() }
        Text("JesSee checks for signed updates automatically and lets you install them in place.")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped).padding().frame(width: 620, height: 720)
    .onAppear { email = store.configuration.email }
  }
}
