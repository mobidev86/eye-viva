# Eye Academy voice viva (take-home, case EA-VIVA-001)

TanStack Start + Firebase Auth + Firestore. Fictional case, not clinical guidance.

## Run it (local demo, no Firebase project or API keys needed)

Needs Node 20+, and JDK 21+ for the Firebase emulators (`brew install openjdk@21`, then put it on PATH / set JAVA_HOME).

```bash
npm install
npm run emulators      # terminal 1: Auth :9099 + Firestore :8080 (project demo-eyeviva)
npm run dev            # terminal 2: http://localhost:3000   (use Chrome or Edge for the mic)
npm test               # 52 logic checks (no emulator), incl. all 24 case findings; checks 1-3 below are in here
npm run test:rules     # Firestore privacy rules, against the emulators
```
`src/routeTree.gen.ts` is generated (and gitignored) the first time you run `npm run dev` or `npm run build`; run `tsc` only after that.

Create an account on the home page, press "Start new viva", then speak (or type). To point at a real Firebase
project copy `.env.example` to `.env.local`, set `VITE_USE_EMULATOR=false` and the `VITE_FIREBASE_*` vars (see `src/lib/firebase.ts`) and deploy `firestore.rules`.

## What works (tested) / where I stopped

**Time spent:** 4 hours (brief limit: 4).

| Area | Status |
|---|---|
| Email/password sign-in, new attempt, attempt list | Works (browser-tested against emulators) |
| Findings and patient history by request (allergies, medications, PMH, family history...): right eye/left eye/both, value + unit shown and read back | Works (typed path browser-tested; unit tests) |
| Unavailable findings stated, never invented | Works (right gonioscopy, right fundus, RAPD, OCT, biometry, U&E) |
| One spoken follow-up that responds to the answer | Works, rule-based (see limits) |
| Saved attempts survive refresh; private to owner | Works: reload restored transcript, findings and revision; second account got "private to its owner"; rules tested (3 tests, re-run after the latest changes) |
| Revision point with page number + verbatim excerpt, or "no support" message | Works, extractive (no LLM) |
| Listening / thinking / speaking indicator | Works (colour + text + `aria-live`) |
| **Real microphone input** | Spoken in Chrome by the author: a "cornea" request was recognised and answered with both eyes read back (one turn confirmed; I did not test long sessions, other browsers or the auto-listen loop in depth). My own browser-pane tests were typed because that pane blocks the mic. |

The "I'm ready to give my diagnosis" button was browser-tested with an empty box (the examiner invites the answer and the next utterance is treated as it) and the typed-answer path with the same follow-up logic. Browser-pane tests used typed input, as that pane blocks the mic.

Stopped at: no LLM anywhere (deliberate, see below); no server-side token verification (the server functions only read static data, nothing is written server-side); no deploy; no UI for deleting attempts.

## Model choice and responsiveness

**Voice model: the browser's built-in Web Speech API** (`SpeechRecognition` for speech to text, `speechSynthesis` for the examiner voice).
Why: zero cost and keys, runs from an empty repo in four hours, streams interim text so the trainee sees what was heard.
The examiner's *facts* never pass through a generative model: findings come from the case JSON by lookup, so eye, value and units cannot be altered.
**Alternative considered:** OpenAI Realtime API (speech to speech). Better voice quality, barge-in, lower endpointing delay; rejected here because it needs paid keys and a token-minting server, and a generative voice model reading values risks paraphrasing "58 mmHg" or swapping eyes. If the brief needed natural conversation I'd use it for the follow-up question only, keeping findings deterministic.

**Measured voice turn.** Timer starts when the recogniser delivers the *final transcript* (`performance.now()` in `onresult`, or on Send for typed input) and stops at `SpeechSynthesisUtterance.onstart` (audio begins). That covers the server round-trip, rendering/saving and TTS start. It excludes the recogniser's end-of-speech wait, which I could not measure without a mic. Each examiner turn stores `latencyMs` and the page shows it.
**Observed, spoken in Chrome: 39 ms** (one turn, request "cornea", [screenshot of the on-page readout](docs/latency-spoken-chrome.png); n=1, so a data point, not a distribution). Earlier typed turns in the in-app browser gave 39 ms and 44 ms. The figure excludes the recogniser's end-of-speech wait, so the time from the trainee stopping speaking to hearing the examiner is longer than shown; I did not measure that part.

## Three repeatable checks (`npm test` runs 1–3; also done by hand in the app)

| # | Check | Input | Expected | Observed |
|---|---|---|---|---|
| 1 | Available finding | "What is the pressure in the right eye?" | Right eye only, `58 mmHg`, Goldmann 23:55, spoken "58 millimetres of mercury" | Same. UI card RIGHT / 58 mmHg. "visual acuity" (no eye) gave RIGHT 6/36 and LEFT 6/9, not swapped |
| 2 | Unavailable finding | "gonioscopy of the right eye" (also OCT, RAPD) | "not available" + reason, no value | "Right eye. Gonioscopy: not available. No view: corneal oedema." Card shown hatched. OCT: "Not performed in casualty" |
| 3 | Citation supports revision | Answer: angle closure, timolol, analgesia, acetazolamide, laser iridotomy both eyes (no allergy check) | Point about sulfonamide check, cited from the acute-attack section (p5-6), excerpt literally on the page | Retrieved pages **6, 5** (retrieval is scoped to the acute-attack pages 3-7; the p9 drug table is a distractor and is excluded); cited **page 6**: "Check for sulfonamide allergy, kidney disease, low potassium and sickle cell disease before giving it." Verbatim match to page text enforced in code (`citationIsVerbatim`) |
| 3b | No support | query for "intravitreal dexamethasone implant dose" | No citation, trainee told | Returns null; UI shows "I could not find support…" |

Bugs the citation checks caught (a reviewer found the last two):
- My first support rule accepted the p9 drug table (a distractor) for the sulfonamide point.
- The fellow-eye point never found support, because the note says "LPI" on p6 and my rule demanded "iridotomy" in the same sentence. Now `LPI|iridotomy`.
- The topical-drops point cited the whole p9 table (~1,350 characters). Retrieval is now scoped to pages 3-7, and excerpts are trimmed to a short verbatim window around the match (max 280 characters).
`npm test` now runs one test per key point asserting page, length and verbatim presence.

## Handover

**Preparing the note** (`scripts/prep_note.py`, output committed as `data/note-chunks.json`; re-run with `pip install pypdf && npm run prep:note`, no need for the demo): pypdf extracts text per page; running footers dropped; known headings recorded so each chunk keeps its section; text cut into 3-sentence windows (stride 2). Each chunk keeps its page number (printed page == PDF page). Full page text is also stored for the verbatim check.
**Selecting passages** (`src/lib/retrieval.ts`): the trainee's answers (only turns tagged answer/reply, not their finding requests) are tested against an ordered list of key points from the examiner notes (sulfonamide check, fellow-eye iridotomy, stopping chlorphenamine, pilocarpine timing, analgesia/antiemetic, topical drops). The first missed one becomes the topic. BM25 retrieves the top chunks from the acute-attack pages (3-7; other pages are distractors per the case file), then a sentence is accepted only if it contains required phrases for that topic. If nothing qualifies, the app says so instead of citing a nearby passage. The revision point is the gap statement plus the quoted sentence, so nothing is paraphrased.

**AI tooling, one concrete example.** An AI coding assistant wrote the Firestore rules test. Its first version used `@firebase/rules-unit-testing` and failed with `firestore is not a function`; I did not trust a green result from a workaround, so I rewrote it to drive the real client SDK against the Auth + Firestore emulators with two accounts. Verified by running `npm run test:rules` (3 pass), and separately in the browser (second account blocked). Another: saved attempts silently stopped saving after the first answer. I found it by reloading and comparing the transcript, traced it to Firestore rejecting `undefined`, and fixed it by stripping undefined values before writing; I re-ran the full flow and a refresh to confirm.

**How I read "generate one revision point".** I made it extractive on purpose: the point is a gap statement chosen from the trainee's own answer plus a sentence quoted verbatim from the note. That makes every citation checkable and costs nothing. A model-written point would read more naturally but could drift from the note. If the client expects an LLM, it slots in after retrieval (see the improvement below).

**Improvement I prioritised (sketched, not built): an LLM that must quote.** Replace the keyword follow-up and gap detection with a model call that receives the trainee's answer and the retrieved chunks, and returns a revision point plus an excerpt. The excerpt is rejected, and the "no support" message shown, unless it passes `citationIsVerbatim` against the cited page. I chose this first because wrong or invented citations are the worst failure for a revision tool, and the guard already exists and is tested.

**Limits worth knowing before the walkthrough**
- Follow-up and revision are rule/keyword based, so unusual phrasing ("acetazolamide" misspelled, "beta blocker" variants) can be missed.
- Finding and history detection is a keyword map (`src/lib/findings.ts`). "Blood pressure" and "afferent pupil" phrases are rewritten first so they do not trigger IOP or the pupil exam. Requests are told from answers by how the sentence starts ("Can I see…" vs "I would give…").
- Server functions are unauthenticated; fine locally, add Firebase ID-token verification before deploying.
- Attempt data is stored as one document per attempt.

## AI costs
None. No paid API is used, so there is no receipt to attach.
