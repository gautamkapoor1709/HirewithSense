/**
 * Demo seed. Two organizations, each with a recruiter (owner), configured jobs with question banks
 * and coding problems, and a candidate holding a ready-to-start interview. Each organization is
 * seeded independently and skipped when it already exists, so the script is safe to re-run and
 * can be extended with more organizations without touching existing data.
 *
 *   pnpm db:seed
 *
 * Accounts (password for all: DemoPassword123!)
 *   recruiter@demo.hirewithsense.local      owner of "Northwind Labs"
 *   candidate@demo.hirewithsense.local      candidate, Backend Engineer interview ready
 *   recruiter@sukhoi-dev.hirewithsense.local owner of "Sukhoi-dev"
 *   candidate@sukhoi-dev.hirewithsense.local candidate, Software Engineer interview ready
 */
import { eq } from 'drizzle-orm';
import { DEFAULT_COMPETENCIES } from '@hws/shared';
import { loadEnv } from '../config/env.js';
import { closeDb, getDb } from './client.js';
import { codingProblems, interviewInvites, interviews, jobs, memberships, organizations, questions, users } from './schema.js';
import { hashPassword, randomToken, sha256 } from '../lib/crypto.js';
import { addDays } from '../lib/util.js';
import { sectionsFromPlan } from '../modules/interviews/service.js';

export const DEMO_PASSWORD = 'DemoPassword123!';

export interface SeedSummary {
  organization: string;
  created: boolean;
  recruiterEmail: string;
  candidateEmail: string;
  interviewId?: string;
}

async function seedNorthwind(db: ReturnType<typeof getDb>): Promise<SeedSummary> {
  const summary: SeedSummary = { organization: 'Northwind Labs', created: false, recruiterEmail: 'recruiter@demo.hirewithsense.local', candidateEmail: 'candidate@demo.hirewithsense.local' };
  const [existing] = await db.select().from(organizations).where(eq(organizations.slug, 'northwind-labs')).limit(1);
  if (existing) return summary;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [org] = await db.insert(organizations).values({ name: 'Northwind Labs', slug: 'northwind-labs', website: 'https://northwind.example', retentionDays: 365 }).returning();
  const [recruiter] = await db.insert(users).values({ name: 'Riya Recruiter', username: 'riya', email: 'recruiter@demo.hirewithsense.local', passwordHash, role: 'recruiter', emailVerifiedAt: new Date() }).returning();
  await db.insert(memberships).values({ organizationId: org!.id, userId: recruiter!.id, role: 'owner' });
  const [candidate] = await db.insert(users).values({ name: 'Arjun Candidate', username: 'arjun', email: 'candidate@demo.hirewithsense.local', passwordHash, role: 'candidate', emailVerifiedAt: new Date(), headline: 'Backend engineer, 3 years' }).returning();

  const [job] = await db
    .insert(jobs)
    .values({
      organizationId: org!.id,
      title: 'Backend Engineer (Node.js)',
      slug: 'backend-engineer-node-js',
      department: 'Engineering',
      location: 'Remote (India)',
      employmentType: 'full_time',
      seniority: 'mid',
      description: `We are hiring a backend engineer to build and operate the services behind our logistics platform.\n\nYou will design REST APIs in Node.js and TypeScript, model data in PostgreSQL, ship with CI/CD to Kubernetes, and own reliability for your services. We value clear communication, pragmatic trade-offs and a habit of measuring before optimising.\n\nMust-have: 2+ years with Node.js, SQL, HTTP APIs. Nice-to-have: event streaming, observability, cloud infrastructure.`,
      skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'REST', 'Docker', 'Kubernetes'],
      status: 'open',
      competencies: DEFAULT_COMPETENCIES,
      interviewPlan: { sections: [], graceSeconds: 15, completionWindowDays: 7 },
      minimumScore: 65,
      createdBy: recruiter!.id,
    })
    .returning();

  await db.insert(questions).values([
    { jobId: job!.id, prompt: 'Walk me through a backend system you built or significantly changed. What was the hardest design decision and why?', competencyKey: 'project_depth', difficulty: 'medium', expectedSignals: ['trade-offs', 'alternatives considered', 'measurable outcome'], followUpHints: ['Ask what they would do differently today'], order: 1, createdBy: recruiter!.id },
    { jobId: job!.id, prompt: 'A production API suddenly returns 5xx errors for 10% of requests. Describe, step by step, how you would investigate and resolve it.', competencyKey: 'problem_solving', difficulty: 'medium', expectedSignals: ['logs/metrics/traces', 'recent deploys', 'rollback', 'root cause', 'postmortem'], followUpHints: [], order: 2, createdBy: recruiter!.id },
    { jobId: job!.id, prompt: 'How would you design the database schema and indexes for an order-tracking service that must answer "all orders for a customer in a date range" quickly?', competencyKey: 'technical_knowledge', difficulty: 'hard', expectedSignals: ['composite index', 'normalisation', 'pagination', 'query plan'], followUpHints: ['Probe about write amplification'], order: 3, createdBy: recruiter!.id },
  ]);

  const [p1] = await db
    .insert(codingProblems)
    .values({
      jobId: job!.id,
      title: 'Merge overlapping intervals',
      statement: `You are given N intervals. Merge all overlapping intervals and print the result sorted by start.\n\n**Input**\nThe first line contains an integer N (1 ≤ N ≤ 10^5). Each of the next N lines contains two integers \`start end\` (0 ≤ start ≤ end ≤ 10^9).\n\n**Output**\nPrint the merged intervals, one per line, as \`start end\`.\n\n**Example**\n\`\`\`\n3\n1 3\n2 6\n8 10\n\`\`\`\nOutput:\n\`\`\`\n1 6\n8 10\n\`\`\``,
      difficulty: 'medium',
      languageIds: ['javascript', 'typescript', 'python', 'cpp', 'java', 'go'],
      starterCode: {
        javascript: "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(lines[0]);\nconst intervals = lines.slice(1, n + 1).map((l) => l.trim().split(/\\s+/).map(Number));\n\n// TODO: merge and print\n",
        python: 'import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    intervals = [(int(data[1 + 2*i]), int(data[2 + 2*i])) for i in range(n)]\n    # TODO: merge and print\n\nmain()\n',
        cpp: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){int n;cin>>n;vector<pair<long long,long long>> v(n);for(auto&p:v)cin>>p.first>>p.second;\n// TODO\n}\n',
      },
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      tags: ['arrays', 'sorting'],
      testCases: [
        { input: '3\n1 3\n2 6\n8 10\n', expectedOutput: '1 6\n8 10\n', isSample: true, weight: 1, label: 'Example' },
        { input: '1\n5 5\n', expectedOutput: '5 5\n', isSample: true, weight: 1, label: 'Single point' },
        { input: '4\n1 4\n4 5\n0 0\n6 7\n', expectedOutput: '0 0\n1 5\n6 7\n', isSample: false, weight: 2, label: 'Touching intervals' },
        { input: '5\n1 10\n2 3\n4 5\n6 7\n8 9\n', expectedOutput: '1 10\n', isSample: false, weight: 2, label: 'Nested' },
        { input: '6\n10 12\n1 2\n3 4\n5 6\n7 8\n9 10\n', expectedOutput: '1 2\n3 4\n5 6\n7 8\n9 12\n', isSample: false, weight: 3, label: 'Unsorted input' },
      ],
      createdBy: recruiter!.id,
    })
    .returning();

  const [p2] = await db
    .insert(codingProblems)
    .values({
      jobId: job!.id,
      title: 'Rate limiter window',
      statement: `Implement a fixed-window rate limiter check.\n\n**Input**\nFirst line: two integers \`limit window\` (requests allowed per window of \`window\` seconds). Second line: integer M. Then M lines each with \`timestamp clientId\` in non-decreasing timestamp order.\n\n**Output**\nFor each request print \`ALLOW\` or \`DENY\`. A request is allowed if the client has made fewer than \`limit\` allowed requests in the current window \`[floor(t / window) * window, +window)\`.\n\n**Example**\n\`\`\`\n2 10\n4\n1 a\n2 a\n3 a\n11 a\n\`\`\`\nOutput:\n\`\`\`\nALLOW\nALLOW\nDENY\nALLOW\n\`\`\``,
      difficulty: 'easy',
      languageIds: ['javascript', 'typescript', 'python', 'cpp', 'java', 'go'],
      starterCode: {
        javascript: "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\n// TODO\n",
        python: 'import sys\nlines = sys.stdin.read().strip().split("\\n")\n# TODO\n',
      },
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      tags: ['hash map', 'simulation'],
      testCases: [
        { input: '2 10\n4\n1 a\n2 a\n3 a\n11 a\n', expectedOutput: 'ALLOW\nALLOW\nDENY\nALLOW\n', isSample: true, weight: 1, label: 'Example' },
        { input: '1 5\n4\n0 x\n1 y\n2 x\n5 x\n', expectedOutput: 'ALLOW\nALLOW\nDENY\nALLOW\n', isSample: false, weight: 2, label: 'Two clients' },
        { input: '3 1\n3\n0 a\n0 a\n0 a\n', expectedOutput: 'ALLOW\nALLOW\nALLOW\n', isSample: false, weight: 1, label: 'Exactly at limit' },
      ],
      createdBy: recruiter!.id,
    })
    .returning();

  const plan = {
    sections: [
      { type: 'conversation' as const, title: 'Conversation with the AI interviewer', durationMinutes: 20, questionCount: 6, allowGeneratedQuestions: true },
      { type: 'coding' as const, title: 'Coding round', durationMinutes: 40, problemIds: [p1!.id, p2!.id], languageIds: ['javascript', 'typescript', 'python', 'cpp'] as const },
    ],
    graceSeconds: 15,
    completionWindowDays: 7,
  };
  await db.update(jobs).set({ interviewPlan: plan as any }).where(eq(jobs.id, job!.id));

  await db.insert(jobs).values({
    organizationId: org!.id,
    title: 'Frontend Engineer (React)',
    slug: 'frontend-engineer-react',
    department: 'Engineering',
    location: 'Bengaluru',
    employmentType: 'full_time',
    seniority: 'junior',
    description: 'Build accessible, fast interfaces in React and TypeScript for our customer portal. You will work closely with design and backend engineers, own component quality, and care about performance budgets and accessibility.',
    skills: ['React', 'TypeScript', 'CSS', 'Testing'],
    status: 'draft',
    competencies: [
      { key: 'technical_knowledge', label: 'Technical knowledge', description: 'React, TypeScript, browser fundamentals.', weight: 35 },
      { key: 'problem_solving', label: 'Problem solving', description: 'Decomposes UI problems; reasons about state and data flow.', weight: 30 },
      { key: 'communication', label: 'Communication', description: 'Explains decisions clearly.', weight: 20 },
      { key: 'project_depth', label: 'Project depth', description: 'Depth on own projects.', weight: 15 },
      { key: 'coding_correctness', label: 'Coding correctness', description: 'From tests.', weight: 0 },
    ],
    interviewPlan: { sections: [{ type: 'conversation', title: 'Conversation', durationMinutes: 25, questionCount: 6, allowGeneratedQuestions: true }], graceSeconds: 15, completionWindowDays: 7 },
    minimumScore: 60,
    createdBy: recruiter!.id,
  });

  // A ready-to-start interview for the demo candidate.
  const token = randomToken();
  const [invite] = await db.insert(interviewInvites).values({ jobId: job!.id, organizationId: org!.id, email: candidate!.email, candidateName: candidate!.name, message: 'Looking forward to learning about your backend work!', tokenHash: sha256(token), status: 'accepted', acceptedAt: new Date(), expiresAt: addDays(new Date(), 14), invitedBy: recruiter!.id }).returning();
  const [interview] = await db.insert(interviews).values({ jobId: job!.id, organizationId: org!.id, candidateId: candidate!.id, inviteId: invite!.id, status: 'ready', plan: plan as any, sections: sectionsFromPlan(plan as any), completeBy: addDays(new Date(), 7) }).returning();
  await db.update(interviewInvites).set({ interviewId: interview!.id }).where(eq(interviewInvites.id, invite!.id));

  return { ...summary, created: true, interviewId: interview!.id };
}

async function seedSukhoi(db: ReturnType<typeof getDb>): Promise<SeedSummary> {
  const summary: SeedSummary = { organization: 'Sukhoi-dev', created: false, recruiterEmail: 'recruiter@sukhoi-dev.hirewithsense.local', candidateEmail: 'candidate@sukhoi-dev.hirewithsense.local' };
  const [existing] = await db.select().from(organizations).where(eq(organizations.slug, 'sukhoi-dev')).limit(1);
  if (existing) return summary;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [org] = await db.insert(organizations).values({ name: 'Sukhoi-dev', slug: 'sukhoi-dev', website: 'https://sukhoi-dev.example', retentionDays: 365 }).returning();
  const [recruiter] = await db.insert(users).values({ name: 'Ivan Petrov', username: 'ivan.petrov', email: summary.recruiterEmail, passwordHash, role: 'recruiter', emailVerifiedAt: new Date() }).returning();
  await db.insert(memberships).values({ organizationId: org!.id, userId: recruiter!.id, role: 'owner' });
  const [candidate] = await db.insert(users).values({ name: 'Priya Nair', username: 'priya.nair', email: summary.candidateEmail, passwordHash, role: 'candidate', emailVerifiedAt: new Date(), headline: 'Full-stack engineer, 2 years', location: 'Pune' }).returning();

  const [job] = await db
    .insert(jobs)
    .values({
      organizationId: org!.id,
      title: 'Software Engineer',
      slug: 'software-engineer',
      department: 'Platform',
      location: 'Hybrid (Pune)',
      employmentType: 'full_time',
      seniority: 'junior',
      description: `Sukhoi-dev builds developer tooling for embedded and avionics software teams. We are looking for a software engineer to join the platform group.\n\nYou will work across a TypeScript service layer and Python data pipelines, write tests as a matter of course, review code with care, and take part in design discussions. Good fundamentals matter more to us than any particular framework: data structures, complexity, clear interfaces, and honest communication about trade-offs.\n\nMust-have: solid programming fundamentals in at least one language, familiarity with Git and HTTP APIs. Nice-to-have: TypeScript or Python, SQL, CI/CD, Linux.`,
      skills: ['TypeScript', 'Python', 'Git', 'SQL', 'Linux', 'Testing'],
      status: 'open',
      competencies: [
        { key: 'technical_knowledge', label: 'Technical knowledge', description: 'Programming fundamentals, data structures, and the tools of the job.', weight: 30 },
        { key: 'problem_solving', label: 'Problem solving', description: 'Breaks problems down, reasons about complexity and edge cases, considers alternatives.', weight: 25 },
        { key: 'communication', label: 'Communication', description: 'Explains reasoning clearly; content, not delivery.', weight: 15 },
        { key: 'project_depth', label: 'Project depth', description: 'Can go deep on own work: decisions, failures, what was learned.', weight: 10 },
        { key: 'coding_correctness', label: 'Coding correctness', description: 'Computed from test results.', weight: 20 },
      ],
      interviewPlan: { sections: [], graceSeconds: 15, completionWindowDays: 7 },
      minimumScore: 60,
      createdBy: recruiter!.id,
    })
    .returning();

  await db.insert(questions).values([
    { jobId: job!.id, prompt: 'Tell me about a piece of software you built that you are proud of. What did it do, what was your part, and what would you change if you built it again?', competencyKey: 'project_depth', difficulty: 'easy', expectedSignals: ['own contribution', 'what they would change', 'why'], followUpHints: ['Ask what broke first'], order: 1, createdBy: recruiter!.id },
    { jobId: job!.id, prompt: 'When would you choose a hash map over a sorted array, and when the other way round? Give a concrete example of each.', competencyKey: 'technical_knowledge', difficulty: 'medium', expectedSignals: ['O(1) lookup', 'ordered iteration', 'memory', 'concrete example'], followUpHints: [], order: 2, createdBy: recruiter!.id },
    { jobId: job!.id, prompt: 'You are given a bug report that says "the export is sometimes empty". There are no logs. Walk me through how you would find the cause.', competencyKey: 'problem_solving', difficulty: 'medium', expectedSignals: ['reproduce', 'narrow down', 'add logging', 'hypotheses', 'race condition'], followUpHints: ['Probe how they would prevent regression'], order: 3, createdBy: recruiter!.id },
    { jobId: job!.id, prompt: 'Explain to a non-engineer teammate why a code review matters, in under a minute.', competencyKey: 'communication', difficulty: 'easy', expectedSignals: ['plain language', 'risk', 'shared understanding'], followUpHints: [], order: 4, createdBy: recruiter!.id },
  ]);

  const [p1] = await db
    .insert(codingProblems)
    .values({
      jobId: job!.id,
      title: 'Balanced brackets',
      statement: `Decide whether a string of brackets is balanced. A string is balanced when every opening bracket \`(\`, \`[\`, \`{\` is closed by the matching bracket in the correct order.\n\n**Input**\nThe first line contains an integer T (1 ≤ T ≤ 1000). Each of the next T lines contains one string of length 1 to 10^5 made only of \`()[]{}\`.\n\n**Output**\nFor each string print \`YES\` if it is balanced, otherwise \`NO\`.\n\n**Example**\n\`\`\`\n3\n([]{})\n([)]\n((\n\`\`\`\nOutput:\n\`\`\`\nYES\nNO\nNO\n\`\`\``,
      difficulty: 'easy',
      languageIds: ['javascript', 'typescript', 'python', 'cpp', 'java', 'go'],
      starterCode: {
        javascript: "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst t = Number(lines[0]);\nfor (let i = 1; i <= t; i++) {\n  const s = lines[i].trim();\n  // TODO: print YES or NO\n}\n",
        python: 'import sys\nlines = sys.stdin.read().split()\nt = int(lines[0])\nfor s in lines[1:1 + t]:\n    # TODO: print YES or NO\n    pass\n',
      },
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      tags: ['stack', 'strings'],
      testCases: [
        { input: '3\n([]{})\n([)]\n((\n', expectedOutput: 'YES\nNO\nNO\n', isSample: true, weight: 1, label: 'Example' },
        { input: '2\n{}\n}{\n', expectedOutput: 'YES\nNO\n', isSample: true, weight: 1, label: 'Order matters' },
        { input: '4\n()[]{}\n{[()]}\n{[(])}\n(((((((((())))))))))\n', expectedOutput: 'YES\nYES\nNO\nYES\n', isSample: false, weight: 2, label: 'Mixed' },
        { input: '1\n' + '('.repeat(50000) + ')'.repeat(50000) + '\n', expectedOutput: 'YES\n', isSample: false, weight: 3, label: 'Deep nesting' },
      ],
      createdBy: recruiter!.id,
    })
    .returning();

  const [p2] = await db
    .insert(codingProblems)
    .values({
      jobId: job!.id,
      title: 'Pairs with a given sum',
      statement: `Count the number of unordered pairs of distinct indices (i, j) whose values add up to a target.\n\n**Input**\nFirst line: two integers N and K (1 ≤ N ≤ 2·10^5, |K| ≤ 10^9). Second line: N integers (|a_i| ≤ 10^9).\n\n**Output**\nA single integer: the number of pairs i < j with a_i + a_j = K.\n\n**Example**\n\`\`\`\n5 6\n1 5 7 -1 5\n\`\`\`\nOutput:\n\`\`\`\n3\n\`\`\`\n(The pairs are 1+5, 7+(-1) and 1+5 using the second 5.)`,
      difficulty: 'medium',
      languageIds: ['javascript', 'typescript', 'python', 'cpp', 'java', 'go'],
      starterCode: {
        javascript: "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconst [n, k] = data;\nconst a = data.slice(2, 2 + n);\n// TODO: print the count\n",
        python: 'import sys\ndata = list(map(int, sys.stdin.read().split()))\nn, k = data[0], data[1]\na = data[2:2 + n]\n# TODO: print the count\n',
      },
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      tags: ['hash map', 'counting'],
      testCases: [
        { input: '5 6\n1 5 7 -1 5\n', expectedOutput: '3\n', isSample: true, weight: 1, label: 'Example' },
        { input: '4 4\n2 2 2 2\n', expectedOutput: '6\n', isSample: false, weight: 2, label: 'All equal' },
        { input: '3 100\n1 2 3\n', expectedOutput: '0\n', isSample: false, weight: 1, label: 'No pairs' },
        { input: '6 0\n-3 3 0 0 3 -3\n', expectedOutput: '5\n', isSample: false, weight: 2, label: 'Negatives and zeros' },
      ],
      createdBy: recruiter!.id,
    })
    .returning();

  const plan = {
    sections: [
      { type: 'conversation' as const, title: 'Conversation with the AI interviewer', durationMinutes: 15, questionCount: 5, allowGeneratedQuestions: true },
      { type: 'coding' as const, title: 'Coding round', durationMinutes: 30, problemIds: [p1!.id, p2!.id], languageIds: ['javascript', 'typescript', 'python', 'cpp'] as const },
    ],
    graceSeconds: 15,
    completionWindowDays: 7,
  };
  await db.update(jobs).set({ interviewPlan: plan as any }).where(eq(jobs.id, job!.id));

  const token = randomToken();
  const [invite] = await db.insert(interviewInvites).values({ jobId: job!.id, organizationId: org!.id, email: candidate!.email, candidateName: candidate!.name, message: 'Thanks for applying to Sukhoi-dev. This first round takes about 45 minutes.', tokenHash: sha256(token), status: 'accepted', acceptedAt: new Date(), expiresAt: addDays(new Date(), 14), invitedBy: recruiter!.id }).returning();
  const [interview] = await db.insert(interviews).values({ jobId: job!.id, organizationId: org!.id, candidateId: candidate!.id, inviteId: invite!.id, status: 'ready', plan: plan as any, sections: sectionsFromPlan(plan as any), completeBy: addDays(new Date(), 7) }).returning();
  await db.update(interviewInvites).set({ interviewId: interview!.id }).where(eq(interviewInvites.id, invite!.id));
  return { ...summary, created: true, interviewId: interview!.id };
}

/** Seed every demo organization. Idempotent per organization. */
export async function seedDemo(db = getDb()): Promise<SeedSummary[]> {
  return [await seedNorthwind(db), await seedSukhoi(db)];
}

const invokedDirectly = process.argv[1] ? /seed\.(ts|js)$/.test(process.argv[1]) : false;
if (invokedDirectly) {
  loadEnv();
  seedDemo()
    .then((results) => {
      for (const r of results) {
        console.log(`${r.created ? 'Seeded' : 'Already present'}: ${r.organization}`);
        console.log(`  Recruiter: ${r.recruiterEmail} / ${DEMO_PASSWORD}`);
        console.log(`  Candidate: ${r.candidateEmail} / ${DEMO_PASSWORD}`);
        if (r.interviewId) console.log(`  Interview ready to start: ${r.interviewId}`);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
