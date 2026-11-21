import AppKit
import Carbon.HIToolbox
import OSLog

struct GlobalHotKeyRegistration {
  let id: UInt32
  let keyCode: UInt32
  let modifiers: UInt32
}

private let globalHotKeyHandler: EventHandlerUPP = { _, event, userData in
  guard let event, let userData else { return OSStatus(eventNotHandledErr) }
  var hotKeyID = EventHotKeyID()
  let status = GetEventParameter(
    event,
    EventParamName(kEventParamDirectObject),
    EventParamType(typeEventHotKeyID),
    nil,
    MemoryLayout<EventHotKeyID>.size,
    nil,
    &hotKeyID)
  guard status == noErr else { return OSStatus(eventNotHandledErr) }
  let controller = Unmanaged<GlobalHotKeyController>.fromOpaque(userData).takeUnretainedValue()
  return controller.perform(hotKeyID) ? noErr : OSStatus(eventNotHandledErr)
}

final class GlobalHotKeyController: NSObject {
  private let logger = Logger(subsystem: "ai.polyform.jessee.mac", category: "shortcuts")
  private let signature: OSType
  private let registrations: [GlobalHotKeyRegistration]
  private let handler: (UInt32) -> Void
  private let workspaceNotifications = NSWorkspace.shared.notificationCenter
  private var eventHandler: EventHandlerRef?
  private var hotKeys: [EventHotKeyRef] = []

  init(
    signature: OSType,
    registrations: [GlobalHotKeyRegistration],
    handler: @escaping (UInt32) -> Void
  ) {
    self.signature = signature
    self.registrations = registrations
    self.handler = handler
    super.init()
    refreshRegistrations()
    for name in [NSWorkspace.didWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
      workspaceNotifications.addObserver(
        self, selector: #selector(workspaceDidResume(_:)), name: name, object: nil)
    }
  }

  deinit {
    workspaceNotifications.removeObserver(self)
    removeRegistrations()
  }

  @objc private func workspaceDidResume(_ notification: Notification) {
    performSelector(onMainThread: #selector(refreshRegistrations), with: nil, waitUntilDone: false)
  }

  @objc private func refreshRegistrations() {
    removeRegistrations()
    var eventType = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard),
      eventKind: UInt32(kEventHotKeyPressed))
    let status = InstallEventHandler(
      GetApplicationEventTarget(),
      globalHotKeyHandler,
      1,
      &eventType,
      Unmanaged.passUnretained(self).toOpaque(),
      &eventHandler)
    guard status == noErr else {
      logger.error("Could not install the shortcut event handler (OSStatus \(status)).")
      return
    }
    for registration in registrations {
      register(registration)
    }
  }

  private func removeRegistrations() {
    for hotKey in hotKeys { UnregisterEventHotKey(hotKey) }
    hotKeys.removeAll()
    if let eventHandler { RemoveEventHandler(eventHandler) }
    eventHandler = nil
  }

  fileprivate func perform(_ hotKeyID: EventHotKeyID) -> Bool {
    guard hotKeyID.signature == signature else { return false }
    handler(hotKeyID.id)
    return true
  }

  private func register(_ registration: GlobalHotKeyRegistration) {
    var reference: EventHotKeyRef?
    let identifier = EventHotKeyID(signature: signature, id: registration.id)
    let status = RegisterEventHotKey(
      registration.keyCode,
      registration.modifiers,
      identifier,
      GetApplicationEventTarget(),
      0,
      &reference)
    if status == noErr, let reference {
      hotKeys.append(reference)
    } else {
      logger.error("Could not register shortcut \(registration.id) (OSStatus \(status)).")
    }
  }
}
