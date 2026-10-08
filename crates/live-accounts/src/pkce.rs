//! PKCE (RFC 7636): proof that the app that started the sign-in is the one
//! finishing it, so a desktop app needs no client secret.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// A code verifier and its S256 challenge.
#[derive(Clone, PartialEq, Eq)]
pub struct Pkce {
    /// Sent only with the token request (kept in memory until then).
    pub verifier: String,
    /// Sent in the sign-in address.
    pub challenge: String,
}

impl std::fmt::Debug for Pkce {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pkce")
            .field("challenge", &self.challenge)
            .finish_non_exhaustive()
    }
}

impl Pkce {
    /// A new random verifier (32 random bytes: 43 characters).
    ///
    /// # Errors
    /// The system's random numbers aren't available.
    pub fn new() -> Result<Self, String> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| format!("no random numbers ({e})"))?;
        Ok(Self::from_bytes(&bytes))
    }

    /// The verifier made from these bytes (base64url, no padding) and its challenge.
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let verifier = URL_SAFE_NO_PAD.encode(bytes);
        let challenge = challenge(&verifier);
        Pkce {
            verifier,
            challenge,
        }
    }
}

/// The S256 challenge of a verifier: base64url(SHA-256(verifier)).
#[must_use]
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// A random value for `state` (ties the browser's answer to this sign-in).
///
/// # Errors
/// The system's random numbers aren't available.
pub fn random_state() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("no random numbers ({e})"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_rfc_7636_example() {
        // RFC 7636, appendix B.
        let bytes = [
            116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212,
            37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
        ];
        let p = Pkce::from_bytes(&bytes);
        assert_eq!(p.verifier, "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
        assert_eq!(p.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert!(!format!("{p:?}").contains(&p.verifier));
    }

    #[test]
    fn random_verifiers_are_long_enough_and_differ() {
        let a = Pkce::new().unwrap();
        let b = Pkce::new().unwrap();
        assert_eq!(a.verifier.len(), 43);
        assert!(a
            .verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(a.verifier, b.verifier);
        assert_eq!(a.challenge, challenge(&a.verifier));
        assert_ne!(random_state().unwrap(), random_state().unwrap());
    }
}
