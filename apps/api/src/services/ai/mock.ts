import type { AiProvider, JsonCompletionOptions, TextStreamOptions } from './provider.js';
import { ModelReport, ResumeProfile, TurnEvaluation } from '@hws/shared';

/**
 * Deterministic provider used when no AI key is configured (development, tests, demos). It makes
 * the whole product navigable end to end and produces plausible, clearly labelled output. It never
 * calls the network.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = null;
  readonly configured = false;

  async completeJson<T>(opts: JsonCompletionOptions<T>): Promise<T> {
    const input = safeJson(opts.user);
    switch (opts.task) {
      case 'resume.parse':
        return ResumeProfile.parse(mockResume(String(input.text ?? ''))) as T;
      case 'turn.evaluate':
        return TurnEvaluation.parse(mockEvaluate(input)) as T;
      case 'report.generate':
        return ModelReport.parse(mockReport(input)) as T;
      case 'code.review':
        return {
          feedback: 'Automated review is running in offline mode. Verify complexity, edge cases and naming manually.',
          followUpQuestions: [
            'What is the time and space complexity of your solution, and why?',
            'Which edge cases did you consider, and how does your code handle them?',
            'If the input were 100x larger, what would you change?',
          ],
        } as T;
      default:
        throw new Error(`Mock provider has no handler for task ${opts.task}`);
    }
  }

  async *streamText(opts: TextStreamOptions): AsyncIterable<string> {
    const input = safeJson(opts.user);
    const text = mockQuestion(input);
    for (const word of text.split(/(?<=\s)/)) {
      yield word;
    }
  }
}

function safeJson(s: string): Record<string, any> {
  try {
    const start = s.indexOf('{');
    return start >= 0 ? JSON.parse(s.slice(start)) : {};
  } catch {
    return {};
  }
}

const KNOWN_SKILLS = ['JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'Go', 'Rust', 'React', 'Node.js', 'Express', 'Fastify', 'Next.js', 'Vue', 'Angular', 'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'SQL', 'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'Terraform', 'TensorFlow', 'PyTorch', 'Git', 'Linux', 'GraphQL', 'REST', 'Kafka', 'Spark', 'Django', 'Flask', 'Spring', 'HTML', 'CSS', 'Tailwind'];

function mockResume(text: string) {
  const skills = [...new Set(KNOWN_SKILLS.filter((s) => new RegExp(`\\b${s.replace(/[.+]/g, '\\$&')}\\b`, 'i').test(text)))];
  const section = (names: string[]) => {
    for (const n of names) {
      const m = text.match(new RegExp(`${n}[^\\n]*\\n([\\s\\S]*?)(?=\\n[A-Z][A-Z &/]{3,}\\n|$)`, 'i'));
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return '';
  };
  const exp = section(['EXPERIENCE', 'WORK EXPERIENCE', 'EMPLOYMENT']);
  const proj = section(['PROJECTS', 'PERSONAL PROJECTS']);
  const edu = section(['EDUCATION']);
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter((l) => l.length > 3).slice(0, 6);
  const years = text.match(/(\d{1,2})\+?\s+years?/i);
  return {
    summary: text.replace(/\s+/g, ' ').trim().slice(0, 400),
    skills,
    experience: exp ? [{ company: '', title: lines(exp)[0] ?? 'Experience', start: '', end: '', highlights: lines(exp).slice(1, 5) }] : [],
    projects: proj ? lines(proj).slice(0, 4).map((l) => ({ name: l.slice(0, 80), description: '', technologies: [] })) : [],
    education: edu ? lines(edu).slice(0, 2).map((l) => ({ institution: l.slice(0, 120), degree: '', year: '' })) : [],
    yearsOfExperience: years ? Number(years[1]) : null,
  };
}

function mockQuestion(input: Record<string, any>): string {
  const comp = String(input.targetCompetency?.label ?? 'problem solving').toLowerCase();
  const key = String(input.targetCompetency?.key ?? '');
  const role = String(input.job?.title ?? 'this role');
  const skills: string[] = input.resume?.skills ?? [];
  const projects: { name?: string }[] = input.resume?.projects ?? [];
  const asked: number = Number(input.askedCount ?? 0);
  const last = String(input.lastAnswer ?? '').trim();
  const skill = skills[asked % Math.max(1, skills.length)] ?? input.job?.skills?.[0] ?? 'your main technology';
  const project = projects[asked % Math.max(1, projects.length)]?.name;

  if (last && asked % 3 === 2) {
    return `You mentioned "${last.slice(0, 80).replace(/\s+/g, ' ')}${last.length > 80 ? '…' : ''}". What trade-offs did you weigh there, and what would you do differently with hindsight?`;
  }
  switch (key) {
    case 'technical_knowledge':
      return `For the ${role} role, ${skill} is central. Explain how ${skill} handles a non-trivial scenario you have dealt with, and where its limits are.`;
    case 'project_depth':
      return project
        ? `Tell me about ${project}. What was the hardest technical decision, which alternatives did you consider, and how did you measure the outcome?`
        : `Walk me through the project you are proudest of. What was the hardest decision, which alternatives did you consider, and how did you measure success?`;
    case 'communication':
      return `Imagine explaining the architecture of your most recent system to a new teammate in two minutes. Give me that explanation.`;
    case 'coding_correctness':
      return `Describe how you make sure code you ship is correct: testing strategy, edge cases, and what you do when a bug reaches production.`;
    default:
      return `Describe a hard ${comp} situation you faced using ${skill}. How did you break the problem down, and how did you decide between the options?`;
  }
}

function mockEvaluate(input: Record<string, any>) {
  const answer = String(input.answer ?? '');
  const signals: string[] = input.expectedSignals ?? [];
  const words = answer.split(/\s+/).filter(Boolean).length;
  const hits = signals.filter((s) => answer.toLowerCase().includes(String(s).toLowerCase()));
  const structure = /\b(because|therefore|trade-?off|however|for example|so that|instead)\b/i.test(answer) ? 1 : 0;
  const numbers = /\d/.test(answer) ? 1 : 0;
  let score = Math.min(10, 2 + Math.min(4, words / 40) + hits.length * 1.5 + structure + numbers);
  if (words < 15) score = Math.min(score, 3);
  score = Math.round(score * 10) / 10;
  return {
    score,
    feedback:
      words < 15
        ? 'The answer is very short; it does not give enough detail to assess depth.'
        : `The answer is ${words} words long${structure ? ', explains reasoning' : ''}${numbers ? ' and includes concrete figures' : ''}${hits.length ? `, and touches expected signals (${hits.join(', ')})` : ''}. (Offline heuristic evaluation.)`,
    strengths: [structure ? 'Explains reasoning and trade-offs' : '', numbers ? 'Uses concrete, measurable detail' : '', hits.length ? 'Covers expected signals' : ''].filter(Boolean),
    gaps: [words < 60 ? 'Could go deeper with a concrete example' : '', !structure ? 'Make the reasoning behind decisions explicit' : '', signals.length && !hits.length ? 'Did not address the expected signals' : ''].filter(Boolean),
    competencyKey: input.competencyKey ?? null,
    confidence: 0.35,
  };
}

function mockReport(input: Record<string, any>) {
  const competencies: { key: string; label: string }[] = input.competencies ?? [];
  const turns: { competencyKey: string | null; answer: string | null; evaluation?: { score: number | null } | null; id?: string }[] = input.turns ?? [];
  const perComp = competencies.map((c) => {
    const relevant = turns.filter((t) => t.competencyKey === c.key && t.answer);
    if (!relevant.length) {
      return { key: c.key, score: null, level: null, confidence: 0, rationale: 'No answers were recorded for this competency.', evidence: [] };
    }
    const scores = relevant.map((t) => (t.evaluation?.score ?? 5) * 10);
    const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const level = score >= 85 ? 5 : score >= 70 ? 4 : score >= 55 ? 3 : score >= 40 ? 2 : 1;
    return {
      key: c.key,
      score,
      level,
      confidence: 0.4,
      rationale: `Based on ${relevant.length} answer(s). Offline heuristic: average per-answer evaluation ${score}/100.`,
      evidence: relevant.slice(0, 2).map((t) => ({ quote: String(t.answer).replace(/<\/?untrusted[^>]*>/gi, '').trim().slice(0, 200), source: 'answer' as const, turnId: t.id ?? null })),
    };
  });
  const answered = turns.filter((t) => t.answer).length;
  return {
    summary: `Offline summary: the candidate answered ${answered} of ${turns.length} questions. Scores below are heuristic placeholders produced without a language model; configure an AI provider for evidence-based evaluation.`,
    strengths: answered ? ['Completed the interview and answered most questions'] : [],
    considerations: ['Generated without an AI provider; treat as a structural preview rather than an assessment'],
    competencies: perComp,
  };
}
