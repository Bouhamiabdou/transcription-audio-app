"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

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

type Tab = "mic" | "file";

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGES: Language[] = [
  { code: "fr-FR", label: "Français", flag: "🇫🇷" },
  { code: "en-US", label: "English", flag: "🇺🇸" },
  { code: "ar-SA", label: "العربية", flag: "🇸🇦" },
  { code: "ar-MA", label: "Darija (MA)", flag: "🇲🇦" },
  { code: "es-ES", label: "Español", flag: "🇪🇸" },
  { code: "de-DE", label: "Deutsch", flag: "🇩🇪" },
];

const GROQ_MODELS = ["whisper-large-v3", "whisper-large-v3-turbo", "distil-whisper-large-v3-en"];
const CHUNK_SIZE_MB = 20; // Groq limit ~25MB per request, we use 20MB to be safe
const CHUNK_SIZE_BYTES = CHUNK_SIZE_MB * 1024 * 1024;

// ─── Speech Recognition interfaces ───────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(date: Date) {
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m${s.toString().padStart(2, "0")}s`;
}

function exportTXT(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF(text: string, filename: string) {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${filename}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #222; line-height: 1.7; }
  h1 { font-size: 1.4em; border-bottom: 2px solid #2563eb; padding-bottom: 8px; color: #1e3a8a; }
  .meta { font-size: 0.85em; color: #555; margin-bottom: 24px; }
  p { text-align: justify; }
</style>
</head>
<body>
<h1>Transcription Audio</h1>
<div class="meta">Généré le ${new Date().toLocaleString("fr-FR")} | Application Transcription Audio</div>
<p>${text.replace(/\n/g, "</p><p>")}</p>
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) {
    win.onload = () => {
      win.print();
      URL.revokeObjectURL(url);
    };
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TranscriptionApp() {
  // — Tabs
  const [activeTab, setActiveTab] = useState<Tab>("mic");

  // — Language
  const [language, setLanguage] = useState<Language>(LANGUAGES[0]);
  const [showLangModal, setShowLangModal] = useState(false);
  const languageRef = useRef(language);

  // — Mic tab
  const [isListening, setIsListening] = useState(false);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState("");
  const [isSupported, setIsSupported] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const idCounterRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef(false);

  // — File tab
  const [groqApiKey, setGroqApiKey] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);
  const [fileProgressText, setFileProgressText] = useState("");
  const [fileTranscript, setFileTranscript] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Keep languageRef in sync
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // ── Check browser support
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) setIsSupported(false);
  }, []);

  // ── Auto-scroll mic transcript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, interim]);

  // ── Load saved Groq API key
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("groq_key");
      if (saved) setGroqApiKey(saved);
    } catch {}
  }, []);

  // ─────────────────────────── MIC TAB LOGIC ──────────────────────────────────

  const startListening = useCallback(() => {
    setMicError(null);
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
      if (restartRef.current) {
        restartRef.current = false;
        setTimeout(() => startListening(), 80);
      }
    };
    recognition.onerror = (e) => {
      const msgs: Record<string, string> = {
        "not-allowed": "Accès au microphone refusé.",
        "no-speech": "Aucune parole détectée.",
        network: "Erreur réseau.",
      };
      setMicError(msgs[e.error] ?? `Erreur: ${e.error}`);
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
    if (isListening) stopListening();
    else startListening();
  };

  const clearMic = () => {
    stopListening();
    setEntries([]);
    setInterim("");
    setMicError(null);
  };

  const micFullText = entries.map((e) => e.text).join(" ");
  const wordCount = entries.reduce((acc, e) => acc + e.text.split(/\s+/).length, 0);

  // ─────────────────────────── FILE TAB LOGIC ─────────────────────────────────

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  };

  const handleFileSelected = (file: File) => {
    setSelectedFile(file);
    setFileTranscript("");
    setFileError(null);
    setFileProgress(0);
    setFileProgressText("");
  };

  const transcribeChunk = async (
    chunk: Blob,
    index: number,
    total: number,
    filename: string
  ): Promise<string> => {
    const form = new FormData();
    // Determine extension from original filename
    const ext = filename.split(".").pop() || "mp4";
    form.append("file", chunk, `chunk_${index}.${ext}`);
    form.append("model", GROQ_MODELS[0]);
    form.append("language", languageRef.current.code.split("-")[0]);
    form.append("response_format", "text");

    setFileProgressText(`Transcription chunk ${index + 1}/${total}…`);

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey.trim()}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq API error (chunk ${index + 1}): ${err}`);
    }

    return (await res.text()).trim();
  };

  const startFileTranscription = async () => {
    if (!selectedFile) return;
    if (!groqApiKey.trim()) {
      setFileError("Entrez votre clé API Groq (gratuite sur console.groq.com).");
      return;
    }

    setIsTranscribing(true);
    setFileTranscript("");
    setFileError(null);
    setFileProgress(0);

    try {
      // Save key for session
      try { sessionStorage.setItem("groq_key", groqApiKey.trim()); } catch {}

      const fileSize = selectedFile.size;
      const totalChunks = Math.ceil(fileSize / CHUNK_SIZE_BYTES);
      const texts: string[] = [];

      setFileProgressText(`Préparation de ${totalChunks} chunk(s)…`);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE_BYTES;
        const end = Math.min(start + CHUNK_SIZE_BYTES, fileSize);
        const chunk = selectedFile.slice(start, end);

        const text = await transcribeChunk(chunk, i, totalChunks, selectedFile.name);
        texts.push(text);
        setFileProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      setFileTranscript(texts.join(" "));
      setFileProgressText("Transcription terminée ✓");
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : "Erreur lors de la transcription.");
      setFileProgressText("");
    } finally {
      setIsTranscribing(false);
    }
  };

  // ─────────────────────────── LANGUAGE CHANGE ────────────────────────────────

  const changeLang = (lang: Language) => {
    languageRef.current = lang;
    setLanguage(lang);
    setShowLangModal(false);
    if (isListening) {
      restartRef.current = true;
      recognitionRef.current?.stop();
    }
  };

  // ─────────────────────────── RENDER ─────────────────────────────────────────

  if (!isSupported) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="card p-8 text-center max-w-sm w-full">
          <div className="text-5xl mb-4">🚫</div>
          <h2 className="text-xl font-bold mb-2">Non supporté</h2>
          <p className="text-slate-400 text-sm">
            La reconnaissance vocale n&apos;est pas disponible sur ce navigateur. Essayez Chrome ou Edge.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh safe-top">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-sm border-b border-slate-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                isListening ? "bg-red-500 animate-pulse" : "bg-slate-600"
              }`}
            />
            <h1 className="font-bold text-base sm:text-lg truncate">Transcription Audio</h1>
          </div>

          {/* Language button */}
          <button
            onClick={() => setShowLangModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-sm font-medium transition-colors"
          >
            <span>{language.flag}</span>
            <span className="hidden sm:inline">{language.label}</span>
            <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 bg-slate-950/60">
        <div className="max-w-2xl mx-auto flex">
          <button
            onClick={() => setActiveTab("mic")}
            className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === "mic"
                ? "text-blue-400 border-b-2 border-blue-500"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            🎤 Microphone
          </button>
          <button
            onClick={() => setActiveTab("file")}
            className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === "file"
                ? "text-blue-400 border-b-2 border-blue-500"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            📁 Fichier Audio
          </button>
        </div>
      </div>

      {/* ══════════════════════ MIC TAB ═══════════════════════════════════ */}
      {activeTab === "mic" && (
        <>
          {/* Stats bar */}
          {entries.length > 0 && (
            <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-2">
              <div className="max-w-2xl mx-auto flex items-center justify-between text-xs text-slate-500">
                <span>
                  {entries.length} segment{entries.length > 1 ? "s" : ""} · {wordCount} mot
                  {wordCount > 1 ? "s" : ""}
                </span>
                <div className="flex gap-3">
                  <button
                    onClick={() => exportTXT(micFullText, "transcription.txt")}
                    className="flex items-center gap-1 hover:text-white transition-colors"
                  >
                    📄 TXT
                  </button>
                  <button
                    onClick={() => exportPDF(micFullText, "transcription")}
                    className="flex items-center gap-1 hover:text-white transition-colors"
                  >
                    📑 PDF
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(micFullText)}
                    className="flex items-center gap-1 hover:text-white transition-colors"
                  >
                    📋 Copier
                  </button>
                  <button
                    onClick={clearMic}
                    className="flex items-center gap-1 hover:text-red-400 transition-colors"
                  >
                    🗑️ Effacer
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Transcript area */}
          <main className="flex-1 overflow-hidden flex flex-col max-w-2xl w-full mx-auto px-4">
            <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-3 scroll-smooth">
              {entries.length === 0 && !interim && !isListening && (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <div className="text-6xl mb-4 opacity-30">🎙️</div>
                  <p className="text-slate-500 text-sm max-w-xs">
                    Appuyez sur le bouton pour commencer la transcription en {language.label}
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
          {micError && (
            <div className="max-w-2xl w-full mx-auto px-4 pb-2">
              <div className="bg-red-950/50 border border-red-800 text-red-300 text-sm px-4 py-2.5 rounded-xl flex items-center gap-2">
                ⚠️ {micError}
              </div>
            </div>
          )}

          {/* Bottom controls */}
          <footer className="safe-bottom bg-slate-950/80 backdrop-blur-sm border-t border-slate-800 px-4 pt-4 pb-6">
            <div className="max-w-2xl mx-auto flex flex-col items-center gap-4">
              {/* Waveform */}
              <div className="flex items-center gap-0.5 h-8">
                {isListening
                  ? Array.from({ length: 10 }).map((_, i) => (
                      <div
                        key={i}
                        className="wave-bar h-full"
                        style={{ animationDelay: `${i * 0.1}s` }}
                      />
                    ))
                  : Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="w-1 h-1 bg-slate-700 rounded-full" />
                    ))}
              </div>

              {/* Mic button */}
              <button
                onClick={toggleListening}
                className={`btn-primary w-20 h-20 text-white shadow-lg ${
                  isListening
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
        </>
      )}

      {/* ══════════════════════ FILE TAB ══════════════════════════════════ */}
      {activeTab === "file" && (
        <main className="flex-1 overflow-y-auto max-w-2xl w-full mx-auto px-4 py-6 space-y-5">
          {/* API Key */}
          <div className="card p-4 space-y-2">
            <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
              🔑 Clé API Groq{" "}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 text-xs hover:underline"
              >
                (gratuit — obtenir une clé)
              </a>
            </label>
            <input
              type="password"
              value={groqApiKey}
              onChange={(e) => setGroqApiKey(e.target.value)}
              placeholder="gsk_…"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-500">
              Whisper v3 via Groq — gratuit, rapide, multilingue. Clé stockée en session uniquement.
            </p>
          </div>

          {/* File drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`card p-8 text-center cursor-pointer transition-colors ${
              isDragging ? "border-blue-500 bg-blue-950/30" : "hover:bg-slate-800/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
              }}
            />
            <div className="text-4xl mb-3">{isDragging ? "📂" : "🎵"}</div>
            {selectedFile ? (
              <div className="space-y-1">
                <p className="text-white font-medium text-sm">{selectedFile.name}</p>
                <p className="text-slate-400 text-xs">
                  {(selectedFile.size / (1024 * 1024)).toFixed(1)} Mo
                  {selectedFile.size > CHUNK_SIZE_BYTES &&
                    ` · ${Math.ceil(selectedFile.size / CHUNK_SIZE_BYTES)} chunks`}
                  </p>>
                <p className="text-blue-400 text-xs">Cliquer pour changer de fichier</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-slate-300 text-sm">Glisser un fichier audio/vidéo ici</p>
                <p className="text-slate-500 text-xs">ou cliquer pour sélectionner</p>
                <p className="text-slate-600 text-xs mt-2">MP3, M4A, MP4, WAV, OGG… fichiers volumineux supportés</p>
              </div>
            )}
          </div>

          {/* Language selection for file tab */}
          <div className="flex items-center justify-between card px-4 py-3">
            <span className="text-sm text-slate-400">Langue de transcription</span>
            <button
              onClick={() => setShowLangModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-700 hover:bg-slate-600 text-sm transition-colors"
            >
              {language.flag} {language.label}
            </button>
          </div>

          {/* Transcribe button */}
          <button
            onClick={startFileTranscription}
            disabled={!selectedFile || isTranscribing}
            className={`w-full py-3 rounded-xl font-medium text-sm transition-all ${
              !selectedFile || isTranscribing
                ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/30"
            }`}
          >
            {isTranscribing ? "⏳ Transcription en cours…" : "▶️ Démarrer la transcription"}
          </button>

          {/* Progress */}
          {isTranscribing && (
            <div className="card p-4 space-y-3">
              <div className="flex justify-between text-xs text-slate-400">
                <span>{fileProgressText}</span>
                <span>{fileProgress}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${fileProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* File error */}
          {fileError && (
            <div className="bg-red-950/50 border border-red-800 text-red-300 text-sm px-4 py-3 rounded-xl">
              ⚠️ {fileError}
            </div>
          )}

          {/* File transcript result */}
          {fileTranscript && (
            <div className="card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-300">
                  ✅ Transcription — {fileTranscript.split(/\s+/).length} mots
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => exportTXT(fileTranscript, `${selectedFile?.name ?? "transcription"}.txt`)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
                  >
                    📄 TXT
                  </button>
                  <button
                    onClick={() => exportPDF(fileTranscript, selectedFile?.name ?? "transcription")}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
                  >
                    📑 PDF
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(fileTranscript)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
                  >
                    📋
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                {fileTranscript}
              </p>
            </div>
          )}
        </main>
      )}

      {/* ══════════════════════ LANGUAGE MODAL ════════════════════════════ */}
      {showLangModal && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowLangModal(false)}
          />
          {/* Modal centré */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden pointer-events-auto">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <span className="font-semibold text-sm">Choisir la langue</span>
                <button
                  onClick={() => setShowLangModal(false)}
                  className="text-slate-500 hover:text-white text-lg leading-none"
                >
                  ×
                </button>
              </div>
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => changeLang(lang)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-sm text-left hover:bg-slate-800 transition-colors ${
                    lang.code === language.code ? "text-blue-400 font-medium bg-slate-800/50" : ""
                  }`}
                >
                  <span className="text-xl">{lang.flag}</span>
                  <span>{lang.label}</span>
                  {lang.code === language.code && <span className="ml-auto text-blue-400 text-xs">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
