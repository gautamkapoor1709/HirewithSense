import { z } from 'zod';
import { Id, IsoDate } from './common.js';

export const RecruiterDashboard = z.object({
  jobs: z.object({ open: z.number().int(), draft: z.number().int(), total: z.number().int() }),
  interviews: z.object({
    invited: z.number().int(),
    inProgress: z.number().int(),
    awaitingReview: z.number().int(),
    completed: z.number().int(),
    total: z.number().int(),
  }),
  averageScore: z.number().nullable(),
  completionRate: z.number().nullable(),
  recent: z.array(
    z.object({
      interviewId: Id,
      candidateName: z.string(),
      jobTitle: z.string(),
      status: z.string(),
      weightedScore: z.number().nullable(),
      recommendation: z.string().nullable(),
      at: IsoDate,
    }),
  ),
  scoreDistribution: z.array(z.object({ bucket: z.string(), count: z.number().int() })),
});
export type RecruiterDashboard = z.infer<typeof RecruiterDashboard>;

export const CandidateDashboard = z.object({
  upcoming: z.array(z.any()),
  completed: z.array(z.any()),
  resume: z.any().nullable(),
});

export const OutboxMailDto = z.object({
  id: Id,
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  html: z.string().nullable(),
  status: z.string(),
  error: z.string().nullable(),
  createdAt: IsoDate,
});
export type OutboxMailDto = z.infer<typeof OutboxMailDto>;

export const AiStatusDto = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  configured: z.boolean(),
  features: z.object({
    questions: z.boolean(),
    evaluation: z.boolean(),
    reports: z.boolean(),
    resumeParsing: z.boolean(),
    transcription: z.boolean(),
    speech: z.boolean(),
  }),
  speech: z.object({ provider: z.string(), configured: z.boolean(), sttModel: z.string().nullable(), ttsModel: z.string().nullable(), voice: z.string().nullable() }),
  codeRunner: z.object({ kind: z.string(), available: z.boolean(), languages: z.array(z.string()) }),
  email: z.object({ transport: z.string(), configured: z.boolean() }),
});
export type AiStatusDto = z.infer<typeof AiStatusDto>;

export const AuditLogDto = z.object({
  id: Id,
  actor: z.object({ id: Id, name: z.string() }).nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  at: IsoDate,
});
export type AuditLogDto = z.infer<typeof AuditLogDto>;
