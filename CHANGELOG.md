# Changelog

## 0.1.3

- Moved to a standalone repository (https://github.com/maximiliana-dev/n8n-nodes-google-play) so the n8n verification pre-checks can locate the node and credential sources. No functional changes.

## 0.1.2

- Compliance with the n8n verification scanner ruleset: triggers no longer declare `usableAsTool`, unhandled errors are always rethrown as typed n8n errors, and test files moved out of the package sources.

## 0.1.1

- First release published from GitHub Actions with an npm provenance attestation (no functional changes over 0.1.0).

## 0.1.0

Initial release.

- **Google Play** node: get, get many and reply to reviews (Android Publisher API v3, service account auth).
- **Google Play Trigger**: polling trigger for new (and optionally updated) reviews, with configurable lookback margin and deduplication.
- Simplified (flattened) review output by default, raw API payload optional.
