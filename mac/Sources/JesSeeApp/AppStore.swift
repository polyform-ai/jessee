import AVFoundation
import AppKit
import JesSeeCore
import SwiftUI
@preconcurrency import UserNotifications

@MainActor
final class AppStore: ObservableObject {
  private struct ProcessingTaskKey: Hashable {
    var workspaceID: ObjectIdentifier
    var workspaceRootURL: URL
    var captureID: String

    init(workspace: CaptureWorkspace, captureID: String) {
      workspaceID = ObjectIdentifier(workspace)
      workspaceRootURL = workspace.rootURL
      self.captureID = captureID
    }
  }

  enum Notice: Equatable {
    case success(String)
    case error(String)
  }

  enum AuthenticationState: Equatable {
    case signedOut
    case requesting
    case waitingForApproval(String)
    case signedIn(String)
  }

  @Published var configuration: JesSeeConfiguration
  @Published private(set) var captures: [CaptureRecord] = []
  @Published private(set) var notice: Notice?
  @Published private(set) var authenticationState: AuthenticationState
  @Published private(set) var publishingCaptureID: String?
  @Published private(set) var hasAPIKey: Bool
  @Published private(set) var isTestingAPIKey = false
  @Published private(set) var readyCaptureID: String?
  @Published var setupStep = 0
  @Published var selectedCaptureID: String?
  @Published private(set) var microphoneAllowed =
    AVCaptureDevice.authorizationStatus(for: .audio) == .authorized

  let recorder = RecordingCoordinator()

  private let configurationStore = ConfigurationStore()
  private let featureUsage = FeatureUsageRecorder(product: "jessee")
  private let polyformClient: PolyformClient?
  private let polyformManagedAIAvailable: Bool
  private var workspace: CaptureWorkspace?
  private var processingTasks: [ProcessingTaskKey: Task<Void, Never>] = [:]
  private var processingNotificationTasks: [ProcessingTaskKey: Task<Void, Never>] = [:]
  private var refreshTask: Task<WorkflowAuthSession, Error>?
  private var signInTask: Task<Void, Never>?
  private var workflowSession: WorkflowAuthSession?

  init() {
    let notificationCenter = UNUserNotificationCenter.current()
    notificationCenter.delegate = JesSeeNotificationDelegate.shared
    configuration = configurationStore.load()
    let configuredService = PolyformServiceConfiguration.configured()
    polyformClient = configuredService.map { PolyformClient(configuration: $0) }
    polyformManagedAIAvailable = configuredService?.supportsManagedAI == true
    workflowSession = try? JesSeeKeychain.loadWorkflowSession()
    hasAPIKey = (try? JesSeeKeychain.loadAPIKey()) != nil
    if let session = workflowSession, session.expiresAt > Date() {
      authenticationState = .signedIn(session.email)
      configuration.email = session.email
    } else {
      if workflowSession != nil { try? JesSeeKeychain.removeWorkflowSession() }
      workflowSession = nil
      authenticationState = .signedOut
    }
    if !polyformManagedAIAvailable, configuration.aiProviderMode == .polyformCovered {
      configuration.aiProviderMode = hasAPIKey ? .bringYourOwnKey : nil
      configuration.setupCompleted = false
      try? configurationStore.save(configuration)
    }
    setupStep = configuration.pendingSetupStep(
      hasPolyformSession: workflowSession != nil, hasAPIKey: hasAPIKey)
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
    Task {
      if configuration.aiProviderMode == .polyformCovered { _ = try? await accessToken() }
      await loadLibrary()
    }
  }

  var isConfigured: Bool {
    guard configuration.setupCompleted, workspace != nil else { return false }
    switch configuration.aiProviderMode {
    case .polyformCovered: return isPolyformCoveredAvailable && workflowSession != nil
    case .bringYourOwnKey: return hasAPIKey
    case nil: return false
    }
  }

  var recentCaptures: [CaptureRecord] { Array(captures.prefix(4)) }
  var isPolyformCoveredAvailable: Bool { polyformManagedAIAvailable }
  var isPublicPDFPublishingAvailable: Bool { polyformClient != nil }
  var isSignedIntoPolyform: Bool {
    if case .signedIn = authenticationState { return true }
    return false
  }

  func selectProvider(_ mode: AIProviderMode) {
    guard mode != .polyformCovered || isPolyformCoveredAvailable else { return }
    configuration.aiProviderMode = mode
    configuration.setupCompleted = false
    setupStep = 1
    persistConfiguration()
  }

  func changeProviderFromSettings(_ mode: AIProviderMode) {
    guard mode != .polyformCovered || isPolyformCoveredAvailable else { return }
    configuration.aiProviderMode = mode
    let credentialAvailable =
      mode == .polyformCovered ? workflowSession != nil : hasAPIKey
    configuration.setupCompleted =
      credentialAvailable && !configuration.outputFolderPath.isEmpty
    setupStep = configuration.pendingSetupStep(
      hasPolyformSession: workflowSession != nil, hasAPIKey: hasAPIKey)
    persistConfiguration()
  }

  func saveAPIKey(_ value: String) async -> Bool {
    isTestingAPIKey = true
    defer { isTestingAPIKey = false }
    do {
      let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
      try await DirectOpenAIClient().validate(apiKey: candidate)
      try JesSeeKeychain.saveAPIKey(candidate)
      hasAPIKey = true
      setupStep = max(setupStep, 2)
      restoreCompletedSetupIfPossible(for: .bringYourOwnKey)
      persistConfiguration()
      show(.success("OpenAI key saved securely."))
      await resumeFailedCaptures(recoverableBy: .openAIKey)
      return true
    } catch {
      show(.error(error.localizedDescription))
      return false
    }
  }

  func beginSignIn(_ email: String) {
    let value = email.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.contains("@"), value.contains(".") else {
      show(.error("Enter a valid email address."))
      return
    }
    guard let polyformClient else {
      show(.error(JesSeeError.serviceNotConfigured.localizedDescription))
      return
    }
    signInTask?.cancel()
    authenticationState = .requesting
    signInTask = Task { [weak self] in
      guard let self else { return }
      do {
        let credentials = PKCECredentials.generate()
        let attempt = try await polyformClient.requestSignIn(
          email: value, challenge: credentials.challenge)
        guard !Task.isCancelled else { return }
        authenticationState = .waitingForApproval(value)
        let deadline = Date().addingTimeInterval(attempt.expiresIn)
        while Date() < deadline, !Task.isCancelled {
          do {
            let session = try await polyformClient.exchangeSignIn(
              attemptID: attempt.id, verifier: credentials.verifier)
            guard !Task.isCancelled else { return }
            try JesSeeKeychain.saveWorkflowSession(session)
            workflowSession = session
            authenticationState = .signedIn(session.email)
            configuration.email = session.email
            restoreCompletedSetupIfPossible(for: .polyformCovered)
            persistConfiguration()
            if !configuration.setupCompleted { setupStep = max(setupStep, 1) }
            show(.success("Signed in to JesSee."))
            await resumeFailedCaptures(recoverableBy: .polyformSignIn)
            return
          } catch PolyformClientError.approvalPending {
            try await Task.sleep(for: .seconds(2))
          }
        }
        guard !Task.isCancelled else { return }
        throw JesSeeError.authenticationFailed("The approval link expired. Try again.")
      } catch is CancellationError {
        authenticationState = workflowSession.map { .signedIn($0.email) } ?? .signedOut
      } catch {
        authenticationState = .signedOut
        show(.error(error.localizedDescription))
      }
    }
  }

  func cancelSignIn() {
    signInTask?.cancel()
    signInTask = nil
    authenticationState = workflowSession.map { .signedIn($0.email) } ?? .signedOut
  }

  func signOut() {
    signInTask?.cancel()
    refreshTask?.cancel()
    refreshTask = nil
    try? JesSeeKeychain.removeWorkflowSession()
    workflowSession = nil
    authenticationState = .signedOut
    if configuration.aiProviderMode == .polyformCovered {
      configuration.setupCompleted = false
      setupStep = 0
    }
    persistConfiguration()
    show(.success("Signed out."))
  }

  func chooseOutputFolder() -> Bool {
    let panel = NSOpenPanel()
    panel.title = "Choose where JesSee should save your library"
    panel.prompt = "Use This Folder"
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.canCreateDirectories = true
    guard panel.runModal() == .OK, let url = panel.url else { return false }
    let selectedWorkspace = CaptureWorkspace(rootURL: url)
    if let workspace, workspace.rootURL == selectedWorkspace.rootURL {
      configuration.outputFolderPath = url.path
      persistConfiguration()
      Task { await loadLibrary() }
      show(.success("Your JesSee Library will be saved here."))
      return true
    }
    cancelProcessingForWorkspaceChange()
    configuration.outputFolderPath = url.path
    workspace = selectedWorkspace
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
    configuration.shareScreenshotsForStory = enabled
    persistConfiguration()
  }

  func setAnonymousFeatureUsageSharing(_ enabled: Bool) {
    configuration.shareAnonymousFeatureUsage = enabled
    persistConfiguration()
    if !enabled {
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

  func reveal(_ record: CaptureRecord) {
    guard let workspace else { return }
    NSWorkspace.shared.activateFileViewerSelecting([workspace.directoryURL(for: record)])
  }

  func openPDF(_ record: CaptureRecord) {
    guard let workspace, let filename = record.pdfFilename else { return }
    if NSWorkspace.shared.open(workspace.directoryURL(for: record).appendingPathComponent(filename))
    {
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
    guard publishingCaptureID != record.id else {
      show(.error("Wait for the public-link update to finish before saving more edits."))
      return false
    }
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

  func publishPDF(recordID: String) async -> String? {
    guard publishingCaptureID == nil,
      let record = captures.first(where: { $0.id == recordID })
    else { return nil }
    publishingCaptureID = record.id
    defer { publishingCaptureID = nil }
    do {
      guard let workspace, let filename = record.pdfFilename else {
        throw JesSeeError.invalidResponse("Create the PDF before publishing it.")
      }
      let upload = try await withPolyformAuthentication { client, token in
        try await client.publishPDF(
          at: workspace.directoryURL(for: record).appendingPathComponent(filename),
          accessToken: token)
      }
      guard let publicURL = upload.publicURL else {
        throw JesSeeError.invalidResponse("Polyform did not return a public PDF link.")
      }
      var updated = await workspace.record(id: record.id) ?? record
      let cleanupIDs = ([updated.publicPDFUploadID].compactMap { $0 }
        + (updated.publicPDFCleanupUploadIDs ?? []))
        .filter { $0 != upload.id }
        .reduce(into: [String]()) { result, id in
          if !result.contains(id) { result.append(id) }
        }
      updated.publicPDFUploadID = upload.id
      updated.publicPDFURL = publicURL.absoluteString
      updated.publicPDFCleanupUploadIDs = cleanupIDs.isEmpty ? nil : cleanupIDs
      do {
        try await workspace.save(updated)
      } catch {
        do {
          try await withPolyformAuthentication { client, token in
            try await client.deleteUpload(id: upload.id, accessToken: token)
          }
        } catch let rollbackError {
          throw JesSeeError.serviceUnavailable(
            "JesSee could not save or roll back the new public PDF. Upload \(upload.id) may need cleanup: \(rollbackError.localizedDescription)")
        }
        throw error
      }
      replace(updated)

      var failedCleanupIDs: [String] = []
      for uploadID in cleanupIDs {
        do {
          try await withPolyformAuthentication { client, token in
            try await client.deleteUpload(id: uploadID, accessToken: token)
          }
        } catch {
          failedCleanupIDs.append(uploadID)
        }
      }
      updated.publicPDFCleanupUploadIDs = failedCleanupIDs.isEmpty ? nil : failedCleanupIDs
      try await workspace.save(updated)
      replace(updated)
      copyToPasteboard(publicURL.absoluteString)
      recordUsage(.pdfPublished, feature: "public_pdf")
      if failedCleanupIDs.isEmpty {
        show(.success("Public PDF link copied."))
      } else {
        show(
          .error(
            "The new public link was copied, but JesSee could not retire a previous upload. Use Get link to retry cleanup."))
      }
      return publicURL.absoluteString
    } catch {
      show(.error(authenticationAwareError(error).localizedDescription))
      return nil
    }
  }

  func clearNotice() { notice = nil }

  func consumeReadyCapture(_ id: String) {
    if readyCaptureID == id { readyCaptureID = nil }
  }

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
        processingProviderMode: configuration.aiProviderMode,
        recordingMarkups: recordingMarkups)
      if deleteSourceAfterImport { try? FileManager.default.removeItem(at: url) }
      guard isCurrentWorkspace(workspace) else { return }
      captures = await workspace.allRecords()
      guard isCurrentWorkspace(workspace) else { return }
      startProcessing(record, in: workspace, notifyStarted: true)
      recordUsage(
        .captureAdded,
        feature: source == .recording ? "screen_recording" : "video_import",
        source: source.rawValue)
      show(.success("Saved to your library. JesSee is transcribing it now."))
    } catch {
      show(.error(error.localizedDescription))
    }
  }

  private func startProcessing(
    _ record: CaptureRecord, in processingWorkspace: CaptureWorkspace,
    notifyStarted: Bool = false
  ) {
    let taskKey = ProcessingTaskKey(workspace: processingWorkspace, captureID: record.id)
    guard processingTasks[taskKey] == nil,
      !hasObsoleteProcessingOwner(for: processingWorkspace)
    else { return }
    let provider = record.processingProviderMode ?? configuration.aiProviderMode
    let appStore = self
    let task = Task {
      var failedAttempts = record.automaticProcessingAttempts ?? 0
      var retryAt = record.automaticProcessingRetryAt
      guard failedAttempts < CaptureProcessingRetryPolicy.maximumAttempts else {
        await appStore.markProcessingExhausted(record.id, in: processingWorkspace)
        await appStore.finishProcessingLifecycle(taskKey, in: processingWorkspace)
        return
      }
      while !Task.isCancelled, failedAttempts < CaptureProcessingRetryPolicy.maximumAttempts {
        if let retryAt {
          let delay = retryAt.timeIntervalSinceNow
          if delay > 0 {
            do {
              try await Task.sleep(for: .seconds(delay))
            } catch {
              break
            }
          }
        }
        await appStore.markProcessingActive(
          record.id, failedAttempts: failedAttempts, provider: provider,
          in: processingWorkspace)
        if Task.isCancelled { break }
        retryAt = nil
        var attemptedCredential = appStore.credentialIdentity(for: provider)
        do {
          let context = try await appStore.processingService(for: provider)
          attemptedCredential = context.credential
          try Task.checkCancellation()
          let processor = CaptureProcessor(
            workspace: processingWorkspace, service: context.service)
          _ = try await processor.process(
            recordID: record.id,
            includeScreenshotPixels: appStore.configuration.shareScreenshotsForStory
          ) { updated in
            await appStore.replace(updated, from: processingWorkspace)
          }
          try Task.checkCancellation()
          await appStore.markProcessingComplete(record.id, in: processingWorkspace)
          await appStore.captureFinished(record.id, in: processingWorkspace)
          break
        } catch is CancellationError {
          break
        } catch {
          guard
            CaptureProcessingRetryPolicy.shouldClassifyFailure(
              error, taskIsCancelled: Task.isCancelled)
          else { break }
          if appStore.hasRepairedCredential(
            after: attemptedCredential, for: provider, error: error)
          {
            continue
          }
          let visibleError = appStore.authenticationAwareError(error)
          failedAttempts += 1
          let shouldRetry =
            CaptureProcessingRetryPolicy.shouldRetry(visibleError)
            && failedAttempts < CaptureProcessingRetryPolicy.maximumAttempts
          if shouldRetry {
            let nextRetryAt = Date().addingTimeInterval(
              CaptureProcessingRetryPolicy.delaySecondsAfterFailedAttempt(failedAttempts))
            retryAt = nextRetryAt
            await appStore.markProcessingWaiting(
              record.id, failedAttempts: failedAttempts, provider: provider,
              retryAt: nextRetryAt, in: processingWorkspace)
            continue
          }
          await appStore.markProcessingFailed(
            record.id,
            failedAttempts: failedAttempts,
            recovery: appStore.credentialRecovery(for: visibleError, provider: provider),
            error: visibleError,
            in: processingWorkspace)
          appStore.show(.error(visibleError.localizedDescription))
          break
        }
      }
      await appStore.finishProcessingLifecycle(taskKey, in: processingWorkspace)
    }
    processingTasks[taskKey] = task
    if notifyStarted { notifyProcessingStarted(record, in: processingWorkspace) }
  }

  private func loadLibrary() async {
    guard let workspace else {
      captures = []
      return
    }
    do {
      let loadedCaptures = try await workspace.load()
      guard isCurrentWorkspace(workspace) else { return }
      captures = loadedCaptures
      for capture in loadedCaptures
      where canProcess(capture)
        && CaptureProcessingRetryPolicy.shouldStartProcessing(capture)
      {
        startProcessing(capture, in: workspace)
      }
    } catch {
      show(.error("JesSee could not open this library: \(error.localizedDescription)"))
    }
  }

  private func resumeFailedCaptures(recoverableBy recovery: CaptureProcessingRecovery) async {
    guard let workspace, hasCredential(for: recovery) else { return }
    for var record in await workspace.allRecords()
    where CaptureProcessingRetryPolicy.shouldResume(record, after: recovery)
    {
      record.stage = .saved
      record.automaticProcessingAttempts = 0
      record.automaticProcessingRetryAt = nil
      record.processingRetryPolicyVersion = CaptureProcessingRetryPolicy.currentVersion
      record.processingRecovery = nil
      record.error = nil
      try? await workspace.save(record)
    }
    await loadLibrary()
  }

  private func replace(_ record: CaptureRecord) {
    if let index = captures.firstIndex(where: { $0.id == record.id }) {
      captures[index] = record
    } else {
      captures.insert(record, at: 0)
    }
    captures.sort { $0.createdAt > $1.createdAt }
  }

  private func replace(_ record: CaptureRecord, from sourceWorkspace: CaptureWorkspace) {
    guard isCurrentWorkspace(sourceWorkspace) else { return }
    replace(record)
  }

  private func markProcessingActive(
    _ id: String, failedAttempts: Int, provider: AIProviderMode?,
    in processingWorkspace: CaptureWorkspace
  ) async {
    guard var record = await processingWorkspace.record(id: id) else { return }
    record.stage = .preparingAudio
    record.automaticProcessingAttempts = failedAttempts
    record.automaticProcessingRetryAt = nil
    record.processingRetryPolicyVersion = CaptureProcessingRetryPolicy.currentVersion
    record.processingProviderMode = provider
    record.processingRecovery = nil
    record.error = nil
    try? await processingWorkspace.save(record)
    replace(record, from: processingWorkspace)
  }

  private func markProcessingWaiting(
    _ id: String, failedAttempts: Int, provider: AIProviderMode?, retryAt: Date,
    in processingWorkspace: CaptureWorkspace
  ) async {
    guard var record = await processingWorkspace.record(id: id) else { return }
    record.automaticProcessingAttempts = failedAttempts
    record.automaticProcessingRetryAt = retryAt
    record.processingRetryPolicyVersion = CaptureProcessingRetryPolicy.currentVersion
    record.processingProviderMode = provider
    record.processingRecovery = nil
    record.error = nil
    try? await processingWorkspace.save(record)
    replace(record, from: processingWorkspace)
  }

  private func markProcessingComplete(_ id: String, in processingWorkspace: CaptureWorkspace) async {
    guard var record = await processingWorkspace.record(id: id) else { return }
    record.automaticProcessingAttempts = nil
    record.automaticProcessingRetryAt = nil
    record.processingRetryPolicyVersion = CaptureProcessingRetryPolicy.currentVersion
    record.processingProviderMode = nil
    record.processingRecovery = nil
    try? await processingWorkspace.save(record)
    replace(record, from: processingWorkspace)
  }

  private func markProcessingFailed(
    _ id: String,
    failedAttempts: Int,
    recovery: CaptureProcessingRecovery?,
    error: Error,
    in processingWorkspace: CaptureWorkspace
  ) async {
    guard var record = await processingWorkspace.record(id: id) else { return }
    record.stage = .failed
    record.automaticProcessingAttempts = failedAttempts
    record.automaticProcessingRetryAt = nil
    record.processingRetryPolicyVersion = CaptureProcessingRetryPolicy.currentVersion
    record.processingRecovery = recovery
    record.error = error.localizedDescription
    try? await processingWorkspace.save(record)
    replace(record, from: processingWorkspace)
  }

  private func markProcessingExhausted(
    _ id: String, in processingWorkspace: CaptureWorkspace
  ) async {
    guard var record = await processingWorkspace.record(id: id) else { return }
    record.stage = .failed
    record.automaticProcessingAttempts = CaptureProcessingRetryPolicy.maximumAttempts
    record.automaticProcessingRetryAt = nil
    record.processingRetryPolicyVersion = CaptureProcessingRetryPolicy.currentVersion
    record.processingRecovery = nil
    record.error = record.error ?? "JesSee could not finish processing after several attempts."
    try? await processingWorkspace.save(record)
    replace(record, from: processingWorkspace)
  }

  private func captureFinished(_ id: String, in processingWorkspace: CaptureWorkspace) async {
    if isCurrentWorkspace(processingWorkspace) {
      await loadLibrary()
      selectedCaptureID = id
      readyCaptureID = id
    }
    recordUsage(.storyCreated, feature: "story_creation")
    let center = UNUserNotificationCenter.current()
    let taskKey = ProcessingTaskKey(workspace: processingWorkspace, captureID: id)
    let notificationID = processingNotificationIdentifier(for: taskKey)
    center.removePendingNotificationRequests(withIdentifiers: [notificationID])
    center.removeDeliveredNotifications(withIdentifiers: [notificationID])
    _ = try? await center.requestAuthorization(options: [.alert, .sound])
    let content = UNMutableNotificationContent()
    content.title = "Your JesSee story is ready"
    let completedRecord = await processingWorkspace.record(id: id)
    content.body = completedRecord?.title ?? "Open the library to review it."
    content.sound = .default
    try? await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
  }

  private func notifyProcessingStarted(
    _ record: CaptureRecord, in processingWorkspace: CaptureWorkspace
  ) {
    let taskKey = ProcessingTaskKey(workspace: processingWorkspace, captureID: record.id)
    let notificationID = processingNotificationIdentifier(for: taskKey)
    processingNotificationTasks[taskKey]?.cancel()
    processingNotificationTasks[taskKey] = Task { [weak self] in
      let center = UNUserNotificationCenter.current()
      guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else {
        return
      }
      guard !Task.isCancelled, self?.processingTasks[taskKey] != nil else { return }
      let content = UNMutableNotificationContent()
      content.title = "JesSee is transcribing your recording"
      content.body = "You can keep working while JesSee transcribes, chooses visuals, and builds the story."
      content.sound = .default
      try? await center.add(
        UNNotificationRequest(
          identifier: notificationID, content: content, trigger: nil))
      if Task.isCancelled || self?.processingTasks[taskKey] == nil {
        center.removePendingNotificationRequests(withIdentifiers: [notificationID])
        center.removeDeliveredNotifications(withIdentifiers: [notificationID])
      }
    }
  }

  private func finishProcessingLifecycle(
    _ taskKey: ProcessingTaskKey, in processingWorkspace: CaptureWorkspace
  ) async {
    processingTasks[taskKey] = nil
    processingNotificationTasks[taskKey]?.cancel()
    processingNotificationTasks[taskKey] = nil
    let center = UNUserNotificationCenter.current()
    let notificationID = processingNotificationIdentifier(for: taskKey)
    center.removePendingNotificationRequests(withIdentifiers: [notificationID])
    center.removeDeliveredNotifications(withIdentifiers: [notificationID])
    guard isCurrentWorkspaceLocation(processingWorkspace) else { return }
    await loadLibrary()
  }

  private func cancelProcessingForWorkspaceChange() {
    for (taskKey, task) in processingTasks {
      task.cancel()
      processingNotificationTasks[taskKey]?.cancel()
      processingNotificationTasks[taskKey] = nil
      let center = UNUserNotificationCenter.current()
      let notificationID = processingNotificationIdentifier(for: taskKey)
      center.removePendingNotificationRequests(withIdentifiers: [notificationID])
      center.removeDeliveredNotifications(withIdentifiers: [notificationID])
    }
  }

  private func isCurrentWorkspace(_ candidate: CaptureWorkspace) -> Bool {
    workspace === candidate
  }

  private func isCurrentWorkspaceLocation(_ candidate: CaptureWorkspace) -> Bool {
    workspace?.rootURL == candidate.rootURL
  }

  private func hasObsoleteProcessingOwner(for candidate: CaptureWorkspace) -> Bool {
    let workspaceID = ObjectIdentifier(candidate)
    return processingTasks.keys.contains {
      $0.workspaceRootURL == candidate.rootURL && $0.workspaceID != workspaceID
    }
  }

  private func processingNotificationIdentifier(for taskKey: ProcessingTaskKey) -> String {
    "processing-\(taskKey.captureID)-\(taskKey.workspaceID.hashValue)"
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
        activity, feature: feature, source: source, mode: mode, itemCount: itemCount)
    }
  }

  private func accessToken() async throws -> String {
    guard let polyformClient else { throw JesSeeError.serviceNotConfigured }
    guard var session = workflowSession else { throw JesSeeError.signInRequired }
    if session.expiresAt <= Date() {
      signOutAfterAuthenticationFailure()
      throw JesSeeError.signInRequired
    }
    if session.expiresAt.timeIntervalSinceNow <= 12 * 60 * 60 {
      do {
        let task: Task<WorkflowAuthSession, Error>
        if let refreshTask {
          task = refreshTask
        } else {
          task = Task { try await polyformClient.refresh(session) }
          refreshTask = task
        }
        defer { refreshTask = nil }
        let refreshed = try await task.value
        guard workflowSession?.grantID == session.grantID else {
          throw CancellationError()
        }
        try JesSeeKeychain.saveWorkflowSession(refreshed)
        workflowSession = refreshed
        authenticationState = .signedIn(refreshed.email)
        session = refreshed
      } catch PolyformClientError.refreshTooEarly {
        // The local clock can enter the refresh window slightly before the server.
      } catch PolyformClientError.authenticationRequired {
        if let current = workflowSession,
          current.grantID != session.grantID,
          current.expiresAt > Date()
        {
          return current.accessToken
        }
        signOutAfterAuthenticationFailure()
        throw JesSeeError.signInRequired
      } catch is CancellationError {
        guard let current = workflowSession, current.expiresAt > Date() else {
          throw JesSeeError.signInRequired
        }
        return current.accessToken
      } catch {
        guard session.expiresAt > Date() else { throw error }
        return session.accessToken
      }
    }
    return session.accessToken
  }

  private func processingService(for provider: AIProviderMode?) async throws
    -> ProcessingServiceContext
  {
    switch provider {
    case .polyformCovered:
      guard let polyformClient else { throw JesSeeError.serviceNotConfigured }
      let token = try await accessToken()
      return ProcessingServiceContext(
        service: .polyform(client: polyformClient, accessToken: token),
        credential: .polyform(token))
    case .bringYourOwnKey:
      guard let apiKey = try JesSeeKeychain.loadAPIKey() else {
        throw JesSeeError.missingAPIKey
      }
      return ProcessingServiceContext(
        service: .openAI(client: DirectOpenAIClient(), apiKey: apiKey),
        credential: .openAI(apiKey))
    case nil:
      throw JesSeeError.invalidResponse("Choose how JesSee should cover AI processing first.")
    }
  }

  private func credentialIdentity(for provider: AIProviderMode?) -> ProcessingCredentialIdentity? {
    switch provider {
    case .polyformCovered:
      return workflowSession.map { .polyform($0.accessToken) }
    case .bringYourOwnKey:
      do {
        guard let apiKey = try JesSeeKeychain.loadAPIKey() else { return nil }
        return .openAI(apiKey)
      } catch {
        return nil
      }
    case nil:
      return nil
    }
  }

  private func hasRepairedCredential(
    after attemptedCredential: ProcessingCredentialIdentity?,
    for provider: AIProviderMode?,
    error: Error
  ) -> Bool {
    let isCredentialFailure: Bool = switch provider {
    case .bringYourOwnKey:
      error as? JesSeeError == .invalidAPIKey
    case .polyformCovered:
      if let clientError = error as? PolyformClientError,
        case .authenticationRequired = clientError
      {
        true
      } else {
        error as? JesSeeError == .signInRequired
      }
    case nil:
      false
    }
    guard isCredentialFailure, let currentCredential = credentialIdentity(for: provider) else {
      return false
    }
    return currentCredential != attemptedCredential
  }

  private func canProcess(_ record: CaptureRecord) -> Bool {
    guard let provider = record.processingProviderMode ?? configuration.aiProviderMode else {
      return false
    }
    switch provider {
    case .polyformCovered:
      return polyformManagedAIAvailable && polyformClient != nil && workflowSession != nil
    case .bringYourOwnKey:
      return hasAPIKey
    }
  }

  private func hasCredential(for recovery: CaptureProcessingRecovery) -> Bool {
    switch recovery {
    case .polyformSignIn:
      return polyformManagedAIAvailable && polyformClient != nil && workflowSession != nil
    case .openAIKey:
      return hasAPIKey
    }
  }

  private func signOutAfterAuthenticationFailure() {
    refreshTask?.cancel()
    refreshTask = nil
    try? JesSeeKeychain.removeWorkflowSession()
    workflowSession = nil
    authenticationState = .signedOut
    if configuration.aiProviderMode == .polyformCovered {
      configuration.setupCompleted = false
      setupStep = 0
    }
    persistConfiguration()
  }

  private func withPolyformAuthentication<Value: Sendable>(
    _ operation: @Sendable (PolyformClient, String) async throws -> Value
  ) async throws -> Value {
    guard let polyformClient else { throw JesSeeError.serviceNotConfigured }
    let token = try await accessToken()
    do {
      return try await operation(polyformClient, token)
    } catch {
      throw authenticationAwareError(error)
    }
  }

  private func authenticationAwareError(_ error: Error) -> Error {
    if let clientError = error as? PolyformClientError,
      case .authenticationRequired = clientError
    {
      signOutAfterAuthenticationFailure()
      return JesSeeError.signInRequired
    }
    return error
  }

  private func credentialRecovery(
    for error: Error, provider: AIProviderMode?
  ) -> CaptureProcessingRecovery? {
    guard let error = error as? JesSeeError else { return nil }
    switch (provider, error) {
    case (.polyformCovered, .signInRequired): return .polyformSignIn
    case (.bringYourOwnKey, .missingAPIKey), (.bringYourOwnKey, .invalidAPIKey):
      return .openAIKey
    default: return nil
    }
  }

  private func restoreCompletedSetupIfPossible(for mode: AIProviderMode) {
    guard configuration.aiProviderMode == mode,
      !configuration.outputFolderPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return }
    configuration.setupCompleted = true
    setupStep = 3
  }

  private func copyToPasteboard(_ value: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(value, forType: .string)
  }

  private func show(_ value: Notice) {
    notice = value
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(4))
      if self?.notice == value { self?.notice = nil }
    }
  }
}

private struct ProcessingServiceContext {
  var service: StoryProcessingService
  var credential: ProcessingCredentialIdentity
}

private enum ProcessingCredentialIdentity: Equatable {
  case polyform(String)
  case openAI(String)
}

private final class JesSeeNotificationDelegate: NSObject, UNUserNotificationCenterDelegate,
  @unchecked Sendable
{
  static let shared = JesSeeNotificationDelegate()

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler:
      @escaping (UNNotificationPresentationOptions)
      -> Void
  ) {
    completionHandler([.banner, .sound])
  }
}
