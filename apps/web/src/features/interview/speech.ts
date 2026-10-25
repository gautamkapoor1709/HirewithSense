/** Minimal typings and helpers for the browser Web Speech API (Chrome/Edge/Safari). */

export interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function createRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = navigator.language || 'en-US';
  return r;
}

export const speechRecognitionSupported = () => {
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
};

export const speechSynthesisSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

/**
 * Voices load asynchronously in Chromium; on Linux a browser may have none at all (no
 * speech-dispatcher), in which case `speak()` would silently do nothing. Wait briefly for them.
 */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSynthesisSupported()) return Promise.resolve([]);
  if (!voicesPromise) {
    voicesPromise = new Promise((resolve) => {
      const have = window.speechSynthesis.getVoices();
      if (have.length) return resolve(have);
      const done = () => resolve(window.speechSynthesis.getVoices());
      window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
  }
  return voicesPromise;
}

export type SpeakResult = 'spoken' | 'no-voices' | 'unsupported' | 'failed';

/**
 * Read text with the browser voice. Resolves when playback ends (or immediately with a reason when
 * it cannot start), so callers can always move on. A watchdog covers browsers that accept the
 * utterance but never play it.
 */
export async function speakAsync(text: string): Promise<SpeakResult> {
  if (!speechSynthesisSupported()) return 'unsupported';
  const voices = await loadVoices();
  if (!voices.length) return 'no-voices';
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1;
    const preferred = voices.find((v) => v.lang.startsWith('en') && /Google|Natural|Samantha|Daniel/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('en')) ?? voices[0];
    if (preferred) u.voice = preferred;
    let started = false;
    let settled = false;
    const finish = (r: SpeakResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve(r);
    };
    const watchdog = setTimeout(() => {
      if (!started) {
        window.speechSynthesis.cancel();
        finish('failed');
      }
    }, 2500);
    u.onstart = () => {
      started = true;
    };
    u.onend = () => finish('spoken');
    u.onerror = (e) => finish(e.error === 'interrupted' || e.error === 'canceled' ? 'spoken' : 'failed');
    window.speechSynthesis.speak(u);
    // Chromium pauses long utterances after ~15 s unless nudged.
    const keepAlive = setInterval(() => {
      if (settled) return clearInterval(keepAlive);
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    }, 5000);
  });
}

/** Legacy callback form kept for existing call sites. */
export function speak(text: string, onEnd?: () => void): void {
  void speakAsync(text).then(() => onEnd?.());
}

export function stopSpeaking(): void {
  if (speechSynthesisSupported()) window.speechSynthesis.cancel();
}

/** Human explanations for SpeechRecognition error codes. */
export function recognitionErrorMessage(code: string): string {
  switch (code) {
    case 'network':
      return "Your browser's speech recognition needs Google's speech service, which is unavailable here (it is disabled in Brave and most Chromium builds). Enable server-side speech or type your answer.";
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was denied. Allow the microphone for this site and try again.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'language-not-supported':
      return 'Speech recognition does not support this language in your browser.';
    case 'aborted':
    case 'no-speech':
      return '';
    default:
      return `Speech recognition stopped (${code}).`;
  }
}

export const isBrave = () => Boolean((navigator as unknown as { brave?: unknown }).brave);

/* ------------------------- server-backed speech (optional) ------------------------- */

import { API_BASE, api } from '@/lib/api';

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

/** Text-to-speech through the API (`POST /ai/speak`). Falls back to the browser voice on failure. */
export async function speakViaServer(text: string, onEnd?: () => void): Promise<void> {
  stopSpeaking();
  try {
    const res = await api<Response>('/ai/speak', { method: 'POST', body: { text }, raw: true });
    const blob = await res.blob();
    currentUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentUrl);
    currentAudio.onended = () => {
      cleanupAudio();
      onEnd?.();
    };
    currentAudio.onerror = () => {
      cleanupAudio();
      speak(text, onEnd);
    };
    await currentAudio.play();
  } catch {
    cleanupAudio();
    speak(text, onEnd);
  }
}

function cleanupAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/** Stop both browser and server playback. */
export function stopAllSpeech(): void {
  cleanupAudio();
  stopSpeaking();
}

export const mediaRecorderSupported = () => typeof window !== 'undefined' && 'MediaRecorder' in window && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Records microphone audio and sends it to `POST /ai/transcribe` when stopped. Used when the server
 * has transcription enabled, which works in every browser (unlike SpeechRecognition).
 */
export class ServerRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }

  get active(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Stop recording and return the transcript (empty string when nothing was captured). */
  async stop(): Promise<string> {
    const recorder = this.recorder;
    if (!recorder) return '';
    const done = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== 'inactive') recorder.stop();
    await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
    this.chunks = [];
    if (blob.size < 1000) return '';
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', blob, `answer.${ext}`);
    const res = await api<{ text: string }>('/ai/transcribe', { method: 'POST', body: form });
    return res.text.trim();
  }

  abort(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

void API_BASE;
