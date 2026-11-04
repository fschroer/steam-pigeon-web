# Steam Pigeon — web flight viewer

Part of the **Steam Pigeon** system (Locator + Receiver firmware + Android/iOS app + this
web viewer). This is a static TypeScript single-page app on Firebase Hosting. It lets a
flyer sign in with their app account, list the records the app uploaded to Firebase
Storage, chart them and download the CSV. The design is the Locator repo's ADR
"Flyers read their flights in a browser" (0042).

## System docs live in the Locator repo — read them first

All cross-system documentation is centralized at **`C:\STM32_Projects\Locator\docs\`**
(`fschroer/steam-pigeon-locator`). Before non-trivial work, read
`docs/SESSION_HANDOFF.md`, the ADR index `docs/adr/README.md` (reference ADRs by
**title, not number**), and ADR-0040 decisions 8 and 9 (the Firebase web store and
sharing by link).

## Load-bearing points

- **The web reads the `.csv`, never the `.bin`.** Porting the v8 decoder here would make
  one more hand-synced copy of the wire format. Do not add one without a new decision.
- **`storage.rules` lives here now and is deployed, not pasted** (`firebase deploy --only
  storage`). It guards the whole bucket, the phone app's uploads included. Review a change
  to it like code, and never loosen `users/{uid}` to anything wider without an ADR.
- **The Firebase web config stays out of git** (`.env.local`). Its `AIza` key is not a
  secret, but the project's secret scan flags it by design. Scan `git diff --cached` for
  `sk.`/`pk.`/`AIza` before committing.
- **Shared names copied by hand:** `src/channels.ts` `FLIGHT_STATES` mirrors the locator's
  `FlightStates` (`Rocket/Common/Inc/Types.hpp`), and `test/csv.test.ts` holds a copy of the
  export header (`FullRecordCsv.HEADER` in the Android app). Change them with their source.
- **Charts:** one unit per panel, never a dual axis. A series' color is fixed by its slot
  in its panel, so it never changes with what else is selected.

## Spelling

US English in docs, UI strings, comments and commit messages (meter, color, canceled).
Never respell an identifier. The full rule is in the Locator repo's `CLAUDE.md`.
