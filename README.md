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

### Optional: the in-page 3D view

The flight page can show the flight on Google's photorealistic 3D map, with an
angled view and a fly-around. It needs a Google Maps Platform key; without one the
3D section just says it is unavailable. In the *Google Cloud console*
(console.cloud.google.com, project `steam-pigeon`, which already has billing because
Firebase is on Blaze):

1. APIs & Services → Library → enable **Maps JavaScript API**.
2. APIs & Services → Credentials → *Create credentials* → API key. Edit the key:
   - Application restrictions → **Websites**: `https://steam-pigeon.web.app/*`,
     `https://steam-pigeon.firebaseapp.com/*`, `http://localhost:5173/*` (and a
     custom domain, if any).
   - API restrictions → **Restrict key** → Maps JavaScript API only.
3. Put it in `.env.local` as `VITE_GOOGLE_MAPS_API_KEY=…`, then `npm run dev` or
   `npm run deploy`.
4. Recommended: Billing → Budgets & alerts, a small monthly budget with an email alert.

Each "Show 3D view" click is one billed map load ("Immersive Maps" SKU: 5,000 free
a month as of 2026-11; then about $7 per 1,000). The map never loads on its own.
The key ends up in the public site bundle, as every browser Maps key does; the
website and API restrictions above are what protect it.

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
