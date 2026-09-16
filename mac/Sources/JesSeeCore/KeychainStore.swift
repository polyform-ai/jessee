import Foundation
import Security

public enum JesSeeKeychain {
  private static let service = "ai.polyform.jessee"
  private static let account = "openai-api-key"

  public static var hasAPIKey: Bool {
    (try? loadAPIKey()) != nil
  }

  public static func saveAPIKey(_ value: String) throws {
    let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard key.hasPrefix("sk-"), key.count >= 20, let data = key.data(using: .utf8) else {
      throw JesSeeError.invalidAPIKey
    }

    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecAttrLabel as String: "JesSee OpenAI API key",
      kSecAttrDescription as String:
        "Used locally by JesSee to transcribe recordings and create visual stories.",
    ]

    let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if update == errSecItemNotFound {
      var item = query
      for (key, value) in attributes { item[key] = value }
      let add = SecItemAdd(item as CFDictionary, nil)
      guard add == errSecSuccess else { throw keychainError(add) }
    } else if update != errSecSuccess {
      throw keychainError(update)
    }
  }

  public static func loadAPIKey() throws -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess,
      let data = result as? Data,
      let value = String(data: data, encoding: .utf8)
    else {
      throw keychainError(status)
    }
    return value
  }

  public static func removeAPIKey() throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw keychainError(status)
    }
  }

  private static func keychainError(_ status: OSStatus) -> NSError {
    let message = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
    return NSError(
      domain: NSOSStatusErrorDomain, code: Int(status),
      userInfo: [NSLocalizedDescriptionKey: message])
  }
}
