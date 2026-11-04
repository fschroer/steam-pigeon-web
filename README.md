# Steam Pigeon Flights (web)

A browser view of the flights the Steam Pigeon app uploads to Firebase. Sign in with the
same Google or email account you use in the app to list your locators' records, chart any
channel against time with the flight events marked, download the full CSV (identical to
the locator's USB export) or the raw record, and copy a share link.

Design: ADR "Flyers read their flights in a browser" in `fschroer/steam-pigeon-locator`
(`docs/adr/0042-flight-data-web-ui.md`).

## Develop

```sh
npm install
cp .env.example .env.local   # then fill in apiKey and appId (see below)
npm run dev                  # http://localhost:5173
npm test                     # unit tests (vitest)
npm run build                # type-check + production build into dist/
```

## One-time Firebase setup

1. **Register a web app.** Firebase console → Project settings → General → *Add app* →
   Web. Copy `apiKey` and `appId` from its config into `.env.local`. Hosting does not need
   to be set up from that screen; `firebase.json` here does it.
2. **Allow the browser to read Storage (CORS).** Once, from any machine with the Google
   Cloud SDK:
   ```sh
   gcloud storage buckets update gs://steam-pigeon.firebasestorage.app --cors-file=cors.json
   ```
   (`gsutil cors set cors.json gs://steam-pigeon.firebasestorage.app` does the same.)
   Without this, sign-in works but every flight fails to load.
3. **Authorized domains.** `steam-pigeon.web.app`, `steam-pigeon.firebaseapp.com` and
   `localhost` are on Authentication → Settings → Authorized domains by default. A custom
   domain would have to be added there and to `cors.json`.
4. **Firebase CLI.** `npm install -g firebase-tools`, then `firebase login`.

## Deploy

```sh
npm run deploy   # build, then: firebase deploy --only hosting,storage
```

This publishes the site **and `storage.rules`**. The rules moved here from the Android
repo (`rocket-flight-manager/firebase/storage.rules`); the file is now the live copy, so
do not edit the rules in the console.
