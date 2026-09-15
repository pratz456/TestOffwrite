"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Bot, ExternalLink, ImagePlus, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface TaxAssistantScreenProps {
  user: { id: string; email?: string };
  userProfile?: unknown;
  onBack: () => void;
}

interface Assessment {
  status: "needs_details" | "conditional" | "not_supported";
  photoObservations: string[];
  questions: string[];
  sources: Array<{ id: string; title: string; url: string; reviewedAt: string }>;
  taxYear: number;
  yearNotice: string | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  contextContent?: string;
  imageDataUrl?: string;
  assessment?: Assessment;
}

interface PhotoAttachment {
  name: string;
  previewUrl: string;
  dataUrl: string | null;
}

const MAX_MESSAGE_LENGTH = 4000;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STARTER_QUESTIONS = [
  "Can I write off a laptop I use for work and at home?",
  "Can I deduct lunch with a client?",
  "What records should I keep for a business purchase?",
];

const STATUS_LABELS: Record<Assessment["status"], string> = {
  needs_details: "A few details will help",
  conditional: "It depends on your circumstances",
  not_supported: "This needs more specific guidance",
};

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function renderMarkdown(text: string): React.ReactNode {
  return text.split("\n").map((line, index) => {
    if (!line.trim()) return null;
    const isListItem = /^[-*]\s+|^\d+\.\s+/.test(line);
    const content = line.replace(/^[-*]\s+|^\d+\.\s+/, "");
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) => (
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={partIndex} className="font-semibold">{part.slice(2, -2)}</strong>
        : <React.Fragment key={partIndex}>{part}</React.Fragment>
    ));
    return <p key={index} className={`mb-2 last:mb-0 ${isListItem ? "pl-3" : ""}`}>{isListItem && "• "}{parts}</p>;
  });
}

export function TaxAssistantScreen({ user, onBack }: TaxAssistantScreenProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [taxYear, setTaxYear] = useState<2026 | 2027>(2026);
  const [photo, setPhoto] = useState<PhotoAttachment | null>(null);
  const [isReadingPhoto, setIsReadingPhoto] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answeringQuestion, setAnsweringQuestion] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileReaderRef = useRef<FileReader | null>(null);
  const photoRef = useRef<PhotoAttachment | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const fileReadVersionRef = useRef(0);
  const readingPhotoRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const requestVersionRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const id = useId();

  useEffect(() => {
    setMessages([]);
    setInputValue("");
    setPhoto(null);
    setError(null);
    setAnsweringQuestion(null);
    setIsLoading(false);
    setIsReadingPhoto(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    return () => {
      requestVersionRef.current += 1;
      requestControllerRef.current?.abort();
      requestInFlightRef.current = false;
      fileReadVersionRef.current += 1;
      fileReaderRef.current?.abort();
      readingPhotoRef.current = false;
      photoRef.current = null;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, [user.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const removePhoto = () => {
    fileReadVersionRef.current += 1;
    fileReaderRef.current?.abort();
    fileReaderRef.current = null;
    readingPhotoRef.current = false;
    setIsReadingPhoto(false);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    photoRef.current = null;
    setPhoto(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePhotoSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || requestInFlightRef.current) return;
    removePhoto();
    setError(null);
    if (!PHOTO_TYPES.has(file.type)) {
      setError("Choose a JPEG, PNG, or WebP photo. Convert HEIC photos to JPEG first.");
      return;
    }
    if (file.size === 0 || file.size > MAX_PHOTO_BYTES) {
      setError("Choose a photo up to 2 MB. Empty files cannot be attached.");
      return;
    }

    const version = fileReadVersionRef.current;
    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;
    photoRef.current = { name: file.name, previewUrl, dataUrl: null };
    setPhoto(photoRef.current);
    readingPhotoRef.current = true;
    setIsReadingPhoto(true);
    const reader = new FileReader();
    fileReaderRef.current = reader;
    reader.onload = () => {
      if (version !== fileReadVersionRef.current) return;
      if (typeof reader.result !== "string") {
        removePhoto();
        setError("This photo could not be read. Please choose it again.");
        return;
      }
      readingPhotoRef.current = false;
      setIsReadingPhoto(false);
      photoRef.current = { name: file.name, previewUrl, dataUrl: reader.result };
      setPhoto(photoRef.current);
      fileReaderRef.current = null;
    };
    reader.onerror = () => {
      if (version !== fileReadVersionRef.current) return;
      removePhoto();
      setError("This photo could not be read. Please choose it again.");
    };
    try {
      reader.readAsDataURL(file);
    } catch {
      removePhoto();
      setError("This photo could not be read. Please choose it again.");
    }
  };

  const sendMessage = async () => {
    if (requestInFlightRef.current || readingPhotoRef.current) return;
    const attachedPhoto = photoRef.current;
    const draft = inputValue.trim();
    if (!draft && !attachedPhoto?.dataUrl) return;
    if (answeringQuestion && !draft) return;
    const message = answeringQuestion
      ? `${answeringQuestion}\nMy answer: ${draft}`
      : draft || "Can I write this off?";
    if (message.length > MAX_MESSAGE_LENGTH) {
      setError("Please shorten your question and answer to 4,000 characters.");
      return;
    }

    requestInFlightRef.current = true;
    const version = ++requestVersionRef.current;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const history = messages;
    const userMessage: Message = { role: "user", content: message, imageDataUrl: attachedPhoto?.dataUrl || undefined };
    setMessages([...history, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await makeAuthenticatedRequest("/api/ai/tax-assistant", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          message,
          taxYear,
          conversationHistory: history.slice(-12).map(({ role, content, contextContent }) => ({ role, content: (contextContent || content).slice(0, 6000) })),
          ...(attachedPhoto?.dataUrl ? { imageDataUrl: attachedPhoto.dataUrl } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Your question could not be sent. Please try again.");
      if (typeof data.reply !== "string" || !data.reply.trim()) {
        throw new Error("No answer was returned. Please try again.");
      }
      if (version !== requestVersionRef.current) return;
      const returnedHistory = Array.isArray(data.conversationHistory) ? data.conversationHistory : [];
      const lastAssistantTurn = returnedHistory[returnedHistory.length - 1];
      const assessment: Assessment | undefined = data.assessment;
      const fallbackContext = [
        data.reply,
        assessment?.photoObservations?.length
          ? `Unverified photo observations (not confirmed facts):\n${assessment.photoObservations.join("\n")}`
          : null,
        assessment?.questions?.length ? `Follow-up questions:\n${assessment.questions.join("\n")}` : null,
      ].filter(Boolean).join("\n\n");
      const contextContent = lastAssistantTurn?.role === "assistant" && typeof lastAssistantTurn.content === "string" && lastAssistantTurn.content.trim()
        ? lastAssistantTurn.content
        : fallbackContext;
      setMessages([...history, userMessage, { role: "assistant", content: data.reply, contextContent: contextContent.slice(0, 6000), assessment }]);
      setInputValue("");
      setAnsweringQuestion(null);
      removePhoto();
    } catch (err) {
      if (version !== requestVersionRef.current) return;
      setMessages(history);
      setError(err instanceof Error ? err.message : "Your question could not be sent. Please try again.");
      // Keep the draft, answer prompt, and attachment intact for a retry.
    } finally {
      if (version === requestVersionRef.current) {
        requestInFlightRef.current = false;
        requestControllerRef.current = null;
        setIsLoading(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  };

  const handleYearChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (requestInFlightRef.current) return;
    setTaxYear(event.target.value === "2027" ? 2027 : 2026);
    setMessages([]);
    setAnsweringQuestion(null);
    setError(null);
    inputRef.current?.focus();
  };

  const busy = isLoading || isReadingPhoto;
  const answerPrefixLength = answeringQuestion ? answeringQuestion.length + "\nMy answer: ".length : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Go back"><ArrowLeft className="h-5 w-5" /></Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground sm:text-xl">Can I write this off?</h1>
            <p className="text-xs text-muted-foreground">Business deduction guidance with sources</p>
          </div>
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
            <label htmlFor={`${id}-year`} className="text-xs text-muted-foreground">Tax year</label>
            <select id={`${id}-year`} value={taxYear} onChange={handleYearChange} disabled={isLoading}
              aria-describedby={`${id}-year-note`}
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              <option value={2026}>2026</option><option value={2027}>2027</option>
            </select>
          </div>
          <p id={`${id}-year-note`} className="w-full text-xs text-muted-foreground" role="status">
            {taxYear === 2027 ? "2027 planning guidance: annual limits are not verified. Changing years starts a new conversation." : "Guidance is conditional on your facts. Changing years starts a new conversation."}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center py-8 text-center sm:py-12">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10"><MessageCircle className="h-7 w-7 text-primary" /></div>
              <h2 className="mb-2 text-lg font-medium text-foreground">Tell us about the purchase</h2>
              <p className="mb-6 max-w-md text-sm text-muted-foreground">Describe what you bought and how you use it for your business. You can also add a receipt, screenshot, or photo.</p>
              <div className="flex w-full max-w-xl flex-col gap-2">
                {STARTER_QUESTIONS.map((question) => (
                  <button key={question} type="button" disabled={busy}
                    onClick={() => { setInputValue(question); setAnsweringQuestion(null); inputRef.current?.focus(); }}
                    className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                    <Sparkles className="h-4 w-4 shrink-0 text-primary" />{question}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4" role="log" aria-label="Deduction conversation" aria-live="polite" aria-relevant="additions">
            {messages.map((message, index) => (
              <div key={index} className={`flex gap-2 sm:gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                {message.role === "assistant" && <div aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10"><Bot className="h-4 w-4 text-primary" /></div>}
                <article aria-label={message.role === "user" ? "Your question" : "Assistant guidance"}
                  className={`min-w-0 max-w-[90%] break-words rounded-2xl px-4 py-3 text-sm sm:max-w-[85%] ${message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground"}`}>
                  {message.imageDataUrl && <Image src={message.imageDataUrl} alt="Photo included with your question" width={200} height={140} unoptimized className="mb-3 max-h-40 rounded-lg object-contain" />}
                  {message.assessment && <p className="mb-2 text-xs font-semibold text-primary">{STATUS_LABELS[message.assessment.status]} · {message.assessment.taxYear}</p>}
                  {message.role === "user" ? <p className="whitespace-pre-wrap">{message.content}</p> : renderMarkdown(message.content)}
                  {message.assessment?.yearNotice && <p className="mt-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">{message.assessment.yearNotice}</p>}
                  {!!message.assessment?.photoObservations?.length && (
                    <div className="mt-4 border-t border-border pt-3">
                      <h3 className="mb-2 text-xs font-semibold">What the photo appears to show</h3>
                      <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{message.assessment.photoObservations.map((observation, observationIndex) => <li key={observationIndex}>{observation}</li>)}</ul>
                    </div>
                  )}
                  {!!message.assessment?.questions?.length && (
                    <div className="mt-4 space-y-2">
                      <h3 className="text-xs font-semibold">Add a detail</h3>
                      {message.assessment.questions.map((question, questionIndex) => (
                        <button key={questionIndex} type="button" disabled={busy}
                          onClick={() => { setAnsweringQuestion(question); inputRef.current?.focus(); }} aria-label={`Answer: ${question}`}
                          className="block min-h-11 w-full rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{question}</button>
                      ))}
                    </div>
                  )}
                  {!!message.assessment?.sources?.length && (
                    <div className="mt-4 border-t border-border pt-3">
                      <h3 className="mb-2 text-xs font-semibold">Sources</h3>
                      <ul className="space-y-2">
                        {message.assessment.sources.map((source) => {
                          const url = safeSourceUrl(source.url);
                          return url ? <li key={source.id} className="text-xs">
                            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{source.title}<ExternalLink aria-label="opens in a new tab" className="h-3 w-3 shrink-0" /></a>
                            <p className="mt-0.5 text-muted-foreground">Reviewed {source.reviewedAt}</p>
                          </li> : null;
                        })}
                      </ul>
                    </div>
                  )}
                </article>
              </div>
            ))}
            {isLoading && <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Reviewing your question…</div>}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-border bg-background">
        <div className="mx-auto max-w-4xl px-4 py-3 sm:px-6">
          {error && <p role="alert" className="mb-3 text-sm text-destructive">{error} Your draft is still here.</p>}
          {answeringQuestion && <div className="mb-2 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
            <p className="min-w-0 flex-1"><span className="font-semibold">Answering: </span>{answeringQuestion}</p>
            <Button type="button" variant="ghost" size="icon" disabled={isLoading} onClick={() => setAnsweringQuestion(null)} aria-label="Stop answering this question"><X className="h-4 w-4" /></Button>
          </div>}
          {photo && <div className="mb-3 flex items-center gap-3 rounded-xl border border-border bg-card p-2">
            <Image src={photo.previewUrl} alt="Selected photo preview" width={64} height={64} unoptimized className="h-16 w-16 rounded-lg object-cover" />
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{photo.name}</p><p className="mt-1 text-xs text-muted-foreground" role="status">{isReadingPhoto ? "Preparing photo…" : "Photo ready to send"}</p></div>
            <Button type="button" variant="ghost" size="icon" disabled={isLoading} onClick={removePhoto} aria-label="Remove attached photo"><X className="h-4 w-4" /></Button>
          </div>}
          <form onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <label htmlFor={`${id}-message`} className="sr-only">Describe the purchase or answer a follow-up question</label>
            <Textarea id={`${id}-message`} ref={inputRef} value={inputValue} onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); }
              }} maxLength={Math.max(0, MAX_MESSAGE_LENGTH - answerPrefixLength)}
              placeholder={answeringQuestion ? "Add your answer…" : "What did you buy, and how do you use it for business?"}
              disabled={isLoading} rows={2} aria-describedby={`${id}-privacy ${id}-input-help`} className="min-h-20 resize-y" />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div>
                <input ref={fileInputRef} id={`${id}-photo`} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a receipt, screenshot, or photo" className="sr-only" tabIndex={-1} disabled={isLoading} onChange={handlePhotoSelect} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isLoading} aria-label={photo ? "Replace attached photo" : "Attach a photo"}><ImagePlus className="h-4 w-4" />{photo ? "Replace photo" : "Add photo"}</Button>
              </div>
              <Button type="submit" disabled={busy || (!inputValue.trim() && (!photo?.dataUrl || !!answeringQuestion))} aria-label="Send question">{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send</Button>
            </div>
            <p id={`${id}-privacy`} className="mt-3 text-xs text-muted-foreground">Your question and any attached photo go to OpenAI when you send. Crop out account numbers and unrelated personal details.</p>
            <p id={`${id}-input-help`} className="mt-1 text-xs text-muted-foreground">One JPEG, PNG, or WebP, up to 2 MB. Enter sends; Shift + Enter adds a line.</p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default TaxAssistantScreen;
