import Foundation
import Sparkle

@MainActor
final class SoftwareUpdateController {
  static let shared = SoftwareUpdateController()

  private let controller: SPUStandardUpdaterController

  private init() {
    controller = SPUStandardUpdaterController(
      startingUpdater: true,
      updaterDelegate: nil,
      userDriverDelegate: nil
    )
  }

  func checkForUpdates() {
    controller.checkForUpdates(nil)
  }

  var displayVersion: String {
    let version =
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
      ?? "development"
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
    return build.map { "Version \(version) (\($0))" } ?? "Version \(version)"
  }
}
