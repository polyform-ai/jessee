import Carbon.HIToolbox

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

final class GlobalHotKeyController {
  private let signature: OSType
  private let handler: (UInt32) -> Void
  private var eventHandler: EventHandlerRef?
  private var hotKeys: [EventHotKeyRef?] = []

  init(
    signature: OSType,
    registrations: [GlobalHotKeyRegistration],
    handler: @escaping (UInt32) -> Void
  ) {
    self.signature = signature
    self.handler = handler
    var eventType = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard),
      eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(
      GetApplicationEventTarget(),
      globalHotKeyHandler,
      1,
      &eventType,
      Unmanaged.passUnretained(self).toOpaque(),
      &eventHandler)
    for registration in registrations {
      register(registration)
    }
  }

  deinit {
    for hotKey in hotKeys { if let hotKey { UnregisterEventHotKey(hotKey) } }
    if let eventHandler { RemoveEventHandler(eventHandler) }
  }

  fileprivate func perform(_ hotKeyID: EventHotKeyID) -> Bool {
    guard hotKeyID.signature == signature else { return false }
    handler(hotKeyID.id)
    return true
  }

  private func register(_ registration: GlobalHotKeyRegistration) {
    var reference: EventHotKeyRef?
    let identifier = EventHotKeyID(signature: signature, id: registration.id)
    if RegisterEventHotKey(
      registration.keyCode,
      registration.modifiers,
      identifier,
      GetApplicationEventTarget(),
      0,
      &reference) == noErr
    {
      hotKeys.append(reference)
    }
  }
}
