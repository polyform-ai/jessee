import AppKit
import JesSeeCore

struct BrowserApplicationContext: Equatable, Sendable {
  let bundleIdentifier: String
  let processIdentifier: pid_t
}

struct BrowserPageContext: Equatable, Sendable {
  let application: BrowserApplicationContext
  let windowID: CGWindowID?
  let displayID: CGDirectDisplayID?
  let url: String
}

@MainActor
enum BrowserURLReader {
  private static let safariBundleIdentifiers: Set<String> = [
    "com.apple.Safari",
    "com.apple.SafariTechnologyPreview",
  ]

  private static let chromiumBundleIdentifiers: Set<String> = [
    "com.brave.Browser",
    "com.google.Chrome",
    "com.google.Chrome.beta",
    "com.google.Chrome.canary",
    "com.microsoft.edgemac",
    "com.microsoft.edgemac.Beta",
    "com.microsoft.edgemac.Dev",
    "com.vivaldi.Vivaldi",
    "company.thebrowser.Browser",
    "org.chromium.Chromium",
  ]

  static func frontmostSupportedBrowser() -> BrowserApplicationContext? {
    guard let application = NSWorkspace.shared.frontmostApplication,
      let bundleIdentifier = application.bundleIdentifier,
      script(for: bundleIdentifier) != nil
    else { return nil }
    return BrowserApplicationContext(
      bundleIdentifier: bundleIdentifier,
      processIdentifier: application.processIdentifier)
  }

  static func currentPage(for expectedApplication: BrowserApplicationContext) -> BrowserPageContext? {
    let applications = NSRunningApplication.runningApplications(
      withBundleIdentifier: expectedApplication.bundleIdentifier
    ).filter { !$0.isTerminated }
    guard applications.count == 1,
      let application = applications.first,
      application.processIdentifier == expectedApplication.processIdentifier,
      let scriptSource = script(for: expectedApplication.bundleIdentifier)
    else { return nil }

    var scriptError: NSDictionary?
    guard
      let rawValue = NSAppleScript(source: scriptSource)?
        .executeAndReturnError(&scriptError).stringValue,
      let normalizedURL = PolyformClient.normalizedWebURL(rawValue)
    else { return nil }
    let window = frontmostWindow(for: application.processIdentifier)
    return BrowserPageContext(
      application: expectedApplication,
      windowID: window?.id,
      displayID: window.flatMap { displayID(containing: $0.frame) },
      url: normalizedURL)
  }

  private static func frontmostWindow(for processIdentifier: pid_t) -> (
    id: CGWindowID, frame: CGRect
  )? {
    guard
      let windowInfo = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[CFString: Any]]
    else { return nil }
    for window in windowInfo {
      guard (window[kCGWindowOwnerPID] as? NSNumber)?.int32Value == processIdentifier,
        (window[kCGWindowLayer] as? NSNumber)?.intValue == 0,
        let windowNumber = (window[kCGWindowNumber] as? NSNumber)?.uint32Value,
        let bounds = window[kCGWindowBounds] as? NSDictionary,
        let frame = CGRect(dictionaryRepresentation: bounds),
        frame.width > 0, frame.height > 0
      else { continue }
      return (windowNumber, frame)
    }
    return nil
  }

  private static func displayID(containing frame: CGRect) -> CGDirectDisplayID? {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return nil }
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return nil }
    return displays.prefix(Int(count)).max { lhs, rhs in
      CGDisplayBounds(lhs).intersection(frame).area
        < CGDisplayBounds(rhs).intersection(frame).area
    }
  }

  private static func script(for bundleIdentifier: String) -> String? {
    if safariBundleIdentifiers.contains(bundleIdentifier) {
      return """
        tell application id "\(bundleIdentifier)"
          if (count of windows) is 0 then return ""
          return URL of current tab of front window
        end tell
        """
    }
    if chromiumBundleIdentifiers.contains(bundleIdentifier) {
      return """
        tell application id "\(bundleIdentifier)"
          if (count of windows) is 0 then return ""
          return URL of active tab of front window
        end tell
        """
    }
    return nil
  }
}

private extension CGRect {
  var area: CGFloat { isNull ? 0 : width * height }
}
