import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, CheckCircle2, Headphones, Keyboard, Mic, MicOff, SkipForward, Volume2, VolumeX, Send, MessageSquareText } from 'lucide-react';
import type { AiStatusDto, CandidateTurnDto, InterviewDto, InterviewRoomState, QuestionStreamEvent } from '@hws/shared';
import { Badge, Button, Card, Dialog, DialogContent, DialogFooter, PageLoader, Progress, Switch, Tooltip } from '@/components/ui';
import { get, isApiError, post, streamSse } from '@/lib/api';
import { errorMessage, qk, queryClient } from '@/lib/query';
import { useDocumentTitle } from '@/lib/hooks';
import { cn, fmtDuration } from '@/lib/utils';
import { InterviewHeader, routeAfterSection } from './InterviewHeader';
import { ProctoringNotice, useProctoring } from './useProctoring';
import { ServerRecorder, createRecognition, mediaRecorderSupported, speak, speakViaServer, speechRecognitionSupported, speechSynthesisSupported, stopAllSpeech, type SpeechRecognitionLike } from './speech';

type InterviewerState = 'idle' | 'thinking' | 'speaking' | 'listening';

export default function InterviewRoomPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  useDocumentTitle('Interview');

  const roomQuery = useQuery({
    queryKey: qk.room(id),
    queryFn: () => get<InterviewRoomState>(`/interviews/${id}/room`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
    staleTime: 0,
    meta: { silent: true },
  });

  // Server-side speech is used when the API has audio models configured; the browser's own
  // SpeechRecognition / speechSynthesis are the fallback.
  const aiStatus = useQuery({ queryKey: qk.aiStatus, queryFn: () => get<AiStatusDto>('/ai/status'), staleTime: 5 * 60_000, meta: { silent: true } });
  const serverTts = Boolean(aiStatus.data?.features.speech);
  const serverStt = Boolean(aiStatus.data?.features.transcription) && mediaRecorderSupported();
  const say = useCallback((text: string, onEnd?: () => void) => {
    if (serverTts) void speakViaServer(text, onEnd);
    else speak(text, onEnd);
  }, [serverTts]);
  const recorder = useRef<ServerRecorder | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  const [interview, setInterview] = useState<InterviewDto | null>(null);
  const [turns, setTurns] = useState<CandidateTurnDto[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [streaming, setStreaming] = useState('');
  const [state, setState] = useState<InterviewerState>('idle');
  const [sectionDone, setSectionDone] = useState(false);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  // Voice-first by default: questions are spoken and answers are transcribed. The preference is
  // remembered per browser; text mode is always one click away.
  const [voiceMode, setVoiceModeState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('hws-voice-mode');
      if (saved === 'off') return false;
    } catch {
      /* ignore */
    }
    return speechSynthesisSupported();
  });
  const setVoiceMode = useCallback((v: boolean) => {
    setVoiceModeState(v);
    try {
      localStorage.setItem('hws-voice-mode', v ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);
  // Browsers only play audio and open the microphone after a user gesture, so the voice session
  // starts from an explicit "Begin" click.
  const [voiceReady, setVoiceReady] = useState(false);
  const startListeningRef = useRef<() => void>(() => {});
  const [listening, setListening] = useState(false);
  const shownAt = useRef<number>(Date.now());
  const requesting = useRef(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscript = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const { recordPaste } = useProctoring(id, interview?.currentSection ?? null, interview?.status === 'in_progress');

  const sectionIdx = interview?.currentSection ?? null;
  const sectionPlan = sectionIdx !== null ? interview?.plan.sections[sectionIdx] : undefined;
  const sectionTurns = useMemo(() => turns.filter((t) => t.sectionIndex === sectionIdx), [turns, sectionIdx]);
  const openTurn = useMemo(() => sectionTurns.find((t) => !t.answer && !t.skipped) ?? null, [sectionTurns]);
  const totalQuestions = sectionPlan?.type === 'conversation' ? sectionPlan.questionCount : sectionTurns.length;
  const askedCount = sectionTurns.length;

  const goOn = useCallback(
    (next: InterviewDto) => {
      queryClient.invalidateQueries({ queryKey: qk.interview(id) });
      nav(routeAfterSection(next), { replace: true });
    },
    [id, nav],
  );

  const completeSection = useCallback(async () => {
    if (sectionIdx === null) return;
    setEnding(true);
    try {
      const next = await post<InterviewDto>(`/interviews/${id}/sections/${sectionIdx}/complete`);
      goOn(next);
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        const fresh = await get<InterviewDto>(`/interviews/${id}`);
        goOn(fresh);
      } else toast.error(errorMessage(err));
    } finally {
      setEnding(false);
    }
  }, [id, sectionIdx, goOn]);

  const requestNext = useCallback(async () => {
    if (requesting.current) return;
    requesting.current = true;
    setStreaming('');
    setState('thinking');
    try {
      await streamSse<QuestionStreamEvent>(`/interviews/${id}/next-question`, (ev) => {
        if (ev.type === 'token') setStreaming((s) => s + ev.text);
        else if (ev.type === 'question') {
          setTurns((ts) => (ts.some((t) => t.id === ev.turn.id) ? ts : [...ts, ev.turn]));
          setRemaining(ev.remaining);
          setStreaming('');
          shownAt.current = Date.now();
          setState('idle');
        } else if (ev.type === 'section_complete') {
          setSectionDone(true);
          setState('idle');
        } else if (ev.type === 'error') toast.error(ev.message);
      });
    } catch (err) {
      if (isApiError(err) && err.status === 410) {
        toast.message('Time is up for this section.');
        await completeSection();
      } else if (isApiError(err) && err.status === 409) {
        roomQuery.refetch();
      } else toast.error(errorMessage(err));
      setState('idle');
    } finally {
      requesting.current = false;
    }
  }, [id, completeSection, roomQuery]);

  // Hydrate from the room state and decide what to do.
  useEffect(() => {
    const data = roomQuery.data;
    if (!data) return;
    setInterview(data.interview);
    setTurns(data.turns);
    setRemaining(data.remainingQuestions);
    const st = data.interview.status;
    if (st !== 'in_progress') {
      nav(st === 'ready' || st === 'invited' ? `/app/interviews/${id}` : `/app/interviews/${id}/done`, { replace: true });
      return;
    }
    const cur = data.interview.currentSection;
    const plan = cur !== null ? data.interview.plan.sections[cur] : undefined;
    if (plan?.type === 'coding') {
      nav(`/app/interviews/${id}/coding`, { replace: true });
      return;
    }
    const open = data.turns.find((t) => t.sectionIndex === cur && !t.answer && !t.skipped);
    if (open) {
      shownAt.current = Date.now();
      return;
    }
    if (plan?.type === 'conversation' && data.turns.filter((t) => t.sectionIndex === cur).length >= plan.questionCount) {
      setSectionDone(true);
      return;
    }
    void requestNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomQuery.data]);

  // Warn before leaving mid-interview.
  useEffect(() => {
    if (interview?.status !== 'in_progress') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [interview?.status]);

  // Speak new questions in voice mode.
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    if (!voiceMode || !voiceReady || !openTurn || lastSpoken.current === openTurn.id) return;
    lastSpoken.current = openTurn.id;
    setState('speaking');
    say(openTurn.question, () => {
      setState('idle');
      // Hand the floor to the candidate as soon as the question has been read.
      startListeningRef.current();
    });
  }, [voiceMode, voiceReady, openTurn, say]);

  useEffect(() => () => {
    stopAllSpeech();
    recognition.current?.abort();
    recorder.current?.abort();
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, streaming]);

  const stopListening = useCallback(() => {
    recognition.current?.stop();
    recognition.current = null;
    setListening(false);
    setState('idle');
    const rec = recorder.current;
    if (rec) {
      recorder.current = null;
      setTranscribing(true);
      rec
        .stop()
        .then((text) => {
          if (text) setAnswer((a) => (a.trimEnd() ? a.trimEnd() + ' ' + text : text));
          else toast.message('No speech was detected.');
        })
        .catch((err) => toast.error(errorMessage(err)))
        .finally(() => setTranscribing(false));
    }
  }, []);

  const startListening = useCallback(() => {
    stopAllSpeech();
    if (serverStt) {
      const rec = new ServerRecorder();
      rec
        .start()
        .then(() => {
          recorder.current = rec;
          setListening(true);
          setState('listening');
        })
        .catch(() => toast.error('Microphone access was denied.'));
      return;
    }
    const r = createRecognition();
    if (!r) {
      toast.error('Voice input needs Chrome or Edge, or a server with transcription enabled.');
      return;
    }
    finalTranscript.current = answer ? answer.trimEnd() + ' ' : '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalTranscript.current += res[0].transcript.trim() + ' ';
        else interim += res[0].transcript;
      }
      setAnswer((finalTranscript.current + interim).trimStart());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed') toast.error('Microphone access was denied.');
      setListening(false);
      setState('idle');
      recognition.current = null;
    };
    r.onend = () => {
      // Chrome stops after silence; restart while the user still wants to listen.
      if (recognition.current === r) {
        try {
          r.start();
        } catch {
          setListening(false);
          setState('idle');
        }
      }
    };
    recognition.current = r;
    r.start();
    setListening(true);
    setState('listening');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, serverStt]);
  startListeningRef.current = startListening;

  const submit = useCallback(async () => {
    if (!openTurn || !answer.trim() || submitting) return;
    setSubmitting(true);
    if (listening) stopListening();
    stopAllSpeech();
    const duration = Math.round((Date.now() - shownAt.current) / 1000);
    try {
      const saved = await post<CandidateTurnDto>(`/interviews/${id}/answers`, { turnId: openTurn.id, answer: answer.trim(), inputMode: voiceMode ? 'voice' : 'text', answerDurationSeconds: duration });
      setTurns((ts) => ts.map((t) => (t.id === saved.id ? saved : t)));
      setAnswer('');
      finalTranscript.current = '';
      await requestNext();
    } catch (err) {
      if (isApiError(err) && err.status === 410) {
        toast.message('Time is up for this section.');
        await completeSection();
      } else if (isApiError(err) && err.status === 409) {
        roomQuery.refetch();
      } else toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  }, [openTurn, answer, submitting, listening, stopListening, id, voiceMode, requestNext, completeSection, roomQuery]);

  const skip = useCallback(async () => {
    if (!openTurn) return;
    setConfirmSkip(false);
    setSubmitting(true);
    stopAllSpeech();
    try {
      const saved = await post<CandidateTurnDto>(`/interviews/${id}/skip`, { turnId: openTurn.id });
      setTurns((ts) => ts.map((t) => (t.id === saved.id ? saved : t)));
      setAnswer('');
      await requestNext();
    } catch (err) {
      if (isApiError(err) && err.status === 410) await completeSection();
      else toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [openTurn, id, requestNext, completeSection]);

  if (roomQuery.isLoading || !interview) return <PageLoader label="Preparing your interview…" />;
  if (roomQuery.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted">{errorMessage(roomQuery.error)}</p>
        <Button onClick={() => roomQuery.refetch()}>Try again</Button>
      </div>
    );
  }

  const progressPct = totalQuestions ? Math.min(100, (askedCount / totalQuestions) * 100) : 0;
  const isLastSection = (interview.currentSection ?? 0) >= interview.sections.length - 1;

  return (
    <>
      <InterviewHeader interview={interview} onTimeUp={() => void completeSection()} onEndSection={completeSection} ending={ending} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] lg:overflow-hidden lg:p-5">
        {/* Interviewer */}
        <Card className="flex flex-col p-5 lg:min-h-0 lg:overflow-y-auto scrollbar-thin">
          <div className="flex items-center gap-3">
            <InterviewerAvatar state={state} />
            <div>
              <div className="text-sm font-semibold">AI interviewer</div>
              <div className="text-xs text-muted" aria-live="polite">
                {state === 'thinking' ? 'Thinking…' : state === 'speaking' ? 'Speaking' : state === 'listening' ? 'Listening' : 'Waiting for your answer'}
              </div>
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
              <span>
                Question {Math.min(askedCount || 1, totalQuestions || 1)} of {totalQuestions || '—'}
              </span>
              {remaining !== null ? <span>{remaining} remaining</span> : null}
            </div>
            <Progress value={progressPct} />
          </div>
          <div className="mt-5 flex-1" aria-live="polite" aria-atomic="true">
            {sectionDone ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted">This section is complete.</div>
            ) : streaming ? (
              <p className="text-base leading-relaxed">
                {streaming}
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse-soft bg-accent align-middle" aria-hidden />
              </p>
            ) : openTurn ? (
              <p className="text-base leading-relaxed">{openTurn.question}</p>
            ) : (
              <p className="text-sm text-muted">Preparing the next question…</p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              <Switch
                checked={voiceMode}
                onCheckedChange={(v) => {
                  setVoiceMode(v);
                  if (!v) {
                    stopAllSpeech();
                    if (listening) stopListening();
                  } else {
                    setVoiceReady(true);
                    if (openTurn) {
                      lastSpoken.current = openTurn.id;
                      setState('speaking');
                      say(openTurn.question, () => {
                        setState('idle');
                        startListeningRef.current();
                      });
                    }
                  }
                }}
                aria-label="Voice mode"
              />
              Voice mode
            </label>
            {openTurn ? (
              <Tooltip content={speechSynthesisSupported() ? 'Read the question aloud' : 'Speech is not supported in this browser'}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!speechSynthesisSupported()}
                  onClick={() => {
                    setState('speaking');
                    say(openTurn.question, () => setState(listening ? 'listening' : 'idle'));
                  }}
                >
                  {state === 'speaking' ? <VolumeX /> : <Volume2 />} Repeat question
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </Card>

        {/* Composer */}
        <Card className="flex flex-col p-5 lg:min-h-0">
          {sectionDone ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <CheckCircle2 className="size-10 text-success" />
              <div>
                <h2 className="text-lg font-semibold">Section complete</h2>
                <p className="mt-1 max-w-sm text-sm text-muted">{isLastSection ? 'You have answered every question. Finish to submit your interview.' : 'Great work. The next section starts when you continue; its timer begins then.'}</p>
              </div>
              <Button size="lg" loading={ending} onClick={() => void completeSection()}>
                {isLastSection ? 'Finish interview' : 'Continue to next section'}
              </Button>
            </div>
          ) : voiceMode && !voiceReady ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Headphones className="size-7" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Voice interview</h2>
                <p className="mt-1 max-w-sm text-sm text-muted">
                  The interviewer will read each question aloud and listen to your answer. Your words appear as text so you can check them before sending. Use a quiet place and allow the microphone when asked.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="lg" onClick={() => setVoiceReady(true)} disabled={!openTurn && !streaming}>
                  <Mic /> Begin voice interview
                </Button>
                <Button size="lg" variant="outline" onClick={() => setVoiceMode(false)}>
                  <Keyboard /> I prefer to type
                </Button>
              </div>
              {!serverStt && !speechRecognitionSupported() ? <p className="text-xs text-warning">Dictation needs Chrome or Edge in this setup; questions will still be read aloud.</p> : null}
            </div>
          ) : (
            <>
              <label htmlFor="answer" className="text-sm font-medium">
                Your answer
              </label>
              <textarea
                id="answer"
                ref={textareaRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onPaste={(e) => recordPaste(e.clipboardData.getData('text').length)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={openTurn ? 'Type your answer, or switch on voice mode and speak…' : 'Waiting for the question…'}
                disabled={!openTurn || submitting}
                className="mt-2 flex min-h-[200px] w-full flex-1 resize-none rounded-md border bg-surface px-3 py-2 text-[15px] leading-relaxed shadow-xs placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>{answer.trim() ? `${answer.trim().split(/\s+/).length} words` : 'Take your time; there is no minimum length.'}</span>
                <span className="hidden sm:inline">Ctrl/⌘ + Enter to submit</span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={() => void submit()} disabled={!openTurn || !answer.trim()} loading={submitting}>
                  <Send /> Submit answer
                </Button>
                <Tooltip content={serverStt || speechRecognitionSupported() ? (listening ? (serverStt ? 'Stop and transcribe' : 'Stop listening') : 'Dictate your answer') : 'Voice input needs Chrome or Edge'}>
                  <Button
                    variant={listening ? 'danger' : 'outline'}
                    disabled={!openTurn || !(serverStt || speechRecognitionSupported()) || submitting || transcribing}
                    loading={transcribing}
                    onClick={() => {
                      if (listening) stopListening();
                      else {
                        setVoiceMode(true);
                        startListening();
                      }
                    }}
                    aria-pressed={listening}
                  >
                    {listening ? <MicOff /> : <Mic />} {listening ? 'Stop' : 'Speak'}
                  </Button>
                </Tooltip>
                <Button variant="ghost" disabled={!openTurn || submitting} onClick={() => setConfirmSkip(true)}>
                  <SkipForward /> Skip
                </Button>
                {listening ? (
                  <span className="flex items-center gap-1.5 text-xs text-danger" role="status">
                    <span className="size-2 animate-pulse-soft rounded-full bg-danger" /> Listening…
                  </span>
                ) : null}
              </div>
              <ProctoringNotice className="mt-4" />
            </>
          )}
        </Card>

        {/* Transcript */}
        <Card className="flex flex-col p-0 lg:min-h-0">
          <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
            <MessageSquareText className="size-4 text-muted" /> Transcript
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin" aria-label="Transcript">
            {sectionTurns.length === 0 && !streaming ? <p className="text-sm text-muted">Questions and your answers appear here.</p> : null}
            {sectionTurns.map((t, i) => (
              <div key={t.id} className="space-y-2">
                <div className="rounded-lg bg-surface-2 p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted">
                    <span>Interviewer · Q{i + 1}</span>
                    {t.competencyKey ? <Badge variant="muted">{t.competencyKey.replace(/_/g, ' ')}</Badge> : null}
                  </div>
                  {t.question}
                </div>
                {t.answer ? (
                  <div className="ml-4 rounded-lg border p-3 text-sm">
                    <div className="mb-1 flex items-center justify-between text-xs text-muted">
                      <span>You{t.inputMode === 'voice' ? ' · voice' : ''}</span>
                      {t.answerDurationSeconds != null ? <span>{fmtDuration(t.answerDurationSeconds)}</span> : null}
                    </div>
                    <p className="whitespace-pre-wrap">{t.answer}</p>
                  </div>
                ) : t.skipped ? (
                  <div className="ml-4 text-xs italic text-muted">Skipped</div>
                ) : null}
              </div>
            ))}
            {streaming ? (
              <div className="rounded-lg bg-surface-2 p-3 text-sm text-muted">
                <div className="mb-1 text-xs">Interviewer</div>
                {streaming}
              </div>
            ) : null}
            <div ref={transcriptEnd} />
          </div>
        </Card>
      </div>

      <Dialog open={confirmSkip} onOpenChange={setConfirmSkip}>
        <DialogContent title="Skip this question?" description="A skipped question counts as not assessed for its competency. You cannot come back to it.">
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSkip(false)}>
              Keep answering
            </Button>
            <Button variant="danger" onClick={() => void skip()}>
              Skip question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InterviewerAvatar({ state }: { state: InterviewerState }) {
  return (
    <div className="relative">
      <div className={cn('flex size-12 items-center justify-center rounded-full bg-brand-100 text-brand-700 transition-colors dark:bg-brand-900/60 dark:text-brand-200', state === 'thinking' && 'animate-pulse-soft')}>
        <Bot className="size-6" />
      </div>
      {state === 'speaking' || state === 'listening' ? (
        <span className={cn('absolute -right-0.5 -top-0.5 size-3 rounded-full ring-2 ring-surface', state === 'speaking' ? 'bg-accent animate-pulse-soft' : 'bg-danger animate-pulse-soft')} aria-hidden />
      ) : null}
    </div>
  );
}
