import CryptoKit
import DeviceCheck
import ExpoModulesCore

/**
 * Thin bridge over Apple's DCAppAttestService.
 *
 * Hashing lives here rather than in JS so the bytes Apple signs are produced in
 * one place. Both hashes must match what the server computes:
 *   - attestKey       clientDataHash = SHA256(challenge)
 *   - generateAssertion clientDataHash = SHA256(canonical client data string)
 * See packages/api/src/modules/attestation/attestation.service.ts.
 */
public class AppAttestModule: Module {
  private let service = DCAppAttestService.shared

  public func definition() -> ModuleDefinition {
    Name("AppAttest")

    // False on the Simulator and on devices without a Secure Enclave, so the
    // caller can fall back instead of blocking the user.
    Function("isSupported") { () -> Bool in
      self.service.isSupported
    }

    AsyncFunction("generateKey") { (promise: Promise) in
      guard self.service.isSupported else {
        promise.reject("ERR_APP_ATTEST_UNSUPPORTED", "App Attest is not available on this device.")
        return
      }
      self.service.generateKey { keyId, error in
        if let error = error {
          promise.reject("ERR_APP_ATTEST_GENERATE_KEY", error.localizedDescription)
          return
        }
        guard let keyId = keyId else {
          promise.reject("ERR_APP_ATTEST_GENERATE_KEY", "App Attest returned no key identifier.")
          return
        }
        promise.resolve(keyId)
      }
    }

    AsyncFunction("attestKey") { (keyId: String, challenge: String, promise: Promise) in
      let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))
      self.service.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
        if let error = error {
          promise.reject("ERR_APP_ATTEST_ATTEST_KEY", error.localizedDescription)
          return
        }
        guard let attestation = attestation else {
          promise.reject("ERR_APP_ATTEST_ATTEST_KEY", "App Attest returned no attestation.")
          return
        }
        promise.resolve(attestation.base64EncodedString())
      }
    }

    AsyncFunction("generateAssertion") { (keyId: String, clientData: String, promise: Promise) in
      let clientDataHash = Data(SHA256.hash(data: Data(clientData.utf8)))
      self.service.generateAssertion(keyId, clientDataHash: clientDataHash) { assertion, error in
        if let error = error {
          promise.reject("ERR_APP_ATTEST_ASSERTION", error.localizedDescription)
          return
        }
        guard let assertion = assertion else {
          promise.reject("ERR_APP_ATTEST_ASSERTION", "App Attest returned no assertion.")
          return
        }
        promise.resolve(assertion.base64EncodedString())
      }
    }
  }
}
