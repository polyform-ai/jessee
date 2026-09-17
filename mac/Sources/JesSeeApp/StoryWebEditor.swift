import JesSeeCore
import SwiftUI
import WebKit

struct StoryWebEditor: NSViewRepresentable {
  struct Frame: Encodable {
    var filename: String
    var seconds: Double
  }

  struct Payload: Encodable {
    var story: StoryDocument
    var frames: [Frame]
  }

  struct BridgeMessage: Decodable {
    var type: String
    var story: StoryDocument
  }

  let story: StoryDocument
  let record: CaptureRecord
  let directoryURL: URL
  let onSave: (StoryDocument, Bool, @escaping (Bool, String) -> Void) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onSave: onSave) }

  func makeNSView(context: Context) -> WKWebView {
    let controller = WKUserContentController()
    controller.add(context.coordinator, name: "storyEditor")
    let configuration = WKWebViewConfiguration()
    configuration.userContentController = controller
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.setValue(false, forKey: "drawsBackground")
    context.coordinator.webView = webView
    load(in: webView)
    return webView
  }

  func updateNSView(_ webView: WKWebView, context: Context) {}

  static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "storyEditor")
  }

  private func load(in webView: WKWebView) {
    guard
      let scriptURL = Bundle.main.url(forResource: "mac-editor", withExtension: "js"),
      let styleURL = Bundle.main.url(forResource: "mac-editor", withExtension: "css"),
      let script = try? String(contentsOf: scriptURL, encoding: .utf8),
      let style = try? String(contentsOf: styleURL, encoding: .utf8)
    else {
      webView.loadHTMLString(
        "<p style='font-family:-apple-system;padding:24px'>The story editor resources are missing. Reinstall JesSee and try again.</p>",
        baseURL: nil)
      return
    }

    let frames = record.imageFilenames.enumerated().map { index, filename in
      Frame(
        filename: filename,
        seconds: record.imageTimes?[filename]
          ?? fallbackFrameTime(index: index, count: record.imageFilenames.count))
    }
    let payload = Payload(story: story, frames: frames)
    guard let data = try? JesSeeJSON.encoder().encode(payload),
      let json = String(data: data, encoding: .utf8)
    else { return }

    let safeJSON = json.replacingOccurrences(of: "<", with: "\\u003c")
    let safeScript = script.replacingOccurrences(of: "</script", with: "<\\/script")
    let html = """
      <!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>\(style)</style></head><body><main id="app"></main>
      <script>window.__JESSEE_EDITOR__=\(safeJSON);</script>
      <script>\(safeScript)</script></body></html>
      """
    let fileURL = directoryURL.appendingPathComponent(".jessee-editor.html")
    do {
      try html.write(to: fileURL, atomically: true, encoding: .utf8)
      webView.loadFileURL(fileURL, allowingReadAccessTo: directoryURL)
    } catch {
      webView.loadHTMLString(
        "<p style='font-family:-apple-system;padding:24px'>JesSee could not open this story editor.</p>",
        baseURL: nil)
    }
  }

  private func fallbackFrameTime(index: Int, count: Int) -> Double {
    guard let duration = record.duration, count > 0 else { return Double(index) }
    return (Double(index) + 0.5) * duration / Double(count)
  }

  @MainActor
  final class Coordinator: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    let onSave: (StoryDocument, Bool, @escaping (Bool, String) -> Void) -> Void

    init(onSave: @escaping (StoryDocument, Bool, @escaping (Bool, String) -> Void) -> Void) {
      self.onSave = onSave
    }

    func userContentController(
      _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
      guard message.name == "storyEditor",
        JSONSerialization.isValidJSONObject(message.body),
        let data = try? JSONSerialization.data(withJSONObject: message.body),
        let value = try? JesSeeJSON.decoder().decode(BridgeMessage.self, from: data)
      else {
        complete(success: false, message: "JesSee could not read the editor changes.")
        return
      }
      onSave(value.story, value.type == "saveAndOpenPDF") { [weak self] success, status in
        Task { @MainActor in self?.complete(success: success, message: status) }
      }
    }

    private func complete(success: Bool, message: String) {
      guard let data = try? JSONSerialization.data(withJSONObject: [success, message]),
        let arguments = String(data: data, encoding: .utf8)
      else { return }
      webView?.evaluateJavaScript("window.jesseeDidSave(...\(arguments))")
    }
  }
}
