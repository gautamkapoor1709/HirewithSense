# Deployment

HireWithSense ships as two containers, an API and a static web bundle behind nginx, plus a
PostgreSQL database. The included `docker-compose.yml` runs all three on a single host and is the
reference deployment. The same images run unchanged on any container platform.

## Single host with Docker Compose

```bash
git clone git@github.com:gautamkapoor1709/HirewithSense.git
cd HirewithSense
cp .env.example .env
# edit .env: POSTGRES_PASSWORD, JWT_SECRET, PUBLIC_WEB_URL at minimum
docker compose up -d --build
docker compose exec api node dist/seed.js   # optional demo data
```

The web container listens on port 8080 (`WEB_PORT`) and proxies `/api` and `/docs` to the API
container, so the browser only ever talks to one origin. Migrations run when the API starts.

Put a TLS terminator (Caddy, Traefik, a cloud load balancer) in front of port 8080 and set
`PUBLIC_WEB_URL` to the public https URL. `TRUST_PROXY=true` is already set in the compose file so
client IPs in audit logs and rate limiting come from `X-Forwarded-For`. Keep `COOKIE_SECURE=auto`;
in production it marks the refresh cookie `Secure`.

## Environment reference

Every variable is validated at boot by `apps/api/src/config/env.ts`; a typo in a required value
stops the process with a readable message rather than failing later.

### Core

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | required | `postgres://user:pass@host:5432/db` |
| `DATABASE_POOL_MAX` | 10 | Connection pool size per API instance |
| `JWT_SECRET` | required | At least 32 characters; rotate by changing it, which signs everyone out |
| `ACCESS_TOKEN_TTL_SECONDS` | 900 | |
| `REFRESH_TOKEN_TTL_DAYS` | 30 | |
| `PUBLIC_WEB_URL` | `http://localhost:5173` | Used in emails and as the default CORS origin |
| `CLIENT_ORIGINS` | | Comma-separated extra origins |
| `COOKIE_DOMAIN` | | Set when the web app and API are on different subdomains |
| `TRUST_PROXY` | false | |
| `RUN_MIGRATIONS_ON_BOOT` | true | Set to false if you run migrations as a separate step |
| `LOG_LEVEL` | info | pino levels |
| `RATE_LIMIT_MAX` | 300 | Global per-minute limit |

### AI

| Variable | Default | Notes |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` | `openai_compatible` to use a model |
| `AI_BASE_URL` | | Empty for OpenAI; see `.env.example` for Gemini, DashScope, Groq, Ollama |
| `AI_API_KEY` | | |
| `AI_MODEL` | `gpt-4.1-mini` | Used for questions and evaluations |
| `AI_REASONING_MODEL` | | Optional stronger model for final reports |
| `AI_TIMEOUT_MS` | 60000 | |

### Speech (voice interviews)

| Variable | Default | Notes |
| --- | --- | --- |
| `SPEECH_PROVIDER` | `none` | `openai_compatible` for OpenAI or any engine with the same audio API |
| `SPEECH_BASE_URL` | | e.g. `http://speaches:8000/v1` for the bundled self-hosted engine |
| `SPEECH_API_KEY` | | OpenAI key; self-hosted engines ignore it |
| `SPEECH_STT_MODEL` | `gpt-4o-mini-transcribe` | `Systran/faster-whisper-small` with Speaches |
| `SPEECH_TTS_MODEL` | `gpt-4o-mini-tts` | `speaches-ai/Kokoro-82M-v1.0-ONNX` with Speaches |
| `SPEECH_TTS_VOICE` | `coral` | `af_heart` with Kokoro |
| `SPEECH_TTS_FORMAT` | `mp3` | |
| `AI_ENABLE_AUDIO` | false | Legacy: reuse the `AI_*` endpoint for speech |

Start the bundled engine with `docker compose --profile speech up -d`, then install the models once
with `./scripts/speech-models.sh`. It needs about 2 GB of RAM and roughly 1 GB of disk for models. See [AI_AND_SCORING.md](AI_AND_SCORING.md#speech-voice-interviews).

### Code execution

| Variable | Default | Notes |
| --- | --- | --- |
| `CODE_RUNNER` | `none` | `docker`, `judge0`, `local` (dev only) |
| `DOCKER_BIN` | `docker` | |
| `RUNNER_MAX_CONCURRENCY` | 4 | Parallel sandboxes per API instance |
| `JUDGE0_URL` | | e.g. `https://judge0-ce.p.rapidapi.com` or a self-hosted instance |
| `JUDGE0_API_KEY`, `JUDGE0_API_HOST` | | RapidAPI headers |
| `JUDGE0_AUTH_TOKEN` | | Self-hosted `X-Auth-Token` |

See [CODE_EXECUTION.md](CODE_EXECUTION.md) for the trade-offs between the runners.

### Email and storage

| Variable | Default | Notes |
| --- | --- | --- |
| `EMAIL_TRANSPORT` | `outbox` | `smtp` to send, `console` to print |
| `EMAIL_FROM` | | Display name and address |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | | |
| `STORAGE_DRIVER` | `local` | `s3` for any S3-compatible bucket |
| `UPLOAD_DIR` | `./uploads` | Local driver path; mount a volume |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | | The S3 driver loads `@aws-sdk/client-s3` lazily; add it to `apps/api` dependencies when you use it |

### Data governance

| Variable | Default | Notes |
| --- | --- | --- |
| `DEFAULT_RETENTION_DAYS` | 365 | Applied to new organizations; each can change its own |
| `SUPERADMIN_EMAILS` | | Comma-separated addresses that receive the superadmin role on sign-up |

## Choosing a code runner

- **`judge0`** is the right default for hosted deployments. The API only needs outbound HTTPS, and
  Judge0 handles isolation. RapidAPI's hosted Judge0 CE works out of the box; a self-hosted Judge0
  needs a host with cgroup v1.
- **`docker`** is simpler when the API host already runs Docker (a VM, a bare-metal box). Mount the
  Docker socket into the API container (`/var/run/docker.sock:/var/run/docker.sock`) and pull the
  images with `scripts/pull-sandbox-images.sh`. Each submission runs in a throwaway container with no
  network, a memory cap, a pid limit, dropped capabilities and a read-only root filesystem. Note that
  socket access gives the API container root-equivalent control of the host's Docker daemon; run it
  on a host dedicated to this workload.
- **`none`** disables the IDE's run and submit buttons; everything else works.

## Scaling and operations

- The API is stateless apart from the local upload directory. Run several replicas behind a load
  balancer with `STORAGE_DRIVER=s3` so resumes are shared. pg-boss coordinates jobs through the
  database, so every replica can process queues.
- Database: enable regular backups and point-in-time recovery. The `pgboss` schema can be excluded
  from logical backups if you prefer; it only holds transient job state and a week of history.
- Observability: logs are JSON (pino) with a `reqId` on every line; `GET /metrics` exposes request
  latency histograms, AI call counters by task and outcome, code runs by verdict, and job counters.
  `GET /health/ready` fails when the database is unreachable, so wire it to your orchestrator.
- Graceful shutdown: the process stops accepting connections, waits for in-flight requests and job
  handlers for up to fifteen seconds, then exits. Use `SIGTERM`.
- Upgrades: pull the new image, run `docker compose up -d`. Migrations apply on boot. We only ever
  add migrations, never rewrite old ones, so rolling forward is safe; roll back by restoring a
  database backup.

## Building images elsewhere

```bash
docker build -f apps/api/Dockerfile -t your-registry/hirewithsense-api:1.0 .
docker build -f apps/web/Dockerfile -t your-registry/hirewithsense-web:1.0 \
  --build-arg VITE_API_URL=https://api.example.com .   # only when the API is on another origin
```

The CI workflow builds both images on every push to `main` to catch Dockerfile regressions.
