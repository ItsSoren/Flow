# Flow Push Relay

Small Cloudflare Worker relay for opt-in Flow reminders. Firebase remains on the Spark plan; the Worker verifies Firebase ID tokens and stores only each user's Web Push subscriptions and reminder category/time. It never receives balances, amounts, transaction labels, or account data. Scheduled bill and payday reminders are checked every five minutes. Pending reservation alerts are attempted immediately when a new reminder schedule arrives, so the app can show a heads-up during its five-minute refusal window.

## Deploy

1. Create a Cloudflare Workers KV namespace and copy `wrangler.toml.example` to `wrangler.toml`. Set the namespace ID and the exact production origin hosting Flow.
2. Generate a VAPID P-256 key pair. Put the base64url uncompressed public key in `VAPID_PUBLIC_KEY`, the PKCS#8 DER private key in the Worker secret `VAPID_PRIVATE_KEY`, and set `VAPID_SUBJECT` to a real `mailto:` contact.
3. Deploy the Worker, then configure the client with its URL and the same public key. Never commit `wrangler.toml` after adding IDs/secrets or expose the private key.
4. The browser sends authenticated `POST /subscribe`, `DELETE /subscribe`, and `PUT /reminders` requests. Each request must include `Authorization: Bearer <Firebase ID token>`.

The reminder API accepts only `{items:[{id,kind,at}]}` where `kind` is `payday`, `bill`, or `goal` and `at` is an ISO timestamp. The client should send only reminders the user enabled. Stable goal reminder IDs/times are deduplicated; immediate goal alerts have a one-per-minute cooldown per account. Notification content is intentionally generic so a lock screen does not disclose financial details. A push is best-effort and cannot reject a reservation; Flow's in-app refusal control and five-minute automatic confirmation remain authoritative.

## Limits

Scheduled reminders may be delayed by up to five minutes. Cloudflare KV and Worker free-plan quotas apply. The service must be deployed and its VAPID key must match the browser configuration before background notifications work. Deleting a Flow user or disabling notifications should call `DELETE /subscribe` and replace reminders with an empty list.
