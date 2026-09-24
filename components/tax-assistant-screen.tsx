"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Bot, ChevronDown, ExternalLink, ImagePlus, Loader2, Send, X } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";
import { TaxAssistantAccountResult } from "@/components/tax-assistant-account-result";
import { accountResultSchema, type AccountResult } from "@/lib/tax-assistant/account-contract";
import { TaxYear2027Readiness } from "@/components/tax-year-2027-readiness";

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

/** Server-composed from the signed-in user's saved profile and their own transactions. */
interface ForYou {
  paragraph: string;
  action: { screen: "transactions"; merchantKey: string; count: number; label: string } | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  contextContent?: string;
  imageDataUrl?: string;
  assessment?: Assessment;
  forYou?: ForYou | null;
  account?: AccountResult;
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
  { label: "My next steps", question: "Which of my transactions need review?" },
  { label: "Missing receipts", question: "Which of my purchases have no receipts attached?" },
  { label: "My tax estimate", question: "What is my current estimated tax from my saved records?" },
  { label: "Laptop", question: "Can I write off a laptop I use for work and at home?" },
  { label: "What changed?", question: "How has my estimated tax changed since my last check?" },
  { label: "Accountant package", question: "Help me prepare a package for my accountant." },
];

const STATUS_LABELS: Record<Assessment["status"], string> = {
  needs_details: "Details needed",
  conditional: "Conditional guidance",
  not_supported: "Guidance limited",
};

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Only the transactions screen is a valid target; the merchant key is a plain search term. */
function forYouHref(action: ForYou["action"]): string | null {
  if (!action || action.screen !== "transactions" || typeof action.merchantKey !== "string" || !action.merchantKey.trim()) return null;
  return `/protected/transactions?merchant=${encodeURIComponent(action.merchantKey.trim().slice(0, 80))}`;
}

function normalizeForYou(value: unknown): ForYou | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { paragraph?: unknown; action?: unknown };
  if (typeof candidate.paragraph !== "string" || !candidate.paragraph.trim()) return null;
  const action = candidate.action && typeof candidate.action === "object" ? candidate.action as Record<string, unknown> : null;
  return {
    paragraph: candidate.paragraph,
    action: action && action.screen === "transactions" && typeof action.merchantKey === "string" && typeof action.label === "string"
      ? { screen: "transactions", merchantKey: action.merchantKey, count: typeof action.count === "number" ? action.count : 0, label: action.label }
      : null,
  };
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
      const response = await makeAuthenticatedRequest("/api/ai/account-assistant", {
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
      setMessages([...history, userMessage, { role: "assistant", content: data.reply, contextContent: contextContent.slice(0, 6000), assessment, account: accountResultSchema.safeParse(data.account).success ? data.account : undefined, forYou: normalizeForYou(data.forYou) }]);
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
        <div className="mx-auto max-w-4xl px-3 py-2 sm:px-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 md:h-11 md:w-11" onClick={onBack} aria-label="Go back"><ArrowLeft className="h-5 w-5" /></Button>
            <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-foreground">AI assistant</h1>
            <label htmlFor={`${id}-year`} className="sr-only">Tax year</label>
            <select id={`${id}-year`} value={taxYear} onChange={handleYearChange} disabled={isLoading}
              aria-describedby={`${id}-year-note`}
              className="min-h-11 shrink-0 rounded-xl border border-border bg-card px-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:text-sm">
              <option value={2026}>2026</option><option value={2027}>2027</option>
            </select>
          </div>
          <p id={`${id}-year-note`} className="mt-1 text-xs leading-snug text-muted-foreground" role="status">
            {taxYear === 2027 ? "2027 guidance · Some limits published; complete tax estimates pending." : "Guidance depends on your facts."}
            <span className="sr-only"> Changing years starts a new conversation.</span>
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-3 py-3 sm:px-6">
          {taxYear === 2027 && <TaxYear2027Readiness />}
          {messages.length === 0 && !isLoading && (
            <div className="py-3 sm:py-5">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Your taxes, with a next step</h2>
              <p className="mt-1 text-sm text-muted-foreground">Check your records, understand your estimate, or ask about a purchase.</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {STARTER_QUESTIONS.map(({ label, question }) => (
                  <button key={question} type="button" disabled={busy} title={question}
                    onClick={() => { setInputValue(question); setAnsweringQuestion(null); inputRef.current?.focus(); }}
                    className="min-h-11 rounded-xl border border-border bg-card px-2 py-2 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{label}</button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3" role="log" aria-label="Deduction conversation" aria-live="polite" aria-relevant="additions">
            {messages.map((message, index) => (
              <div key={index} className={`flex gap-2 sm:gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                {message.role === "assistant" && <div aria-hidden="true" className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 sm:flex"><Bot className="h-4 w-4 text-primary" /></div>}
                <article aria-label={message.role === "user" ? "Your question" : "Assistant guidance"}
                  className={`min-w-0 break-words rounded-2xl px-3 py-3 text-sm leading-relaxed sm:max-w-[85%] ${message.role === "user" ? "max-w-[90%] bg-primary text-primary-foreground" : "w-full border border-border bg-card text-foreground"}`}>
                  {message.imageDataUrl && <Image src={message.imageDataUrl} alt="Photo included with your question" width={200} height={140} unoptimized className="mb-3 max-h-40 rounded-lg object-contain" />}
                  {message.assessment && <p className="mb-2 text-xs font-semibold text-primary">{STATUS_LABELS[message.assessment.status]} · {message.assessment.taxYear}</p>}
                  {message.role === "user" ? <p className="whitespace-pre-wrap">{message.content}</p> : renderMarkdown(message.content)}
                  {message.account && <TaxAssistantAccountResult value={message.account} />}
                  {message.forYou && (() => {
                    const href = forYouHref(message.forYou.action);
                    return (
                      <section aria-label="For you" className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
                        <h3 className="text-xs font-semibold text-primary">For you</h3>
                        <p className="mt-1 text-sm leading-relaxed">{message.forYou.paragraph}</p>
                        {href && message.forYou.action && (
                          <Link href={href} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {message.forYou.action.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </Link>
                        )}
                      </section>
                    );
                  })()}
                  {message.assessment?.yearNotice && (
                    <details className="mt-2 rounded-lg bg-muted text-xs text-muted-foreground">
                      <summary className="cursor-pointer rounded-lg px-2 py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tax-year guidance limits</summary>
                      <p className="px-2 pb-2 leading-relaxed">{message.assessment.yearNotice}</p>
                    </details>
                  )}
                  {!!message.assessment?.questions?.length && (
                    <div className="mt-3 space-y-1.5">
                      <h3 className="text-xs font-semibold">Add a detail</h3>
                      {message.assessment.questions.map((question, questionIndex) => (
                        <button key={questionIndex} type="button" disabled={busy}
                          onClick={() => { setAnsweringQuestion(question); inputRef.current?.focus(); }} aria-label={`Answer: ${question}`}
                          className="block min-h-11 w-full rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{question}</button>
                      ))}
                    </div>
                  )}
                  {(!!message.assessment?.sources?.length || !!message.assessment?.photoObservations?.length) && (
                    <details className="group mt-2 border-t border-border">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
                        <span>{message.assessment?.photoObservations?.length ? 'Photo notes & sources' : 'Sources'}{message.assessment?.sources?.length ? ` (${message.assessment.sources.length})` : ''}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="space-y-3 pb-1">
                        {!!message.assessment?.photoObservations?.length && <div>
                          <h3 className="mb-1 text-xs font-semibold">What the photo appears to show · unverified</h3>
                          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{message.assessment.photoObservations.map((observation, observationIndex) => <li key={observationIndex}>{observation}</li>)}</ul>
                        </div>}
                        {!!message.assessment?.sources?.length && <ul className="space-y-1">
                          {message.assessment.sources.map((source) => {
                            const url = safeSourceUrl(source.url);
                            return url ? <li key={source.id} className="text-xs">
                              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{source.title}<ExternalLink aria-label="opens in a new tab" className="h-3 w-3 shrink-0" /></a>
                              <p className="text-muted-foreground">Reviewed {source.reviewedAt}</p>
                            </li> : null;
                          })}
                        </ul>}
                      </div>
                    </details>
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
        <div className="mx-auto max-w-4xl px-3 pt-2 pb-1 sm:px-6">
          {error && <p role="alert" className="mb-3 text-sm text-destructive">{error} Your draft is still here.</p>}
          {answeringQuestion && <div className="mb-2 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
            <p className="min-w-0 flex-1"><span className="font-semibold">Answering: </span>{answeringQuestion}</p>
            <Button type="button" variant="ghost" size="icon" disabled={isLoading} onClick={() => setAnsweringQuestion(null)} aria-label="Stop answering this question"><X className="h-4 w-4" /></Button>
          </div>}
          {photo && <div className="mb-2 flex items-center gap-3 rounded-xl border border-border bg-card p-2">
            <Image src={photo.previewUrl} alt="Selected photo preview" width={48} height={48} unoptimized className="h-12 w-12 rounded-lg object-cover" />
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{photo.name}</p><p className="mt-1 text-xs text-muted-foreground" role="status">{isReadingPhoto ? "Preparing photo…" : "Photo ready to send"}</p></div>
            <Button type="button" variant="ghost" size="icon" disabled={isLoading} onClick={removePhoto} aria-label="Remove attached photo"><X className="h-4 w-4" /></Button>
          </div>}
          <form onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <label htmlFor={`${id}-message`} className="sr-only">Describe the purchase or answer a follow-up question</label>
            <div className="flex items-end gap-1 rounded-2xl border border-border bg-card p-1.5 focus-within:ring-2 focus-within:ring-ring">
              <input ref={fileInputRef} id={`${id}-photo`} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a receipt, screenshot, or photo" className="sr-only" tabIndex={-1} disabled={isLoading} onChange={handlePhotoSelect} />
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 md:h-11 md:w-11" onClick={() => fileInputRef.current?.click()} disabled={isLoading} aria-label={photo ? "Replace attached photo" : "Attach a photo"}><ImagePlus className="h-4 w-4" /></Button>
              <Textarea id={`${id}-message`} ref={inputRef} value={inputValue} onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); }
                }} maxLength={Math.max(0, MAX_MESSAGE_LENGTH - answerPrefixLength)}
                placeholder={answeringQuestion ? "Add your answer…" : "Ask about your records or taxes…"}
                disabled={isLoading} rows={2} aria-describedby={`${id}-privacy ${id}-input-help`} className="min-h-11 max-h-40 min-w-0 resize-y border-0 bg-transparent px-1 py-2 text-base focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm" />
              <Button type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-xl md:h-11 md:w-11" disabled={busy || (!inputValue.trim() && (!photo?.dataUrl || !!answeringQuestion))} aria-label="Send question">{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
            </div>
            <details className="group">
              <summary id={`${id}-privacy`} className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
                <span>Questions & photos go to OpenAI · Photo tips</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="space-y-1 pb-2 text-xs leading-relaxed text-muted-foreground">
                <p>Sent only when you send your question. Crop out account numbers and unrelated personal details.</p>
                <p id={`${id}-input-help`}>One JPEG, PNG, or WebP, up to 2 MB. Enter sends; Shift + Enter adds a line.</p>
                <p>Changing tax years starts a new conversation.</p>
              </div>
            </details>
          </form>
        </div>
      </div>
    </div>
  );
}

export default TaxAssistantScreen;
