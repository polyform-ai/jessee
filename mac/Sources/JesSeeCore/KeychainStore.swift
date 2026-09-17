import Foundation
import Security

public enum JesSeeKeychain {
  private static let service = "ai.polyform.jessee.mac"
  private static let workflowAccount = "polyform-workflow-auth-v1"
  private static let apiKeyAccount = "openai-api-key"

  public static func saveAPIKey(_ value: String) throws {
    try saveAPIKey(value, service: service)
  }

  static func saveAPIKey(_ value: String, service: String) throws {
    let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard key.hasPrefix("sk-"), key.count >= 20, let data = key.data(using: .utf8) else {
      throw JesSeeError.invalidAPIKey
    }
    try save(
      data, service: service, account: apiKeyAccount, label: "JesSee OpenAI API key",
      description: "Used locally to transcribe recordings and create visual stories.")
  }

  public static func loadAPIKey() throws -> String? { try loadAPIKey(service: service) }

  static func loadAPIKey(service: String) throws -> String? {
    guard let data = try load(service: service, account: apiKeyAccount) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  public static func removeAPIKey() throws { try removeAPIKey(service: service) }

  static func removeAPIKey(service: String) throws {
    try remove(service: service, account: apiKeyAccount)
  }

  public static func saveWorkflowSession(_ session: WorkflowAuthSession) throws {
    try saveWorkflowSession(session, service: service)
  }

  static func saveWorkflowSession(_ session: WorkflowAuthSession, service: String) throws {
    guard !session.accessToken.isEmpty else { throw JesSeeError.signInRequired }
    try save(
      JesSeeJSON.encoder().encode(session), service: service, account: workflowAccount,
      label: "JesSee account",
      description: "Polyform workflow access used to create stories and publish PDFs.")
  }

  public static func loadWorkflowSession() throws -> WorkflowAuthSession? {
    try loadWorkflowSession(service: service)
  }

  static func loadWorkflowSession(service: String) throws -> WorkflowAuthSession? {
    guard let data = try load(service: service, account: workflowAccount) else { return nil }
    return try JesSeeJSON.decoder().decode(WorkflowAuthSession.self, from: data)
  }

  public static func removeWorkflowSession() throws {
    try removeWorkflowSession(service: service)
  }

  static func removeWorkflowSession(service: String) throws {
    try remove(service: service, account: workflowAccount)
  }

  private static func save(
    _ data: Data, service: String, account: String, label: String, description: String
  ) throws {
    let itemQuery = query(service: service, account: account)
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrLabel as String: label,
      kSecAttrDescription as String: description,
    ]
    let update = SecItemUpdate(itemQuery as CFDictionary, attributes as CFDictionary)
    if update == errSecItemNotFound {
      var item = itemQuery
      for (key, value) in attributes { item[key] = value }
      let add = SecItemAdd(item as CFDictionary, nil)
      guard add == errSecSuccess else { throw keychainError(add) }
    } else if update != errSecSuccess {
      throw keychainError(update)
    }
  }

  private static func load(service: String, account: String) throws -> Data? {
    var lookup = query(service: service, account: account)
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw keychainError(status) }
    return data
  }

  private static func remove(service: String, account: String) throws {
    let status = SecItemDelete(query(service: service, account: account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw keychainError(status)
    }
  }

  private static func query(service: String, account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private static func keychainError(_ status: OSStatus) -> NSError {
    let message = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
    return NSError(
      domain: NSOSStatusErrorDomain, code: Int(status),
      userInfo: [NSLocalizedDescriptionKey: message])
  }
}
