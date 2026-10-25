# HireWithSense

**AI-assisted technical interviews with a person in charge.**

HireWithSense runs the first-round technical interview that recruiting teams otherwise struggle to
schedule: an AI interviewer asks questions grounded in the job description and the candidate's
resume, the candidate answers by voice or text, then solves coding problems in a real in-browser IDE
whose submissions are graded against hidden test cases in an isolated sandbox. Recruiters receive a
report that scores each competency in the job's rubric and quotes the evidence behind every score,
alongside a separate panel of integrity signals. The software never makes a hiring decision; a
recruiter reads the report and records one, with a reason.

The platform is built for the regulatory reality of automated hiring tools: candidates see and
accept a versioned AI-disclosure notice before they start, evaluation is restricted to job-related
content with personal identifiers redacted, every sensitive action is audited, scores can be
exported for bias audits, and data is purged on a per-organization retention schedule.

## Contents

- [What's in the box](#whats-in-the-box)
- [Architecture at a glance](#architecture-at-a-glance)
- [Install and run from a fresh clone](#install-and-run-from-a-fresh-clone)
- [Demo accounts](#demo-accounts)
- [Configuration](#configuration)
- [Deploying](#deploying)
- [Documentation](#documentation)
- [Project status](#project-status)

## What's in the box

**For recruiters**

- Jobs with a weighted competency rubric (behaviourally anchored levels optional), a question bank
  with expected signals and follow-up hints, and coding problems with sample and hidden test cases.
- Interview plans made of ordered sections (conversation, coding) with their own timers.
- Email invitations, single or bulk, that double as secure sign-in links for candidates.
- A review workspace per interview: report, question-by-question answers with per-answer
  evaluations, submitted code with the full test matrix, transcript, integrity timeline, consent
  record and audit entries, plus the decision form.
- Rankings per job with per-competency columns and CSV export; an organization dashboard.
- Organization membership with owner, admin and member roles.

**For candidates**

- Accept an invitation, create an account in a minute, upload a resume (PDF, DOCX or TXT) that is
  parsed into a structured profile.
- A lobby with a device check and the AI-disclosure notice; an accommodation request field.
- A voice-first interview room: the interviewer reads each question aloud and listens for the
  answer, which is transcribed to text for the candidate to check before sending (server-side
  speech when audio models are configured, the browser's own engines otherwise). Typing is always
  one click away. A live transcript and a clear timer sit alongside.
- A coding room with Monaco, several languages, run-samples with custom input, and asynchronous
  grading with locked hidden cases.
- Control over their data: sessions, password, a one-click export of everything held about them, and account deletion.

**Under the hood**

- Fastify 5 API in TypeScript on PostgreSQL, with every request and response described by Zod
  schemas shared with the frontend and published as OpenAPI.
- Rotating refresh tokens with reuse detection, account lockout, rate limiting, request ids,
  structured logs and Prometheus metrics.
- Background jobs on pg-boss (resume parsing, grading, report generation, email, deadline sweeps,
  retention purge) with no additional infrastructure.
- A model-agnostic AI layer: any OpenAI-compatible endpoint, or a deterministic offline provider so
  the whole product runs without credentials.
- Pluggable code execution: a Docker sandbox with no network and hard resource limits, a Judge0
  adapter for hosted setups, and a development-only local runner.
- React 19 + Vite + Tailwind 4 frontend with light and dark themes.

## Architecture at a glance

```
┌──────────────┐   HTTPS    ┌──────────────────────┐          ┌──────────────┐
│  Web (React) │ ─────────▶ │  API (Fastify)       │ ───────▶ │  PostgreSQL  │
│  nginx image │  /api, SSE │  auth · jobs ·       │          │  + pg-boss   │
└──────────────┘            │  interviews · coding │          └──────────────┘
                            │  reports · jobs      │
                            └──────┬───────┬───────┘
                                   │       │
                     OpenAI-compatible   Docker sandbox / Judge0
                     model endpoint      (code execution)
```

A deeper description, including the data model and the interview state machine, is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install and run from a fresh clone

You need **Node.js 24** (22.12 or newer also works), **pnpm 10** and a **PostgreSQL** server. Docker
is optional but recommended: it is the easiest way to get Postgres and it powers the coding sandbox.

```bash
# 1. Get the code
git clone git@github.com:gautamkapoor1709/HirewithSense.git
cd HirewithSense

# 2. Use the right Node and install dependencies
nvm use                      # reads .nvmrc (or: nvm install 24)
corepack enable && corepack prepare pnpm@10.33.0 --activate
pnpm install

# 3. Start a database (port 5433 avoids clashing with a local Postgres)
docker run -d --name hws-postgres \
  -e POSTGRES_USER=hws -e POSTGRES_PASSWORD=hws -e POSTGRES_DB=hirewithsense \
  -p 5433:5432 postgres:16-alpine

# 4. Configure the API, then set JWT_SECRET to any 32+ character string
cp apps/api/.env.example apps/api/.env

# 5. Create the schema and load demo data
pnpm db:migrate
pnpm db:seed

# 6. (optional) images for the code sandbox
./scripts/pull-sandbox-images.sh

# 7. Run everything
pnpm dev
```

Open http://localhost:5173 for the app and http://localhost:4000/docs for the interactive API
reference. Emails are not sent in development; open **Dev mailbox** in the sidebar to click
invitation and reset links.

The step-by-step version with troubleshooting is in [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

### Running the tests

```bash
docker exec hws-postgres psql -U hws -d postgres -c "create database hirewithsense_test"
pnpm test                                        # unit + integration
TEST_CODE_RUNNER=docker pnpm --filter @hws/api test   # also exercise the sandbox
```

## Demo accounts

The seed creates two organizations, each with an open job (a conversation section plus a
two-problem coding round), a recruiter who owns the organization, and a candidate whose interview
is ready to start. The password for every demo account is `DemoPassword123!`.

| Organization | Role | Email | Lands on |
| --- | --- | --- | --- |
| Northwind Labs | Recruiter (owner) | `recruiter@demo.hirewithsense.local` | `/recruiter` |
| Northwind Labs | Candidate | `candidate@demo.hirewithsense.local` | `/app` |
| Sukhoi-dev | Recruiter (owner) | `recruiter@sukhoi-dev.hirewithsense.local` | `/recruiter` |
| Sukhoi-dev | Candidate | `candidate@sukhoi-dev.hirewithsense.local` | `/app` |

Northwind Labs is hiring a Backend Engineer (Node.js); Sukhoi-dev is hiring a Software Engineer.
The seed is idempotent per organization, so re-running it after adding a new demo organization
only creates what is missing.

## Configuration

Everything is configured through environment variables, validated at boot. The defaults in
`apps/api/.env.example` run entirely offline. The three settings you will change first:

| Setting | Options |
| --- | --- |
| `AI_PROVIDER` | `mock` (offline, default) or `openai_compatible` with `AI_API_KEY`, `AI_MODEL`, and `AI_BASE_URL` for Gemini, DashScope, Groq, Ollama and others |
| `CODE_RUNNER` | `docker` (sandbox containers on the API host), `judge0` (hosted), `local` (development only), `none` |
| `EMAIL_TRANSPORT` | `outbox` (stored in the database, default), `smtp`, `console` |

The complete list with explanations is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#environment-reference).

## Deploying

```bash
cp .env.example .env            # set POSTGRES_PASSWORD, JWT_SECRET, PUBLIC_WEB_URL, and your AI / Judge0 / SMTP keys
docker compose up -d --build    # Postgres + API + web on http://localhost:8080
```

The web container proxies `/api` to the API, migrations run on boot, and health probes are at
`/health/live` and `/health/ready`. Put a TLS terminator in front and you are done. Details,
scaling notes and the runner trade-offs are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Document | Read it when |
| --- | --- |
| [Getting started](docs/GETTING_STARTED.md) | You want a local instance running |
| [Architecture](docs/ARCHITECTURE.md) | You want to understand the system before changing it |
| [Diagrams](docs/DIAGRAMS.md) | You want the architecture, ER, database and use-case diagrams |
| [Development guide](docs/DEVELOPMENT.md) | You are about to write code |
| [API reference](docs/API.md) | You are integrating with or extending the API |
| [AI and scoring](docs/AI_AND_SCORING.md) | You want to know how reports are produced and how to use a real model |
| [Code execution](docs/CODE_EXECUTION.md) | You are setting up or extending the sandbox |
| [Frontend](docs/FRONTEND.md) | You are working on the web app |
| [Deployment](docs/DEPLOYMENT.md) | You are putting it on a server |
| [Compliance](docs/COMPLIANCE.md) | You need to explain consent, retention, audit and fairness features |

## Project status

Version 2 is a complete rewrite of the original MVP. The API has an integration test suite that
walks the full journey from job creation to a recorded decision, the sandbox has its own tests,
both Docker images build in CI, and the candidate and recruiter flows have been exercised end to end
in a browser. Candidates can download a complete export of their data, and the interview room uses
server-side transcription and speech when the API has audio enabled, falling back to the browser's
speech engines otherwise. Known gap: the recruiter code viewer identifies problems by id rather
than title.

## License

Private. All rights reserved by the HireWithSense authors.
