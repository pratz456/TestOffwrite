"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageCircle } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { ContactSupportForm } from "@/components/contact-support-form";

export default function ContactSupportPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Image src="/writeofflogo.png" alt="WriteOff" width={32} height={32} className="rounded-md" />
              <h1 className="text-xl font-bold text-foreground">Contact Support</h1>
            </Link>
            <Link href="/">
              <Button variant="outline" size="sm" className="text-foreground border-foreground/40 hover:bg-foreground/10 hover:border-foreground/60">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8 text-center">
          <MessageCircle className="w-12 h-12 text-primary mx-auto mb-3" aria-hidden />
          <h2 className="text-2xl font-semibold text-foreground">Get in touch</h2>
          <p className="mt-2 text-foreground/90">
            Send us a message and we&apos;ll respond within 24 hours on business days.
          </p>
        </div>

        <ContactSupportForm />

        <div className="mt-8 text-center text-sm text-foreground/90">
          <p>
            Prefer email?{" "}
            <a href="mailto:writeoffapp@gmail.com" className="text-green-600 font-medium hover:text-green-500 hover:underline">
              writeoffapp@gmail.com
            </a>
          </p>
          <p className="mt-1">
            <Link href="/help" className="text-green-600 font-medium hover:text-green-500 hover:underline">
              Help &amp; FAQ
            </Link>
            {" · "}
            <Link href="/privacy" className="text-green-600 font-medium hover:text-green-500 hover:underline">
              Privacy Policy
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
