"use client";

import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send,
  Bot,
  User,
  Sparkles,
  MessageCircle,
  Loader2,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface TaxAssistantScreenProps {
  user: { id: string; email?: string };
  userProfile?: any;
  onBack: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

function getPersonalizedSuggestions(profile: any): string[] {
  const suggestions: string[] = [];
  suggestions.push("How much do I owe in taxes this year?");
  suggestions.push("What deductions am I missing?");
  if (profile?.profession) {
    const prof = Array.isArray(profile.profession) ? profile.profession[0] : profile.profession;
    if (prof) suggestions.push(`What can I write off as a ${prof}?`);
  }
  suggestions.push("Review my quarterly payment plan");
  if (!profile?.home_office_sqft) suggestions.push("Should I claim a home office deduction?");
  if (!profile?.sep_ira_contribution && !profile?.solo_401k_contribution) suggestions.push("How can I reduce my taxes with retirement contributions?");
  return suggestions.slice(0, 5);
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={key++} className="my-2 ml-4 list-disc space-y-1">
          {listItems}
        </ul>
      );
      listItems = [];
    }
  };

  for (const line of lines) {
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const content = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
      listItems.push(
        <li key={key++}>
          {parseInlineMarkdown(content)}
        </li>
      );
    } else {
      flushList();
      if (line.trim()) {
        blocks.push(
          <p key={key++} className="mb-2 last:mb-0">
            {parseInlineMarkdown(line)}
          </p>
        );
      }
    }
  }
  flushList();

  return blocks.length > 0 ? <>{blocks}</> : text;
}

function parseInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*|__(.+?)__/);
    if (boldMatch) {
      const before = remaining.slice(0, boldMatch.index);
      const boldText = boldMatch[1] ?? boldMatch[2] ?? "";
      if (before) parts.push(<span key={key++}>{before}</span>);
      parts.push(
        <strong key={key++} className="font-semibold">
          {boldText}
        </strong>
      );
      remaining = remaining.slice((boldMatch.index ?? 0) + boldMatch[0].length);
    } else {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export function TaxAssistantScreen({
  user,
  userProfile,
  onBack,
}: TaxAssistantScreenProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxSummary, setTaxSummary] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await makeAuthenticatedRequest(`/api/tax/compute-1040?year=${new Date().getFullYear()}`);
        if (res.ok) {
          const data = await res.json();
          setTaxSummary(data);
        }
      } catch {}
    };
    fetchSummary();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setInputValue("");
    setError(null);

    const userMessage: Message = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await makeAuthenticatedRequest("/api/ai/tax-assistant", {
        method: "POST",
        body: JSON.stringify({
          message: trimmed,
          conversationHistory: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed: ${response.statusText}`);
      }

      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get response");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I couldn't process your request. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const handleSuggestionClick = (question: string) => {
    sendMessage(question);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto max-w-4xl px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground sm:text-xl">
                  Tax Assistant
                </h1>
                <p className="text-xs text-muted-foreground">
                  AI-powered tax guidance
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          {messages.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              {/* Financial summary header */}
              {taxSummary && (
                <div className="mb-6 flex gap-4 rounded-xl border border-border bg-card p-4 w-full max-w-md">
                  <div className="flex-1 text-center">
                    <p className="text-xs text-muted-foreground">Est. Tax</p>
                    <p className="text-lg font-bold text-foreground">${Math.round(taxSummary.totalTax || 0).toLocaleString()}</p>
                  </div>
                  <div className="flex-1 text-center border-x border-border">
                    <p className="text-xs text-muted-foreground">Eff. Rate</p>
                    <p className="text-lg font-bold text-foreground">{((taxSummary.effectiveRate || 0) * 100).toFixed(1)}%</p>
                  </div>
                  <div className="flex-1 text-center">
                    <p className="text-xs text-muted-foreground">AGI</p>
                    <p className="text-lg font-bold text-foreground">${Math.round(taxSummary.agi || 0).toLocaleString()}</p>
                  </div>
                </div>
              )}
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <MessageCircle className="h-7 w-7 text-primary" />
              </div>
              <h2 className="mb-2 text-lg font-medium text-foreground">
                Ask your tax questions
              </h2>
              <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
                Get personalized guidance on deductions, quarterly taxes, and more
                based on your profile and expenses.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {getPersonalizedSuggestions(userProfile).map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSuggestionClick(q)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-3 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-foreground border border-border"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                        {renderMarkdown(msg.content)}
                      </div>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Thinking...
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="sticky bottom-0 border-t border-border bg-background">
        <div className="mx-auto max-w-4xl px-4 py-3 sm:px-6">
          {error && (
            <p className="mb-2 text-sm text-destructive">{error}</p>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask a tax question..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button type="submit" disabled={isLoading || !inputValue.trim()}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default TaxAssistantScreen;
