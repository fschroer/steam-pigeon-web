# Steam Pigeon Flights (web)

A browser view of the flights the Steam Pigeon app uploads to Firebase. Sign in with the
same Google or email account you use in the app to list your locators' records, chart any
channel against time with the flight events marked, download the full CSV (identical to
the locator's USB export) or the raw record, download the flight path as KML for Google
Earth, copy a share link, or delete a flight from the web store. Dark theme by default.

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

Each step names where it is done.

1. **Register a web app** — *Firebase console* → Project settings → General → *Add app*
   → Web. The "Also set up Firebase Hosting" box is optional; the first deploy creates the
   site either way. Copy `apiKey` and `appId` from its config into `.env.local`.
2. **Let the browser read Storage (CORS)** — *Google Cloud Shell*: console.cloud.google.com,
   project `steam-pigeon`, the `>_` icon at the top right. Upload `cors.json` (or recreate
   it there), then:
   ```sh
   gcloud storage buckets update gs://steam-pigeon.firebasestorage.app --cors-file=cors.json
   gcloud storage buckets describe gs://steam-pigeon.firebasestorage.app --format="default(cors_config)"
   ```
   Without this, sign-in works but every flight fails to load.
3. **Check authorized domains** — *Firebase console* → Authentication → Settings →
   Authorized domains. `steam-pigeon.web.app`, `steam-pigeon.firebaseapp.com` and
   `localhost` are there by default; only a custom domain has to be added.
4. **Firebase CLI** — *a terminal on your PC* (Node.js 22+):
   `npm install -g firebase-tools`, then `firebase login`.

### A custom domain

After the first deploy: *Firebase console* → Hosting → *Add custom domain*, and add the
DNS records it shows at your registrar. Then add the domain to Authorized domains (step 3)
and its `https://` origin to `cors.json`, and rerun step 2. `authDomain` can stay
`steam-pigeon.firebaseapp.com`, because sign-in uses a popup.

## Deploy

From the repo, in the same terminal as step 4:

```sh
npm run deploy   # build, then: firebase deploy --only hosting,storage
```

This publishes the site **and `storage.rules`**. The rules moved here from the Android
repo (`rocket-flight-manager/firebase/storage.rules`); the file is now the live copy, so
do not edit the rules in the console.
