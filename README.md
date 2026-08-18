# n8n-nodes-google-play

n8n community nodes for Google Play app reviews, via the [Android Publisher API v3](https://developers.google.com/android-publisher):

- **Google Play** — fetch and reply to reviews.
- **Google Play Trigger** — polls for new (and optionally updated) reviews.

Looking for the Apple App Store? See [`@maximiliana/n8n-nodes-app-store`](https://www.npmjs.com/package/@maximiliana/n8n-nodes-app-store).

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install:

```
@maximiliana/n8n-nodes-google-play
```

## Credentials

Authentication uses a Google Cloud **service account**. The credential signs an RS256 JWT with the service account key and exchanges it for a short-lived OAuth2 access token (`https://www.googleapis.com/auth/androidpublisher` scope). Tokens are refreshed automatically when they expire.

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or reuse) a project and create a **service account** (no roles needed).
2. Create a **JSON key** for it and download the file.
3. In [Google Play Console](https://play.google.com/console) → **Users and permissions**, invite the service account email and grant it at least **View app information** and **Reply to reviews** on the relevant app(s).
4. In n8n, create a **Google Play API** credential with:
   - **Service Account Email**: the `client_email` field of the JSON key.
   - **Private Key**: the `private_key` field of the JSON key (escaped `\n` and pasted formatting are handled automatically).

## Operations

| Operation | Description |
| --- | --- |
| Get | Retrieve a single review by ID |
| Get Many | List recent reviews of an app |
| Reply | Post or update the developer reply to a review (max 350 characters) |

Notes from the underlying API:

- Only reviews **with a text comment**, created or modified **within the last week**, are returned. Older reviews are only available as CSV exports from the Google Play Console.
- Reviews can optionally be machine-translated with the **Translation Language** option.
- Replying again to the same review **overwrites** the previous reply.

## Trigger

The trigger uses n8n polling (configure the schedule in the node's **Poll Times**). On each poll it fetches reviews newer than the previous poll and emits the ones not seen before. Options:

- **Lookback Margin (Minutes)** (default 15): each poll also re-checks the interval *before* the previous poll by this margin, to compensate for the delay with which Google Play surfaces new reviews. Overlapping reviews are deduplicated, so a larger margin never produces duplicates.
- **Include Updated Reviews**: also trigger when an already-seen review is edited.
- **Simplify**: emit a flattened, friendly review object (default) instead of the raw API payload.
- **Translation Language**: machine-translate the review texts.

The first poll only establishes the baseline and emits nothing (historical reviews are not replayed). Executing the trigger manually returns the latest reviews, so you can inspect the output shape while building the workflow.

### Simplified output

```jsonc
{
  "reviewId": "gp:AOqpTOE…",
  "authorName": "Jane",
  "rating": 5,
  "text": "Great app",
  "lastModifiedDate": "2026-08-12T12:00:00.000Z",
  "appVersionName": "2.1.0",
  "device": "a54x",
  "developerReplyText": "Thanks!",
  "developerReplyDate": "2026-08-12T13:00:00.000Z"
}
```

## Rate limits

The Google Play Developer API allows 200 review-read requests per hour per app. A poll normally costs a single request, so even polling every minute stays within the quota — but the quota is shared by every workflow that reads reviews of the same app.

## Security notes

- Private keys are stored encrypted by n8n (`password`-type fields) and never leave the instance: tokens are generated locally and only sent to the official Google endpoints over HTTPS.
- Use a dedicated service account with the minimum permissions (*View app information* + *Reply to reviews*).
- API error responses are surfaced with their original message, without leaking request headers or credentials.

## About

This package is built and maintained by [Maximiliana](https://maximiliana.es) (BUKIT APP, SL), where we use it in production for our own apps. It is offered as-is, on a **best-effort basis**, with no warranty or support commitment — but it's here, it works, and we intend to keep it that way.

Issues and **pull requests are welcome** on [GitHub](https://github.com/maximiliana-dev/n8n-nodes-google-play). For anything else, reach out at [pedro@maximiliana.es](mailto:pedro@maximiliana.es).

Google Play and the Google Play logo are trademarks of Google LLC. This project is not affiliated with, endorsed or sponsored by Google; the name and logo are used solely to identify the service the nodes integrate with.

## License

MIT
