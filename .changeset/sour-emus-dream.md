---
"pico": minor
---

Connect providers with Pico's agent-first credential commands: URL-only OAuth/device sign-in, private API-key stdin, Keychain storage, and explicit provider selections. Credential changes apply to all sessions on their next provider request without changing model or reasoning choices.

Pico no longer reuses terminal OMP credentials or falls back to ambient provider credentials. Existing users must connect and select credentials in Pico. The Mac app remains unconnected, and current Sesh Autonomous sessions still cannot use Pico's Keychain store.
