# Frontend

The web app is a React single-page application built with Vite. It is deliberately plain: a router,
a query cache, a small store for the session, a hand-written component kit, and pages. This page
is a map for someone opening the code for the first time.

## Entry points

- `src/main.tsx` mounts `App`, which wires the query client, tooltip provider, toaster and router,
  and performs one silent session refresh on load so a returning user is signed in before any page
  renders.
- `src/app/router.tsx` declares every route. Pages are lazy so the first paint does not wait for
  Monaco or the recruiter screens.
- `src/app/layouts.tsx` has three shells: `PublicLayout` (landing, auth, invitations), `AppShell`
  (sidebar navigation for candidates and recruiters) and `FocusLayout` (full-height, no chrome,
  used by the interview and coding rooms).
- `src/app/guards.tsx` redirects by role: candidates cannot open recruiter pages and vice versa.

## Session and API

`src/lib/auth-store.ts` keeps the user and access token in memory. `src/lib/api.ts` is a thin fetch
wrapper: it attaches the bearer token, retries once after refreshing when the API answers 401,
unwraps the error envelope into an `ApiError` with the server's code and request id, and provides
`streamSse()` for the interviewer stream. Nothing sensitive is written to `localStorage`; only the
theme preference is.

Server state is cached by TanStack Query. Keys are centralised in `src/lib/query.ts` so invalidation
is greppable. Query and mutation errors become toasts by default.

## Pages by audience

**Public**: landing, sign in, candidate and recruiter sign-up, forgot and reset password, email
verification, invitation acceptance (`/invite/:token`), organization join (`/join/:token`).

**Candidate** (`/app`): dashboard of interviews, profile with resume upload and parsed profile,
security settings, interview lobby with device check and consent, the interview room, the coding
room, and a completion page.

**Recruiter** (`/recruiter`): dashboard, jobs list, job editor (details, rubric, interview plan),
job detail with tabs for overview, question bank, coding problems, candidates and invitations, and
rankings; interviews list; interview detail with report, Q&A, code, transcript, integrity and
consent tabs plus the decision panel; organization settings; integration status.

**Development**: `/dev/outbox` shows stored emails so you can click invitation and reset links.

## The interview room

`features/interview/InterviewRoomPage.tsx` is the most involved screen. It fetches the room state,
reuses an unanswered question if one exists, otherwise opens the question stream and renders tokens
as they arrive. The room is voice-first: on the first question it asks the candidate to begin the
voice session (browsers only play audio and open the microphone after a click), then reads every
question aloud and starts listening as soon as it has finished speaking. The spoken answer appears
in the composer as text so it can be corrected before it is sent; the preference is remembered per
browser and "I prefer to type" switches to the keyboard at any time. When the API reports server-side audio
(`AI_ENABLE_AUDIO=true`), dictation records the microphone with `MediaRecorder` and sends the clip
to `/ai/transcribe` when the candidate stops, which works in every modern browser; questions are
read aloud through `/ai/speak`. Without server audio the room uses the browser's own
`SpeechRecognition` and `speechSynthesis`. Those are probed rather than assumed: voices are loaded
asynchronously and a browser with none (common on Linux) is told so instead of failing silently; a
synthesis watchdog moves on if playback never starts; and recognition errors are translated into
plain explanations (Brave and most Chromium builds report `network` because Google's service is
unavailable to them). Depending on what works, the room reads aloud and listens, reads aloud and
asks for typed answers, or falls back to text entirely, and the "Begin voice interview" step says
which. The helpers for both paths are in `features/interview/speech.ts`. The composer records how long the candidate took,
the proctoring hook records focus, visibility, full-screen and paste events and sends them in
batches, and a countdown corrected for clock skew (the API returns its own time) drives the header.
A 410 from any write means the section's time is up; the page completes the section and routes to
whatever comes next.

## The coding room

`features/coding/CodingRoomPage.tsx` renders the problem list, a Markdown statement with sample
cases, and a Monaco editor bundled locally (workers are wired in `src/lib/monaco.ts`; nothing is
loaded from a CDN). Drafts autosave with a debounce and on navigation. "Run samples" is synchronous
and shows input, expected and actual output; "Submit" queues grading and polls until the verdicts
arrive, showing hidden cases as locked rows. The language menu only offers languages the server can
execute. When the countdown hits zero an overlay appears and the section completes itself.

## UI kit and theming

`src/components/ui` wraps Radix primitives (dialog, tabs, tooltip, dropdown, switch, checkbox,
progress, avatar) and adds buttons, inputs, cards, badges, tables, empty states, a page header, a
stat tile and a score ring. Styles are Tailwind utilities over the tokens declared in
`src/styles.css` (`bg`, `surface`, `border`, `fg`, `muted`, `accent`, status colours). Dark mode is
a `dark` class on the root element, toggled from the header and remembered per browser. Focus rings,
labels and `aria-live` regions are in place on the interactive pages; keep them when you change
things.

## Building

`pnpm --filter @hws/web build` type-checks and produces `apps/web/dist`. Set `VITE_API_URL` at build
time only if the API lives on a different origin; by default the app calls `/api` on its own origin,
which the nginx image proxies to the API.
