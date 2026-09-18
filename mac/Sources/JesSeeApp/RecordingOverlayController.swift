import AppKit
import Carbon.HIToolbox
import JesSeeCore
import SwiftUI

@MainActor
final class RecordingOverlayModel: ObservableObject {
  @Published var tool: RecordingMarkupKind?
  @Published var strokes: [RecordingMarkupStroke] = []
  @Published var currentPoints: [RecordingMarkupPoint] = []
  @Published var micLevel: Double = 0
  @Published var isStopping = false
  private(set) var startedAt = Date()
  private var lastMicUpdate = Date.distantPast

  var visibleStrokes: [RecordingMarkupStroke] {
    strokes.filter { $0.removedAtSeconds == nil }
  }

  func reset(startedAt: Date) {
    self.startedAt = startedAt
    tool = nil
    strokes = []
    currentPoints = []
    micLevel = 0
    lastMicUpdate = .distantPast
    isStopping = false
  }

  func toggle(_ nextTool: RecordingMarkupKind) {
    tool = tool == nextTool ? nil : nextTool
    currentPoints = []
  }

  func beginStroke(at point: CGPoint, size: CGSize) {
    guard tool != nil else { return }
    currentPoints = [normalized(point, in: size)]
  }

  func continueStroke(at point: CGPoint, size: CGSize) {
    guard tool != nil, !currentPoints.isEmpty else { return }
    let next = normalized(point, in: size)
    guard let last = currentPoints.last,
      hypot(next.x - last.x, next.y - last.y) > 0.002
    else { return }
    currentPoints.append(next)
  }

  func finishStroke(at point: CGPoint, size: CGSize) {
    guard let tool, !currentPoints.isEmpty else { return }
    continueStroke(at: point, size: size)
    if currentPoints.count > 1 {
      strokes.append(
        RecordingMarkupStroke(
          kind: tool,
          points: currentPoints,
          createdAtSeconds: elapsedSeconds))
    }
    currentPoints = []
  }

  func undo() {
    guard let index = strokes.lastIndex(where: { $0.removedAtSeconds == nil }) else { return }
    strokes[index].removedAtSeconds = elapsedSeconds
  }

  func clear() {
    let removedAt = elapsedSeconds
    for index in strokes.indices where strokes[index].removedAtSeconds == nil {
      strokes[index].removedAtSeconds = removedAt
    }
    currentPoints = []
  }

  func updateMicLevel(_ level: Double) {
    let now = Date()
    guard now.timeIntervalSince(lastMicUpdate) >= 0.05 else { return }
    lastMicUpdate = now
    let next = max(0, min(1, level))
    micLevel = micLevel * 0.58 + next * 0.42
  }

  private var elapsedSeconds: Double {
    max(0, Date().timeIntervalSince(startedAt))
  }

  private func normalized(_ point: CGPoint, in size: CGSize) -> RecordingMarkupPoint {
    RecordingMarkupPoint(
      x: max(0, min(1, point.x / max(1, size.width))),
      y: max(0, min(1, point.y / max(1, size.height))))
  }
}

@MainActor
final class RecordingOverlayController {
  let model = RecordingOverlayModel()

  private var annotationPanel: NSPanel?
  private var hudPanel: NSPanel?
  private var hotKeys: RecordingHotKeyController?

  func start(
    contentRect: CGRect,
    displayID: CGDirectDisplayID?,
    startedAt: Date,
    onStop: @escaping () -> Void,
    onRedo: @escaping () -> Void
  ) {
    stopPanels()
    model.reset(startedAt: startedAt)

    let recordingFrame = Self.appKitFrame(for: contentRect, displayID: displayID)
    let overlay = NSPanel(
      contentRect: recordingFrame,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false)
    configure(panel: overlay, level: .statusBar)
    overlay.hasShadow = false
    overlay.ignoresMouseEvents = true
    overlay.contentView = NSHostingView(rootView: RecordingMarkupOverlay(model: model))
    overlay.orderFrontRegardless()
    annotationPanel = overlay

    let hudWidth: CGFloat = min(660, max(360, recordingFrame.width - 24))
    let hudFrame = NSRect(
      x: recordingFrame.midX - hudWidth / 2,
      y: recordingFrame.minY + 18,
      width: hudWidth,
      height: 104)
    let hud = NSPanel(
      contentRect: hudFrame,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false)
    configure(
      panel: hud,
      level: NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1))
    hud.hasShadow = true
    hud.contentView = NSHostingView(
      rootView: RecordingHUDView(
        model: model,
        setTool: { [weak self] in self?.setTool($0) },
        undo: { [weak self] in self?.model.undo() },
        clear: { [weak self] in self?.model.clear() },
        redo: onRedo,
        stop: onStop))
    hud.orderFrontRegardless()
    hudPanel = hud

    hotKeys = RecordingHotKeyController { [weak self] action in
      Task { @MainActor in
        guard let self else { return }
        switch action {
        case .draw: self.setTool(.pen)
        case .highlight: self.setTool(.highlight)
        case .undo: self.model.undo()
        case .clear: self.model.clear()
        case .redo: onRedo()
        case .stop: onStop()
        }
      }
    }
  }

  func setStopping() {
    model.isStopping = true
    model.tool = nil
    annotationPanel?.ignoresMouseEvents = true
  }

  func updateMicLevel(_ level: Double) {
    model.updateMicLevel(level)
  }

  func finish() -> [RecordingMarkupStroke] {
    let result = model.strokes
    stopPanels()
    return result
  }

  func cancel() {
    stopPanels()
    model.strokes = []
  }

  private func setTool(_ tool: RecordingMarkupKind) {
    guard !model.isStopping else { return }
    model.toggle(tool)
    annotationPanel?.ignoresMouseEvents = model.tool == nil
  }

  private func configure(panel: NSPanel, level: NSWindow.Level) {
    panel.level = level
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
  }

  private func stopPanels() {
    hotKeys = nil
    annotationPanel?.orderOut(nil)
    hudPanel?.orderOut(nil)
    annotationPanel = nil
    hudPanel = nil
  }

  private static func appKitFrame(
    for contentRect: CGRect,
    displayID: CGDirectDisplayID?
  ) -> CGRect {
    let resolvedDisplayID =
      displayID
      ?? NSScreen.screens.compactMap {
        screen -> (
          CGDirectDisplayID, CGFloat
        )? in
        guard
          let id =
            (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?
            .uint32Value
        else { return nil }
        let overlap = CGDisplayBounds(id).intersection(contentRect)
        return (id, overlap.isNull ? 0 : overlap.width * overlap.height)
      }.max(by: { $0.1 < $1.1 })?.0
    let screen =
      resolvedDisplayID.flatMap { id in
        NSScreen.screens.first {
          ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?
            .uint32Value == id
        }
      } ?? NSScreen.main ?? NSScreen.screens[0]
    let cgBounds =
      resolvedDisplayID.map(CGDisplayBounds)
      ?? CGRect(origin: .zero, size: screen.frame.size)
    let x = screen.frame.minX + contentRect.minX - cgBounds.minX
    let y = screen.frame.maxY - (contentRect.maxY - cgBounds.minY)
    let converted = CGRect(x: x, y: y, width: contentRect.width, height: contentRect.height)
    let intersection = converted.intersection(screen.frame)
    return intersection.isNull || intersection.width < 80 || intersection.height < 80
      ? screen.frame : intersection
  }
}

private struct RecordingMarkupOverlay: View {
  @ObservedObject var model: RecordingOverlayModel

  var body: some View {
    GeometryReader { geometry in
      Canvas { context, size in
        for stroke in model.visibleStrokes {
          draw(stroke, in: &context, size: size)
        }
        if let tool = model.tool, model.currentPoints.count > 1 {
          draw(
            RecordingMarkupStroke(
              kind: tool, points: model.currentPoints, createdAtSeconds: 0),
            in: &context,
            size: size)
        }
      }
      .contentShape(Rectangle())
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { value in
            if model.currentPoints.isEmpty {
              model.beginStroke(at: value.location, size: geometry.size)
            } else {
              model.continueStroke(at: value.location, size: geometry.size)
            }
          }
          .onEnded { value in
            model.finishStroke(at: value.location, size: geometry.size)
          })
    }
    .background(Color.clear)
  }

  private func draw(
    _ stroke: RecordingMarkupStroke,
    in context: inout GraphicsContext,
    size: CGSize
  ) {
    guard let first = stroke.points.first else { return }
    var path = Path()
    path.move(to: CGPoint(x: first.x * size.width, y: first.y * size.height))
    for point in stroke.points.dropFirst() {
      path.addLine(to: CGPoint(x: point.x * size.width, y: point.y * size.height))
    }
    switch stroke.kind {
    case .pen:
      context.stroke(
        path,
        with: .color(.red),
        style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
    case .highlight:
      context.stroke(
        path,
        with: .color(.yellow.opacity(0.46)),
        style: StrokeStyle(lineWidth: 22, lineCap: .round, lineJoin: .round))
    }
  }
}

private struct RecordingHUDView: View {
  @ObservedObject var model: RecordingOverlayModel
  let setTool: (RecordingMarkupKind) -> Void
  let undo: () -> Void
  let clear: () -> Void
  let redo: () -> Void
  let stop: () -> Void
  @State private var hoveredControl: String?

  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 9) {
        Circle().fill(.red).frame(width: 9, height: 9)
        RecordingElapsedTime(startedAt: model.startedAt)
          .font(.system(size: 14, weight: .bold))
          .frame(width: 48, alignment: .leading)
        MicrophoneMeter(level: model.micLevel)
        Divider().frame(height: 24)
        RecordingToolButton(
          title: "Draw", shortcut: "⌥D", systemImage: "pencil.tip",
          isActive: model.tool == .pen,
          onHover: showControl
        ) { setTool(.pen) }
        RecordingToolButton(
          title: "Highlight", shortcut: "⌥H", systemImage: "highlighter",
          isActive: model.tool == .highlight,
          onHover: showControl
        ) { setTool(.highlight) }
        RecordingToolButton(
          title: "Undo", shortcut: "⌥Z", systemImage: "arrow.uturn.backward",
          onHover: showControl
        ) {
          undo()
        }
        RecordingToolButton(
          title: "Clear", shortcut: "⌥C", systemImage: "eraser",
          onHover: showControl
        ) {
          clear()
        }
        Spacer(minLength: 2)
        RecordingToolButton(
          title: "Redo take", shortcut: "⌥R", systemImage: "arrow.counterclockwise",
          onHover: showControl
        ) {
          redo()
        }
        Button(action: stop) {
          VStack(spacing: 1) {
            Label(model.isStopping ? "Finishing…" : "Stop", systemImage: "stop.fill")
              .font(.system(size: 12, weight: .bold))
            Text("⌥S").font(.system(size: 8, weight: .bold)).opacity(0.82)
          }
        }
        .buttonStyle(.borderedProminent).tint(.red).disabled(model.isStopping)
        .jesseeHoverHelp("Stop and process · ⌥S", onChange: showControl)
      }
      Text(
        hoveredControl
          ?? "Hover a control for help · click the active tool again to return to the page"
      )
      .font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
      .contentTransition(.opacity)
    }
    .padding(.horizontal, 13).padding(.vertical, 10)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 15, style: .continuous)
        .stroke(.white.opacity(0.3), lineWidth: 1)
    )
    .padding(8)
  }

  private func showControl(_ label: String?) {
    withAnimation(.easeOut(duration: 0.12)) { hoveredControl = label }
  }
}

struct RecordingElapsedTime: View {
  let startedAt: Date

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      let seconds = max(0, Int(context.date.timeIntervalSince(startedAt)))
      Text(String(format: "%02d:%02d", seconds / 60, seconds % 60)).monospacedDigit()
    }
  }
}

struct MicrophoneMeter: View {
  let level: Double

  var body: some View {
    HStack(spacing: 2) {
      Image(systemName: "mic.fill").font(.system(size: 12)).foregroundStyle(.secondary)
      ForEach(0..<4, id: \.self) { index in
        Capsule()
          .fill(level * 4 > Double(index) ? Color.green : Color.secondary.opacity(0.22))
          .frame(width: 3, height: CGFloat(7 + index * 3))
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Microphone level")
    .accessibilityValue(level > 0.05 ? "Active" : "Quiet")
  }
}

private struct RecordingToolButton: View {
  let title: String
  let shortcut: String
  let systemImage: String
  var isActive = false
  let onHover: (String?) -> Void
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 1) {
        Image(systemName: systemImage).font(.system(size: 13, weight: .semibold))
        Text(shortcut).font(.system(size: 8, weight: .bold)).foregroundStyle(.secondary)
      }
      .frame(minWidth: 29)
    }
    .buttonStyle(.plain)
    .padding(.vertical, 4).padding(.horizontal, 3)
    .background(
      isActive ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 7)
    )
    .foregroundStyle(isActive ? Color.accentColor : Color.primary)
    .jesseeHoverHelp("\(title) · \(shortcut)", onChange: onHover)
    .accessibilityLabel(title)
    .accessibilityHint("Shortcut \(shortcut)")
  }
}

private enum RecordingHotKeyAction: UInt32 {
  case draw = 1
  case highlight
  case undo
  case clear
  case redo
  case stop
}

private let recordingHotKeyHandler: EventHandlerUPP = { _, event, userData in
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
  guard status == noErr, let action = RecordingHotKeyAction(rawValue: hotKeyID.id) else {
    return OSStatus(eventNotHandledErr)
  }
  Unmanaged<RecordingHotKeyController>.fromOpaque(userData).takeUnretainedValue().perform(action)
  return noErr
}

private final class RecordingHotKeyController {
  private let handler: (RecordingHotKeyAction) -> Void
  private var eventHandler: EventHandlerRef?
  private var hotKeys: [EventHotKeyRef?] = []

  init(handler: @escaping (RecordingHotKeyAction) -> Void) {
    self.handler = handler
    var eventType = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard),
      eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(
      GetApplicationEventTarget(),
      recordingHotKeyHandler,
      1,
      &eventType,
      Unmanaged.passUnretained(self).toOpaque(),
      &eventHandler)
    register(.draw, keyCode: UInt32(kVK_ANSI_D))
    register(.highlight, keyCode: UInt32(kVK_ANSI_H))
    register(.undo, keyCode: UInt32(kVK_ANSI_Z))
    register(.clear, keyCode: UInt32(kVK_ANSI_C))
    register(.redo, keyCode: UInt32(kVK_ANSI_R))
    register(.stop, keyCode: UInt32(kVK_ANSI_S))
  }

  deinit {
    for hotKey in hotKeys { if let hotKey { UnregisterEventHotKey(hotKey) } }
    if let eventHandler { RemoveEventHandler(eventHandler) }
  }

  func perform(_ action: RecordingHotKeyAction) {
    handler(action)
  }

  private func register(_ action: RecordingHotKeyAction, keyCode: UInt32) {
    var reference: EventHotKeyRef?
    let identifier = EventHotKeyID(signature: 0x4A53_4545, id: action.rawValue)
    if RegisterEventHotKey(
      keyCode,
      UInt32(optionKey),
      identifier,
      GetApplicationEventTarget(),
      0,
      &reference) == noErr
    {
      hotKeys.append(reference)
    }
  }
}
