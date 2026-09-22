import { useEffect, useRef, useState } from 'react';
import { generateLawResponse } from './ai/client.js';

const SUGGESTIONS = [
  'What are my rights if I am terminated without notice in the UAE?',
  'UAE labor law: how is end-of-service gratuity calculated?',
  'ইউএই-তে ওভারটাইম পে এর নিয়ম কী?',
  'What is the probation period under MOHRE rules?',
];

const TICKER =
  'আপনার প্রশ্নটি মেসেজ বক্সে করুন · Drop your message in the message box · ';

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Hello! I am your UAE Law AI Assistant. Ask me anything about UAE laws, MOHRE labor rules, or Dubai regulations — in English or Bangla.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [micLang, setMicLang] = useState('en-US');
  const [micError, setMicError] = useState('');

  const bottomRef = useRef(null);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef(''); // finalized text captured this session
  const sendingAfterStopRef = useRef(false);

  const SpeechRecognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.abort(); } catch {}
    };
  }, []);

  async function send(text) {
    const prompt = (text ?? input).trim();
    if (!prompt || loading) return;
    stopMic(false);
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: prompt }]);
    setLoading(true);
    try {
      const reply = await generateLawResponse(prompt);
      setMessages((m) => [...m, { role: 'assistant', text: reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function stopMic(andSend) {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    if (rec) {
      sendingAfterStopRef.current = Boolean(andSend);
      rec.onend = () => {
        const heard = transcriptRef.current.trim();
        transcriptRef.current = '';
        if (sendingAfterStopRef.current && heard) {
          sendingAfterStopRef.current = false;
          send(heard);
        }
      };
      try { rec.stop(); } catch {}
    }
  }

  async function toggleMic() {
    setMicError('');
    if (!SpeechRecognition) {
      setMicError('Voice input is not supported in this browser. Please use Chrome or Safari.');
      return;
    }
    if (listening) {
      stopMic(true); // stop and auto-send whatever was heard
      return;
    }

    // 1) Explicitly ask for microphone permission first — without this,
    //    some browsers (iOS Safari) silently refuse recognition.start().
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (err) {
      setMicError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was denied. Please allow the microphone in your browser settings and try again.'
          : 'Could not access the microphone. Please try again.'
      );
      return;
    }

    // 2) Start speech recognition.
    let rec;
    try {
      rec = new SpeechRecognition();
    } catch {
      setMicError('Voice input could not start in this browser.');
      return;
    }
    recognitionRef.current = rec;
    transcriptRef.current = '';

    rec.lang = micLang;
    rec.interimResults = true;
    // NOTE: continuous=false is far more reliable on iOS Safari; we restart
    // in onend while the user keeps listening.
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setListening(true);

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          transcriptRef.current = (transcriptRef.current + ' ' + r[0].transcript).trim();
        } else {
          interim += r[0].transcript;
        }
      }
      const shown = (transcriptRef.current + ' ' + interim).trim();
      if (shown) setInput(shown);
    };

    rec.onerror = (event) => {
      const code = event?.error || '';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setMicError('Microphone permission denied. Enable it in Settings > Safari and retry.');
      } else if (code === 'network') {
        setMicError('Speech service needs internet — check your connection.');
      } else if (code === 'language-not-supported') {
        setMicError('That language is not supported on this device. Try the other one.');
      }
      // 'no-speech' / 'aborted' are harmless; ignore them.
      if (code !== 'no-speech' && code !== 'aborted') {
        recognitionRef.current = null;
        setListening(false);
      }
    };

    rec.onend = () => {
      // Keep listening across engine restarts until the user taps stop.
      if (recognitionRef.current === rec) {
        try {
          rec.start();
          return;
        } catch {}
      }
      setListening(false);
    };

    try {
      rec.start();
    } catch {
      recognitionRef.current = null;
      setMicError('Voice input could not start. Please try again.');
    }
  }

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-lg">⚖️</div>
          <div className="flex-1">
            <h1 className="text-base font-semibold sm:text-lg">UAE Law AI Assistant</h1>
            <p className="text-xs text-slate-400">UAE Laws · MOHRE · Dubai Regulations</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            Live
          </span>
        </div>
        {/* Continuous scrolling marquee */}
        <div className="overflow-hidden border-t border-slate-800/60 bg-slate-900/70 py-1.5" dir="ltr">
          <div className="marquee-track">
            <span>{TICKER.repeat(4)}</span>
            <span aria-hidden="true">{TICKER.repeat(4)}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[75%] sm:text-base ${
                msg.role === 'user'
                  ? 'rounded-br-sm bg-emerald-600 text-white'
                  : 'rounded-bl-sm bg-slate-800 text-slate-100'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-slate-800 px-4 py-3 text-sm text-slate-400">Thinking…</div>
            </div>
          )}

          {messages.length === 1 && !loading && (
            <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-left text-xs text-slate-300 transition hover:border-emerald-500 hover:text-white sm:text-sm">
                  {s}
                </button>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="sticky bottom-0 border-t border-slate-800 bg-slate-900/90 backdrop-blur">
        {micError && (
          <p className="mx-auto max-w-3xl px-4 pt-2 text-[11px] text-amber-400">{micError}</p>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="mx-auto flex max-w-3xl items-end gap-2 px-4 py-3"
        >
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={toggleMic}
              title={listening ? 'Stop and send' : 'Start voice input'}
              className={`flex h-11 w-11 items-center justify-center rounded-xl border text-lg transition ${
                listening
                  ? 'animate-pulse border-red-500 bg-red-500/20 text-red-400'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-emerald-500 hover:text-white'
              }`}
            >
              {listening ? '⏹' : '🎤'}
            </button>
            <button
              type="button"
              onClick={() => setMicLang((l) => (l === 'en-US' ? 'bn-BD' : 'en-US'))}
              title="Switch voice language"
              className="rounded border border-slate-700 px-1 text-[9px] font-semibold text-slate-400 hover:text-white"
            >
              {micLang === 'en-US' ? 'EN' : 'বাং'}
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            rows={1}
            placeholder={listening ? 'Listening… speak now, tap ⏹ to send' : 'Ask about UAE law (English or Bangla)…'}
            className="max-h-32 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500 sm:text-base"
          />
          <button type="submit" disabled={loading || !input.trim()}
            className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40 sm:px-6">
            Send
          </button>
        </form>
        <p className="pb-2 text-center text-[10px] text-slate-500">AI-generated guidance only — not legal advice.</p>
      </footer>
    </div>
  );
}
