# Diagrams

The diagrams below are written in [Mermaid](https://mermaid.js.org) so they render directly on
GitHub and in most editors, and so they can be reviewed in pull requests like any other text. Each
one lives in its own file under `docs/diagrams/` (source `.mmd` and a rendered `.svg`); this page
embeds the sources. If you change the schema or the architecture, update the matching diagram in
the same change.

To re-render the SVGs:

```bash
npx -y @mermaid-js/mermaid-cli -i docs/diagrams/<name>.mmd -o docs/diagrams/<name>.svg
```

| Diagram | Source | Rendered |
| --- | --- | --- |
| Architecture | [`diagrams/architecture.mmd`](diagrams/architecture.mmd) | [`architecture.svg`](diagrams/architecture.svg) |
| Entity-relationship | [`diagrams/er-diagram.mmd`](diagrams/er-diagram.mmd) | [`er-diagram.svg`](diagrams/er-diagram.svg) |
| Database schema | [`diagrams/db-diagram.mmd`](diagrams/db-diagram.mmd) | [`db-diagram.svg`](diagrams/db-diagram.svg) |
| Use cases | [`diagrams/use-case-diagram.mmd`](diagrams/use-case-diagram.mmd) | [`use-case-diagram.svg`](diagrams/use-case-diagram.svg) |

## 1. Architecture

How the deployable pieces fit together, including the external services the API talks to and
the background workers that share the API process.

```mermaid
flowchart LR
  subgraph Client["Browser"]
    WEB["React SPA\n(Vite, Tailwind, Monaco)"]
    SPEECH["Web Speech API\n(fallback STT / TTS)"]
  end

  subgraph Edge["Web container"]
    NGINX["nginx\nstatic files + /api proxy"]
  end

  subgraph API["API container (Fastify)"]
    ROUTES["HTTP routes\n/api/v1/*  ·  /docs  ·  /health  ·  /metrics"]
    AUTH["Auth\nJWT access + rotating refresh"]
    DOMAIN["Domain modules\norgs · jobs · invites · interviews · coding · reports"]
    AI["AI provider adapter\nOpenAI-compatible | offline"]
    RUNNER["Code runner adapter\nDocker | Judge0 | local"]
    JOBS["pg-boss workers\nresume.parse · submission.grade · report.generate\nemail.send · interview.expire · retention.purge"]
  end

  subgraph Data["Data"]
    PG[("PostgreSQL\napplication schema + pgboss schema")]
    FILES[("Resume storage\nlocal volume | S3")]
  end

  subgraph External["External services"]
    LLM["Model endpoint\nOpenAI · Gemini · Qwen · Groq · Ollama"]
    SANDBOX["Docker daemon\n(ephemeral sandbox containers)"]
    JUDGE0["Judge0 CE\n(hosted alternative)"]
    SMTP["SMTP relay"]
  end

  WEB -- "HTTPS, JSON + SSE" --> NGINX
  WEB -. optional .- SPEECH
  NGINX -- "/api, /docs" --> ROUTES
  ROUTES --> AUTH --> DOMAIN
  DOMAIN --> AI
  DOMAIN --> RUNNER
  DOMAIN -- enqueue --> JOBS
  JOBS --> AI
  JOBS --> RUNNER
  DOMAIN --> PG
  JOBS --> PG
  DOMAIN --> FILES
  AI -- "chat completions, audio" --> LLM
  RUNNER --> SANDBOX
  RUNNER --> JUDGE0
  JOBS -- "invitations, resets, notifications" --> SMTP
```

## 2. Entity-relationship diagram

The conceptual model: which entities exist and how they relate. Cardinalities read left to right.

```mermaid
erDiagram
  ORGANIZATION ||--o{ MEMBERSHIP : "has"
  USER ||--o{ MEMBERSHIP : "holds"
  ORGANIZATION ||--o{ ORG_INVITE : "issues"
  ORGANIZATION ||--o{ JOB : "owns"
  USER ||--o{ REFRESH_SESSION : "signs in with"
  USER ||--o{ AUTH_TOKEN : "receives"
  USER ||--o{ RESUME : "uploads"
  JOB ||--o{ QUESTION : "banks"
  JOB ||--o{ CODING_PROBLEM : "defines"
  JOB ||--o{ INTERVIEW_INVITE : "sends"
  INTERVIEW_INVITE ||--o| INTERVIEW : "creates on acceptance"
  JOB ||--o{ INTERVIEW : "is assessed by"
  USER ||--o{ INTERVIEW : "takes (as candidate)"
  RESUME |o--o{ INTERVIEW : "provides context for"
  INTERVIEW ||--o{ CONSENT : "records"
  INTERVIEW ||--o{ INTERVIEW_TURN : "asks"
  QUESTION |o--o{ INTERVIEW_TURN : "sourced from"
  INTERVIEW ||--o{ TRANSCRIPT_EVENT : "logs"
  INTERVIEW ||--o{ CODE_DRAFT : "autosaves"
  INTERVIEW ||--o{ CODE_SUBMISSION : "grades"
  CODING_PROBLEM ||--o{ CODE_SUBMISSION : "solved in"
  INTERVIEW ||--o{ PROCTORING_EVENT : "observes"
  INTERVIEW ||--o| REPORT : "summarised by"
  INTERVIEW ||--o| DECISION : "concluded by"
  USER |o--o{ DECISION : "recorded by (recruiter)"
  ORGANIZATION ||--o{ AUDIT_LOG : "scopes"
  USER |o--o{ AUDIT_LOG : "acts in"
```

## 3. Database diagram

The physical schema as implemented in `apps/api/src/db/schema.ts`: tables, key columns and types.
Secondary columns such as `created_at` and `updated_at` are omitted where they carry no meaning.

```mermaid
erDiagram
  users {
    uuid id PK
    text name
    text username UK
    text email UK
    text password_hash
    user_role role "candidate | recruiter | superadmin"
    timestamptz email_verified_at
    int failed_login_attempts
    timestamptz locked_until
    int token_version
    timestamptz deleted_at
  }
  organizations {
    uuid id PK
    text name
    text slug UK
    text website
    int retention_days
  }
  memberships {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    org_role role "owner | admin | member"
  }
  org_invites {
    uuid id PK
    uuid organization_id FK
    text email
    org_role role
    text token_hash UK
    uuid invited_by FK
    timestamptz expires_at
    timestamptz accepted_at
  }
  refresh_sessions {
    uuid id PK
    uuid user_id FK
    text token_hash UK
    uuid family_id
    text user_agent
    text ip
    timestamptz expires_at
    timestamptz revoked_at
    timestamptz last_used_at
  }
  auth_tokens {
    uuid id PK
    uuid user_id FK
    auth_token_purpose purpose "password_reset | email_verify"
    text token_hash UK
    timestamptz expires_at
    timestamptz used_at
  }
  resumes {
    uuid id PK
    uuid user_id FK
    text original_name
    text mime_type
    int size_bytes
    text storage_key
    text extracted_text
    parse_status parse_status
    jsonb profile
  }
  jobs {
    uuid id PK
    uuid organization_id FK
    text title
    text slug "unique per organization"
    text description
    jsonb skills
    job_status status "draft | open | closed | archived"
    jsonb competencies "weights sum to 100"
    jsonb interview_plan "ordered sections"
    float minimum_score
    text bias_audit_url
    uuid created_by FK
  }
  questions {
    uuid id PK
    uuid job_id FK
    text prompt
    text competency_key
    difficulty difficulty
    jsonb expected_signals
    jsonb follow_up_hints
    int order
  }
  coding_problems {
    uuid id PK
    uuid job_id FK
    text title
    text statement "markdown"
    difficulty difficulty
    jsonb language_ids
    jsonb starter_code "per language"
    int time_limit_ms
    int memory_limit_mb
    jsonb test_cases "input, expectedOutput, isSample, weight"
  }
  interview_invites {
    uuid id PK
    uuid job_id FK
    uuid organization_id FK
    text email
    text token_hash UK
    invite_status status
    timestamptz expires_at
    timestamptz accepted_at
    uuid interview_id
    uuid invited_by FK
  }
  interviews {
    uuid id PK
    uuid job_id FK
    uuid organization_id FK
    uuid candidate_id FK
    uuid invite_id FK
    uuid resume_id FK
    interview_status status "ready | in_progress | submitted | completed | expired | cancelled"
    jsonb plan "snapshot of the job plan"
    jsonb sections "per-section progress and deadlines"
    int current_section
    timestamptz consented_at
    timestamptz started_at
    timestamptz overall_deadline
    timestamptz complete_by
    timestamptz submitted_at
    timestamptz completed_at
    report_status report_status
  }
  consents {
    uuid id PK
    uuid interview_id FK
    uuid user_id FK
    text disclosure_version
    text text_hash
    text accommodation_request
    text ip
    text user_agent
    timestamptz consented_at
  }
  interview_turns {
    uuid id PK
    uuid interview_id FK
    int section_index
    int order
    text question
    text competency_key
    turn_source source "bank | generated | follow_up"
    uuid question_id
    text answer
    timestamptz answered_at
    float answer_duration_seconds
    text input_mode
    bool skipped
    jsonb evaluation
  }
  transcript_events {
    uuid id PK
    uuid interview_id FK
    int section_index
    speaker speaker "interviewer | candidate | system"
    text text
    uuid turn_id
    timestamptz at
  }
  code_drafts {
    uuid id PK
    uuid interview_id FK
    uuid problem_id "unique with interview_id"
    text language_id
    text source_code
  }
  code_submissions {
    uuid id PK
    uuid interview_id FK
    uuid problem_id
    int section_index
    text language_id
    text source_code
    text kind "run | submit"
    submission_status status
    int passed
    int total
    float score
    jsonb results "per-case verdicts"
    text runner
    timestamptz graded_at
  }
  proctoring_events {
    uuid id PK
    uuid interview_id FK
    text type
    timestamptz at
    int section_index
    jsonb meta
  }
  reports {
    uuid id PK
    uuid interview_id FK "unique"
    report_status status
    text summary
    jsonb strengths
    jsonb considerations
    jsonb competencies "score, level, confidence, evidence"
    float weighted_score
    float coverage
    text recommendation
    bool meets_minimum
    jsonb integrity
    text provider
    text model
    timestamptz generated_at
  }
  decisions {
    uuid id PK
    uuid interview_id FK "unique"
    decision decision "advance | hold | reject | hire"
    text reason
    bool overrides_recommendation
    uuid decided_by FK
    timestamptz decided_at
  }
  audit_logs {
    uuid id PK
    uuid organization_id
    uuid actor_id
    text action
    text target_type
    text target_id
    jsonb meta
    text ip
    timestamptz created_at
  }
  email_outbox {
    uuid id PK
    text to
    text subject
    text text
    text html
    text status
    timestamptz sent_at
  }

  organizations ||--o{ memberships : ""
  users ||--o{ memberships : ""
  organizations ||--o{ org_invites : ""
  users ||--o{ refresh_sessions : ""
  users ||--o{ auth_tokens : ""
  users ||--o{ resumes : ""
  organizations ||--o{ jobs : ""
  jobs ||--o{ questions : ""
  jobs ||--o{ coding_problems : ""
  jobs ||--o{ interview_invites : ""
  jobs ||--o{ interviews : ""
  users ||--o{ interviews : "candidate"
  interview_invites |o--o| interviews : ""
  resumes |o--o{ interviews : ""
  interviews ||--o{ consents : ""
  interviews ||--o{ interview_turns : ""
  interviews ||--o{ transcript_events : ""
  interviews ||--o{ code_drafts : ""
  interviews ||--o{ code_submissions : ""
  interviews ||--o{ proctoring_events : ""
  interviews ||--o| reports : ""
  interviews ||--o| decisions : ""
```

## 4. Use case diagram

Actors and what each can do. The AI interviewer and the sandbox are shown as system actors
because they take part in interactions without being users.

```mermaid
flowchart LR
  classDef actor fill:#f1f5f9,stroke:#334155,color:#0f172a
  classDef system fill:#ecfdf5,stroke:#0f766e,color:#0f172a
  classDef uc fill:#ffffff,stroke:#64748b,color:#0f172a

  CAND(["Candidate"]):::actor
  REC(["Recruiter / Org admin"]):::actor
  OWN(["Org owner"]):::actor
  AI(["AI interviewer\n(model)"]):::system
  SB(["Code sandbox"]):::system
  SCHED(["Scheduler\n(pg-boss)"]):::system

  subgraph Candidate_journey["Candidate journey"]
    U1(["Accept invitation /\ncreate account"]):::uc
    U2(["Upload and parse resume"]):::uc
    U3(["Review AI disclosure\nand give consent"]):::uc
    U4(["Answer questions\n(voice or text)"]):::uc
    U5(["Solve coding problems\nin the IDE"]):::uc
    U6(["Finish interview"]):::uc
    U7(["Export or delete\nown data"]):::uc
  end

  subgraph Recruiter_workspace["Recruiter workspace"]
    R1(["Define job, rubric\nand interview plan"]):::uc
    R2(["Manage question bank\nand coding problems"]):::uc
    R3(["Invite candidates"]):::uc
    R4(["Review report, Q&A,\ncode and integrity"]):::uc
    R5(["Record hiring decision"]):::uc
    R6(["Rank candidates and\nexport CSV"]):::uc
    R7(["Manage members\nand invitations"]):::uc
    R8(["Set retention and\norganization profile"]):::uc
  end

  subgraph Automated["Automated"]
    S1(["Generate questions\nand evaluate answers"]):::uc
    S2(["Grade submissions"]):::uc
    S3(["Produce evidence-\nanchored report"]):::uc
    S4(["Expire overdue interviews;\npurge past retention"]):::uc
  end

  CAND --> U1 & U2 & U3 & U4 & U5 & U6 & U7
  REC --> R1 & R2 & R3 & R4 & R5 & R6
  OWN --> R7 & R8
  OWN -. "also everything a recruiter does" .-> REC
  U4 --- S1
  U5 --- S2
  U6 --- S3
  AI --> S1 & S3
  SB --> S2
  SCHED --> S4
  R4 -. "reads" .- S3
```
