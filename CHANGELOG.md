# Changelog

## 0.2.0

- **Trigger: watch several apps.** The trigger now takes a multi-select app list (App Names or IDs); each app keeps its own polling state, so a temporary failure in one app never affects the others. Emitted reviews include the `packageName`.
- **App pickers.** The node selects the app with a searchable picker (From List / By ID) and the trigger with a multi-select, powered by the Play Developer Reporting API (`apps.search`) — enable that API in the Google Cloud project for the lists to load. The credential now also requests the `playdeveloperreporting` scope.
- **Breaking**: the trigger's `Package Name` parameter is replaced by the multi-select list, and the node's `Package Name` field is now a resource locator — existing workflows need the app(s) re-selected. Trigger state migrates automatically for single-app configurations.

## 0.1.4

- Restructure the private key parsing so invalid PEM keys are reported outside the catch block, complying with the community-nodes error-handling rule. No functional changes.

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
