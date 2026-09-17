import AVFoundation
import AppKit
import JesSeeCore
import SwiftUI
import UserNotifications

@MainActor
final class AppStore: ObservableObject {
  enum Notice: Equatable {
    case success(String)
    case error(String)
  }

  @Published var configuration: JesSeeConfiguration
  @Published private(set) var captures: [CaptureRecord] = []
  @Published private(set) var notice: Notice?
  @Published private(set) var isTestingAPI = false
  @Published var setupStep = 0
  @Published var selectedCaptureID: String?
  @Published private(set) var microphoneAllowed =
    AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
  @Published private(set) var hasAPIKey: Bool

  let recorder = RecordingCoordinator()

  private let configurationStore = ConfigurationStore()
  private let featureUsage = FeatureUsageRecorder(product: "jessee")
  private var workspace: CaptureWorkspace?
  private var processingTasks: [String: Task<Void, Never>] = [:]

  init() {
    configuration = configurationStore.load()
    hasAPIKey = (try? JesSeeKeychain.loadAPIKey()) != nil
    setupStep = configuration.pendingSetupStep(hasAPIKey: hasAPIKey)
    if !configuration.outputFolderPath.isEmpty {
      workspace = CaptureWorkspace(
        rootURL: URL(fileURLWithPath: configuration.outputFolderPath, isDirectory: true))
    }
    recorder.onFinished = { [weak self] result in
      Task { @MainActor in
        await self?.addCapture(
          from: result.url,
          source: .recording,
          deleteSourceAfterImport: true,
          recordingMarkups: result.markups)
      }
    }
    Task { await loadLibrary() }
  }

  var isConfigured: Bool {
    configuration.setupCompleted && hasAPIKey && workspace != nil
  }

  var recentCaptures: [CaptureRecord] { Array(captures.prefix(4)) }

  func saveAPIKey(_ value: String) async -> Bool {
    isTestingAPI = true
    defer { isTestingAPI = false }
    do {
      let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
      guard candidate.hasPrefix("sk-"), candidate.count >= 20 else {
        throw JesSeeError.invalidAPIKey
      }
      try await OpenAIClient().validate(apiKey: candidate)
      do {
        try JesSeeKeychain.saveAPIKey(candidate)
        guard try JesSeeKeychain.loadAPIKey() == candidate else {
          throw JesSeeError.keychainUnavailable(
            "JesSee saved the key but could not read it back from Keychain.")
        }
      } catch {
        throw JesSeeError.keychainUnavailable(error.localizedDescription)
      }
      hasAPIKey = true
      if !configuration.setupCompleted {
        setupStep = max(setupStep, 1)
      }
      show(.success("OpenAI is connected."))
      return true
    } catch {
      show(.error(error.localizedDescription))
      return false
    }
  }

  func saveEmail(_ email: String) -> Bool {
    let value = email.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.contains("@"), value.contains(".") else {
      show(.error("Enter a valid email address."))
      return false
    }
    configuration.email = value
    if configuration.analyticsUserID == nil {
      configuration.analyticsUserID = UUID().uuidString.lowercased()
    }
    persistConfiguration()
    identifyForAnalyticsIfEnabled()
    return true
  }

  func chooseOutputFolder() -> Bool {
    let panel = NSOpenPanel()
    panel.title = "Choose where JesSee should save your library"
    panel.prompt = "Use This Folder"
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.canCreateDirectories = true
    guard panel.runModal() == .OK, let url = panel.url else { return false }
    configuration.outputFolderPath = url.path
    workspace = CaptureWorkspace(rootURL: url)
    persistConfiguration()
    Task { await loadLibrary() }
    show(.success("Your JesSee Library will be saved here."))
    return true
  }

  func finishSetup() {
    configuration.setupCompleted = true
    persistConfiguration()
    show(.success("JesSee is ready."))
  }

  func setScreenshotSharing(_ enabled: Bool) {
    configuration.shareScreenshotsWithOpenAI = enabled
    persistConfiguration()
  }

  func setAnonymousFeatureUsageSharing(_ enabled: Bool) {
    configuration.shareAnonymousFeatureUsage = enabled
    if enabled, !configuration.email.isEmpty, configuration.analyticsUserID == nil {
      configuration.analyticsUserID = UUID().uuidString.lowercased()
    } else if !enabled {
      configuration.analyticsUserID = nil
    }
    persistConfiguration()
    if enabled {
      identifyForAnalyticsIfEnabled()
    } else {
      Task { await featureUsage.resetClientID() }
    }
  }

  func requestMicrophone() async -> Bool {
    let allowed = await AVCaptureDevice.requestAccess(for: .audio)
    microphoneAllowed = allowed
    if !allowed { show(.error("Microphone access is needed to narrate a recording.")) }
    return allowed
  }

  func openMicrophoneSettings() {
    guard
      let url = URL(
        string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
    else { return }
    NSWorkspace.shared.open(url)
  }

  func importVideo() {
    let panel = NSOpenPanel()
    panel.title = "Import a video"
    panel.prompt = "Import"
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    panel.allowedContentTypes = [.movie, .video]
    guard panel.runModal() == .OK, let url = panel.url else { return }
    Task { await addCapture(from: url, source: .importedVideo) }
  }

  func retry(_ record: CaptureRecord) {
    startProcessing(record)
  }

  func reveal(_ record: CaptureRecord) {
    guard let workspace else { return }
    NSWorkspace.shared.activateFileViewerSelecting([workspace.directoryURL(for: record)])
  }

  func openPDF(_ record: CaptureRecord) {
    guard let workspace, let filename = record.pdfFilename else { return }
    if NSWorkspace.shared.open(workspace.directoryURL(for: record).appendingPathComponent(filename)) {
      recordUsage(.pdfOpened, feature: "pdf_review")
    }
  }

  func openPDF(recordID: String) {
    guard let record = captures.first(where: { $0.id == recordID }) else { return }
    openPDF(record)
  }

  func loadStory(for record: CaptureRecord) async -> StoryDocument? {
    guard let workspace, let filename = record.storyFilename else { return nil }
    return try? await workspace.read(StoryDocument.self, filename: filename, for: record)
  }

  func saveStory(_ story: StoryDocument, for record: CaptureRecord) async -> Bool {
    guard let workspace else { return false }
    do {
      try await workspace.write(story, filename: "story.json", for: record)
      let rendered = try DocumentRenderer.render(
        story: story, in: workspace.directoryURL(for: record))
      var updated = record
      updated.title = story.title
      updated.storyFilename = "story.json"
      updated.htmlFilename = rendered.html
      updated.pdfFilename = rendered.pdf
      try await workspace.save(updated)
      replace(updated)
      show(.success("Story and PDF updated."))
      recordUsage(.storyEdited, feature: "story_editor")
      return true
    } catch {
      show(.error("JesSee could not save this story: \(error.localizedDescription)"))
      return false
    }
  }

  func imageURL(filename: String, record: CaptureRecord) -> URL? {
    guard let workspace else { return nil }
    return workspace.directoryURL(for: record).appendingPathComponent(filename)
  }

  func captureDirectory(for record: CaptureRecord) -> URL? {
    workspace?.directoryURL(for: record)
  }

  func openSettings() {
    NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func clearNotice() { notice = nil }

  private func addCapture(
    from url: URL,
    source: CaptureSource,
    deleteSourceAfterImport: Bool = false,
    recordingMarkups: [RecordingMarkupStroke]? = nil
  ) async {
    guard let workspace else {
      show(.error(JesSeeError.outputFolderUnavailable.localizedDescription))
      return
    }
    do {
      let record = try await workspace.importMedia(
        from: url,
        source: source,
        recordingMarkups: recordingMarkups)
      if deleteSourceAfterImport { try? FileManager.default.removeItem(at: url) }
      captures = await workspace.allRecords()
      startProcessing(record)
      recordUsage(
        .captureAdded,
        feature: source == .recording ? "screen_recording" : "video_import",
        source: source.rawValue)
      show(.success("Saved to your library. Processing will continue in the background."))
    } catch {
      show(.error(error.localizedDescription))
    }
  }

  private func startProcessing(_ record: CaptureRecord) {
    guard processingTasks[record.id] == nil, let workspace else { return }
    let appStore = self
    let task = Task {
      defer { Task { @MainActor in appStore.processingTasks[record.id] = nil } }
      do {
        guard let key = try JesSeeKeychain.loadAPIKey() else { throw JesSeeError.missingAPIKey }
        let processor = CaptureProcessor(workspace: workspace)
        _ = try await processor.process(
          recordID: record.id,
          apiKey: key,
          includeScreenshotPixels: appStore.configuration.shareScreenshotsWithOpenAI
        ) { updated in
          await appStore.replace(updated)
        }
        await appStore.captureFinished(record.id)
      } catch {
        appStore.show(.error(error.localizedDescription))
      }
    }
    processingTasks[record.id] = task
  }

  private func loadLibrary() async {
    guard let workspace else {
      captures = []
      return
    }
    do {
      captures = try await workspace.load()
      if isConfigured {
        for capture in captures where capture.stage == .saved || capture.stage.isProcessing {
          startProcessing(capture)
        }
      }
    } catch {
      show(.error("JesSee could not open this library: \(error.localizedDescription)"))
    }
  }

  private func replace(_ record: CaptureRecord) {
    if let index = captures.firstIndex(where: { $0.id == record.id }) {
      captures[index] = record
    } else {
      captures.insert(record, at: 0)
    }
    captures.sort { $0.createdAt > $1.createdAt }
  }

  private func captureFinished(_ id: String) async {
    await loadLibrary()
    recordUsage(.storyCreated, feature: "story_creation")
    let center = UNUserNotificationCenter.current()
    _ = try? await center.requestAuthorization(options: [.alert, .sound])
    let content = UNMutableNotificationContent()
    content.title = "Your JesSee story is ready"
    content.body = captures.first(where: { $0.id == id })?.title ?? "Open the library to review it."
    try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
  }

  private func persistConfiguration() {
    do { try configurationStore.save(configuration) } catch {
      show(.error("JesSee could not save that setting."))
    }
  }

  private func recordUsage(
    _ activity: FeatureUsageActivity,
    feature: String,
    source: String? = nil,
    mode: String? = nil,
    itemCount: Int? = nil
  ) {
    guard configuration.shareAnonymousFeatureUsage else { return }
    Task {
      await featureUsage.record(
        activity, feature: feature, source: source, mode: mode, itemCount: itemCount,
        userID: configuration.analyticsUserID)
    }
  }

  private func identifyForAnalyticsIfEnabled() {
    guard configuration.shareAnonymousFeatureUsage,
      !configuration.email.isEmpty,
      let userID = configuration.analyticsUserID
    else { return }
    let email = configuration.email
    Task { await featureUsage.identify(email: email, userID: userID) }
  }

  private func show(_ value: Notice) {
    notice = value
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(4))
      if self?.notice == value { self?.notice = nil }
    }
  }
}
