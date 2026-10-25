# Getting started

This guide takes you from a fresh clone to a running HireWithSense instance on your machine, with
demo data loaded and the coding sandbox working. It assumes a Unix-like shell (Linux, macOS, or
WSL on Windows). Budget about fifteen minutes, most of it waiting for downloads.

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 24 LTS (22.12 or newer works) | Node 20 reached end of life in April 2026 and several dependencies refuse to install on it. Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm); the repo ships an `.nvmrc`. |
| pnpm | 10.x | `corepack enable && corepack prepare pnpm@10.33.0 --activate` is the quickest route. |
| PostgreSQL | 14 or newer | We run 16 in Docker below. Any reachable Postgres works. |
| Docker | any recent | Optional. Needed for the local Postgres container and for the code-execution sandbox. Without it you can still run everything except the coding IDE. |

Check your versions:

```bash
node --version   # v24.x
pnpm --version   # 10.x
docker --version # optional
```

## 2. Clone and install

```bash
git clone git@github.com:gautamkapoor1709/HirewithSense.git
cd HirewithSense
nvm use            # picks up .nvmrc; or `fnm use`
pnpm install
```

`pnpm install` resolves the three workspaces (`apps/api`, `apps/web`, `packages/shared`) in one go.
The first run takes a minute or two; later runs are seconds.

## 3. Start a database

The quickest option is a throwaway Postgres container. Port 5433 is used on purpose so it does not
clash with a Postgres you may already have on 5432.

```bash
docker run -d --name hws-postgres \
  -e POSTGRES_USER=hws -e POSTGRES_PASSWORD=hws -e POSTGRES_DB=hirewithsense \
  -p 5433:5432 postgres:16-alpine
```

If you prefer your own server, create a database and a user and note the connection string; you
will put it in `DATABASE_URL` in the next step.

## 4. Configure the API

```bash
cp apps/api/.env.example apps/api/.env
```

The example is already pointed at the container above and uses offline-friendly defaults:

- `AI_PROVIDER=mock` so the interviewer, evaluations and reports work without any API key. Output
  is clearly labelled as offline placeholder content.
- `CODE_RUNNER=docker` so the IDE runs code in sandbox containers. Change it to `none` if you have
  no Docker, or to `local` (development only, no isolation) if you want the IDE without Docker.
- `EMAIL_TRANSPORT=outbox` so invitation and password-reset emails are stored in the database and
  readable from the **Dev mailbox** page in the web app instead of being sent.

Open the file and change `JWT_SECRET` to any random string of at least 32 characters. Everything
else can stay as it is for a first run.

## 5. Migrate and seed

```bash
pnpm db:migrate   # creates the schema
pnpm db:seed      # loads a demo organization, two jobs, and a candidate with an interview ready to start
```

The seed prints the demo credentials. They are also listed in the README. It is safe to run the
seed twice; it skips when the demo organization already exists.

## 6. Pull the sandbox images (optional)

If you chose `CODE_RUNNER=docker`:

```bash
./scripts/pull-sandbox-images.sh
```

This pulls `node:24-alpine`, `python:3.12-alpine`, `gcc:14`, `eclipse-temurin:21-jdk-alpine`,
`golang:1.23-alpine` and `rust:1-alpine`. You can pull a subset; languages whose image is missing
simply show as unavailable in the editor's language menu. The first three cover JavaScript,
TypeScript, Python, C and C++ and are enough for most demos.

## 7. (optional) Speech engine for voice interviews

The interview room reads questions aloud and transcribes spoken answers. Chrome and Edge on
Windows and macOS can do both on their own. Brave, most Chromium builds and many Linux browsers
cannot, so for a reliable voice experience run the free speech engine:

```bash
docker run -d --name hws-speaches -p 8000:8000 -e ENABLE_UI=false \
  -v hf-hub-cache:/home/ubuntu/.cache/huggingface/hub ghcr.io/speaches-ai/speaches:latest-cpu
./scripts/speech-models.sh    # downloads the two models into the engine (about 1 GB, once)
```

Then in `apps/api/.env`:

```ini
SPEECH_PROVIDER=openai_compatible
SPEECH_BASE_URL=http://localhost:8000/v1
SPEECH_STT_MODEL=Systran/faster-whisper-small
SPEECH_TTS_MODEL=speaches-ai/Kokoro-82M-v1.0-ONNX
SPEECH_TTS_VOICE=af_heart
```

`curl localhost:8000/health` returns `OK` once the engine is up; the models script reports what is
installed. Restart the API after changing `.env`. The Integrations page in the recruiter workspace
shows whether speech is active.

## 8. Run

```bash
pnpm dev
```

This starts the API on http://localhost:4000 (interactive OpenAPI docs at `/docs`) and the web app
on http://localhost:5173. The web dev server proxies `/api` to the API, so there is nothing to
configure for CORS during development.

Sign in as a recruiter to see the configured job, or as a candidate to run the interview that is
waiting for them. There are two demo organizations (Northwind Labs and Sukhoi-dev), each with a
recruiter and a candidate; the README lists the accounts. For the voice interview use Chrome or
Edge, which have built-in speech recognition, or enable server-side audio. To try the invitation flow end to end, invite any email address from the job's
**Candidates** tab, then open **Dev mailbox** in the sidebar and click the link in the stored email.

## 9. Run the tests

Tests use a separate database so they can truncate tables freely:

```bash
docker exec hws-postgres psql -U hws -d postgres -c "create database hirewithsense_test"
pnpm test
```

To include the sandbox tests (they start real containers):

```bash
TEST_CODE_RUNNER=docker pnpm --filter @hws/api test
```

## Common problems

**`pnpm install` fails with an engine error.** You are on Node 20 or older. Switch to 24.

**`DATABASE_URL` connection refused.** The container is not running (`docker ps`) or the port is
different. The default URL is `postgres://hws:hws@localhost:5433/hirewithsense`.

**"Language javascript is not available on this server's code runner".** Docker is not reachable
from the API process, or the image has not been pulled. Run `docker image inspect node:24-alpine`
to check, and restart the API after pulling because the runner caches its availability check.

**Emails never arrive.** They are not supposed to in development. Open the Dev mailbox page. If you
want real delivery, set `EMAIL_TRANSPORT=smtp` and the `SMTP_*` variables.

**Voice does not work: the question is not read aloud or the microphone stops immediately.** Your
browser has no speech voices or no usable speech recognition (Brave and Chromium report a
`network` error because Google's service is unavailable to them). The room tells you which. Run
the speech engine from step 7, or use Chrome on Windows/macOS.

**The interviewer asks oddly generic questions.** That is the offline provider. Set
`AI_PROVIDER=openai_compatible` and an `AI_API_KEY` to use a real model (see
[AI_AND_SCORING.md](AI_AND_SCORING.md)).
