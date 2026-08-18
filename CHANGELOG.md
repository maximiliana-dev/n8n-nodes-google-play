# Changelog

## 0.3.1

- **Fix: APK → Download Universal always reported "no universal APK".** The `generatedapks.list` response was parsed with the wrong field name (`generatedApksPerSigningKey`, the schema *type* name, instead of `generatedApks`, the actual field), so the universal APK was never found for any app. Verified against the androidpublisher v3 discovery document.

## 0.3.0

- **Trigger: New Production Release event.** The trigger now offers an Event selector (New Review remains the default). The new event polls the production track of the selected apps, deduplicates releases via a SHA-256 fingerprint of their version codes, and emits release metadata (`versionCodes`, `versionCode`, `status`, `rolloutPercentage`, `releaseNotes`, `appName`). Staged rollouts are configurable through **Emit When**: on rollout start, on rollout completion (100%), or both. Per-app state and error isolation work as for reviews.
- **Node: APK → Download Universal.** Downloads the signed universal APK that Play App Signing generates, for a specific version code or the latest production release, as a binary item.
- **Fix: survive old hoisted `n8n-workflow` copies.** On instances whose `~/.n8n/nodes` already held an `n8n-workflow` 1.x hoisted by other community packages, npm reused it (it satisfies the `*` peer range that n8n verification mandates) and the nodes failed to load with "Class could not be found", because 1.x does not export `NodeConnectionTypes`. The nodes now fall back to the literal connection type when the export is missing; a troubleshooting section documents how to refresh a stale hoisted copy.

## 0.2.1

- Trigger reviews now include `appName`, the store display name of the app, resolved automatically and cached in the polling state (falls back to the app identifier if the listing API is unavailable).

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
