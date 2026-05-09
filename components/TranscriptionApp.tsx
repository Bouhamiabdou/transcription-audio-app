"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type TranscriptEntry = {
  id: number;
  text: string;
  isFinal: boolean;
  timestamp: Date;
};

type Language = {
  code: string;
  label: string;
  flag: string;
};

const LANGUAGES: Language[] = [
  { code: "fr-FR", label: "Français", flag: "🇫🇷" },
  { code: "en-US", label: "English", flag: "🇺🇸" },
  { code: "ar-SA", label: "العربية", flag: "🇸🇦" },
  { code: "es-ES", label: "Español", flag: "🇪🇸" },
  { code: "de-DE", label: "Deutsch", flag: "🇩🇪" },
];

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

export default function TranscriptionApp() {
  const [isListening, setIsListening] = useState(false);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState("");
  const [language, setLanguage] = useState<Language>(LANGUAGES[0]);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const idCounterRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef(language);
  const restartRef = useRef(false);

  // Keep language ref in sync so startListening never has a stale value
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setIsSupported(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [entries, interim, scrollToBottom]);

  const startListening = useCallback(() => {
    setError(null);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = languageRef.current.code;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => {
      setIsListening(false);
      setInterim("");
      // Auto-restart with new language after a language change
      if (restartRef.current) {
        restartRef.current = false;
        setTimeout(() => startListening(), 50);
      }
    };

    recognition.onerror = (e) => {
      const msgs: Record<string, string> = {
        "not-allowed": "Accès au microphone refusé.",
        "no-speech": "Aucune parole détectée.",
        "network": "Erreur réseau.",
      };
      setError(msgs[e.error] ?? `Erreur: ${e.error}`);
      setIsListening(false);
    };

    recognition.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) {
            setEntries((prev) => [
              ...prev,
              { id: idCounterRef.current++, text, isFinal: true, timestamp: new Date() },
            ]);
          }
          setInterim("");
        } else {
          interimText += result[0].transcript;
        }
      }
      setInterim(interimText);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    setInterim("");
  }, []);

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const clearAll = () => {
    stopListening();
    setEntries([]);
    setInterim("");
    setError(null);
  };

  const copyAll = async () => {
    const text = entries.map((e) => e.text).join(" ");
    await navigator.clipboard.writeText(text);
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const wordCount = entries.reduce((acc, e) => acc + e.text.split(/\s+/).length, 0);

  if (!isSupported) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="card p-8 text-center max-w-sm w-full">
          <div className="text-5xl mb-4">🚫</div>
          <h2 className="text-xl font-bold mb-2">Non supporté</h2>
          <p className="text-slate-400 text-sm">
            La reconnaissance vocale n&apos;est pas disponible sur ce navigateur.
            Essayez Chrome ou Edge.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh safe-top">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-sm border-b border-slate-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${isListening ? "bg-red-500 animate-pulse" : "bg-slate-600"}`} />
            <h1 className="font-bold text-base sm:text-lg truncate">Transcription Audio</h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Langue */}
            <div className="relative">
              <button
                onClick={() => setShowLangPicker((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-sm font-medium transition-colors"
              >
                <span>{language.flag}</span>
                <span className="hidden sm:inline">{language.label}</span>
                <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showLangPicker && (
                <div className="absolute right-0 top-full mt-1 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl z-20 min-w-[140px]">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        languageRef.current = lang;
                        setLanguage(lang);
                        setShowLangPicker(false);
                        if (isListening) {
                          restartRef.current = true;
                          recognitionRef.current?.stop();
                        }
                      }}
                      className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-slate-700 transition-colors ${lang.code === language.code ? "text-blue-400 font-medium" : ""}`}
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Stats bar */}
      {entries.length > 0 && (
        <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-2">
          <div className="max-w-2xl mx-auto flex items-center justify-between text-xs text-slate-500">
            <span>{entries.length} segment{entries.length > 1 ? "s" : ""} · {wordCount} mot{wordCount > 1 ? "s" : ""}</span>
            <div className="flex gap-3">
              <button onClick={copyAll} className="flex items-center gap-1 hover:text-white transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copier
              </button>
              <button onClick={clearAll} className="flex items-center gap-1 hover:text-red-400 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Effacer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transcription area */}
      <main className="flex-1 overflow-hidden flex flex-col max-w-2xl w-full mx-auto px-4">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto py-4 space-y-3 scroll-smooth"
        >
          {entries.length === 0 && !interim && !isListening && (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="text-6xl mb-4 opacity-30">🎙️</div>
              <p className="text-slate-500 text-sm max-w-xs">
                Appuie sur le bouton pour commencer la transcription en {language.label}
              </p>
            </div>
          )}

          {entries.length === 0 && !interim && isListening && (
            <div className="flex flex-col items-center justify-center h-full py-16">
              <p className="text-slate-400 text-sm animate-pulse">En attente de la parole…</p>
            </div>
          )}

          {entries.map((entry) => (
            <div key={entry.id} className="card px-4 py-3 space-y-1">
              <p className="text-white text-sm sm:text-base leading-relaxed">{entry.text}</p>
              <p className="text-slate-600 text-xs">{formatTime(entry.timestamp)}</p>
            </div>
          ))}

          {interim && (
            <div className="card px-4 py-3 border-blue-800/50 bg-blue-950/20">
              <p className="text-blue-300 text-sm sm:text-base leading-relaxed italic">{interim}</p>
            </div>
          )}
        </div>
      </main>

      {/* Error */}
      {error && (
        <div className="max-w-2xl w-full mx-auto px-4 pb-2">
          <div className="bg-red-950/50 border border-red-800 text-red-300 text-sm px-4 py-2.5 rounded-xl flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <footer className="safe-bottom bg-slate-950/80 backdrop-blur-sm border-t border-slate-800 px-4 pt-4 pb-6">
        <div className="max-w-2xl mx-auto flex flex-col items-center gap-4">
          {/* Waveform */}
          <div className="flex items-center gap-0.5 h-8">
            {isListening ? (
              Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="wave-bar h-full"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))
            ) : (
              Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="w-1 h-1 bg-slate-700 rounded-full" />
              ))
            )}
          </div>

          {/* Main button */}
          <button
            onClick={toggleListening}
            className={`btn-primary w-20 h-20 text-white shadow-lg
              ${isListening
                ? "bg-red-600 hover:bg-red-700 shadow-red-900/50 ring-4 ring-red-500/20"
                : "bg-blue-600 hover:bg-blue-700 shadow-blue-900/50 ring-4 ring-blue-500/20"
              }`}
          >
            {isListening ? (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 1a4 4 0 014 4v6a4 4 0 01-8 0V5a4 4 0 014-4z" />
                <path d="M19 10a1 1 0 012 0 9 9 0 01-18 0 1 1 0 012 0 7 7 0 0014 0z" />
                <path d="M12 19v4m-3 0h6" strokeLinecap="round" strokeWidth={2} stroke="currentColor" fill="none" />
              </svg>
            )}
          </button>

          <p className="text-xs text-slate-600">
            {isListening ? "Tap pour arrêter" : "Tap pour enregistrer"}
          </p>
        </div>
      </footer>

      {/* Overlay close lang picker */}
      {showLangPicker && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setShowLangPicker(false)}
        />
      )}
    </div>
  );
}
