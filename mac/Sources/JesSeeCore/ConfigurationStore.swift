import Foundation

public struct ConfigurationStore {
  private let defaults: UserDefaults
  private let key = "jessee.configuration.v1"

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func load() -> JesSeeConfiguration {
    guard let data = defaults.data(forKey: key),
      let configuration = try? JesSeeJSON.decoder().decode(JesSeeConfiguration.self, from: data)
    else {
      return JesSeeConfiguration()
    }
    return configuration
  }

  public func save(_ configuration: JesSeeConfiguration) throws {
    defaults.set(try JesSeeJSON.encoder().encode(configuration), forKey: key)
  }
}
