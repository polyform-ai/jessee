import AppKit
import SwiftUI

/// SwiftUI's standard hover handling follows the host window's activation state. JesSee's
/// menu-bar popover and recording HUD intentionally use non-activating windows, so their icon
/// guidance needs a tracking area that remains active while another app is being recorded.
extension View {
  func jesseeHoverHelp(
    _ message: String,
    onChange: @escaping (String?) -> Void
  ) -> some View {
    help(message)
      .background(
        AlwaysActiveHoverArea { hovering in
          onChange(hovering ? message : nil)
        })
  }
}

private struct AlwaysActiveHoverArea: NSViewRepresentable {
  let onHover: (Bool) -> Void

  func makeNSView(context: Context) -> HoverTrackingView {
    HoverTrackingView(onHover: onHover)
  }

  func updateNSView(_ view: HoverTrackingView, context: Context) {
    view.onHover = onHover
  }
}

private final class HoverTrackingView: NSView {
  var onHover: (Bool) -> Void
  private var hoverTrackingArea: NSTrackingArea?

  init(onHover: @escaping (Bool) -> Void) {
    self.onHover = onHover
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func updateTrackingAreas() {
    if let hoverTrackingArea { removeTrackingArea(hoverTrackingArea) }
    let area = NSTrackingArea(
      rect: .zero,
      options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self,
      userInfo: nil)
    addTrackingArea(area)
    hoverTrackingArea = area
    super.updateTrackingAreas()
  }

  override func mouseEntered(with event: NSEvent) {
    onHover(true)
  }

  override func mouseExited(with event: NSEvent) {
    onHover(false)
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }
}
