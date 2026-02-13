"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageCircle, Send, CheckCircle } from 'lucide-react';

interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
}

const supportCategories = [
  { value: 'general', label: 'General Question' },
  { value: 'technical', label: 'Technical Issue' },
  { value: 'billing', label: 'Billing & Pricing' },
  { value: 'feature', label: 'Feature Request' },
  { value: 'bug', label: 'Bug Report' },
  { value: 'other', label: 'Other' }
];

export function ContactSupportForm() {
  const [formData, setFormData] = useState<ContactFormData>({
    name: '',
    email: '',
    subject: '',
    category: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleInputChange = (field: keyof ContactFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSubmitError(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
        return;
      }

      setIsSubmitted(true);
      setFormData({
        name: "",
        email: "",
        subject: "",
        category: "",
        message: "",
      });
    } catch {
      setSubmitError("Failed to send. Please try again or email writeoffapp@gmail.com.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setIsSubmitted(false);
  };

  if (isSubmitted) {
    return (
      <Card className="bg-muted/30 border-border">
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <CheckCircle className="w-16 h-16 text-green-600 dark:text-green-500 mx-auto" />
            <h3 className="text-xl font-semibold text-foreground">Thank you!</h3>
            <p className="text-muted-foreground">
              Your support request has been submitted. We&apos;ll get back to you within 24 hours on business days.
            </p>
            <Button onClick={handleReset} variant="outline" className="border-border text-foreground hover:bg-muted">
              Submit another request
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          Contact Support
        </CardTitle>
      </CardHeader>
      <CardContent>
        {submitError && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {submitError}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name" required>Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="Your full name"
                className="placeholder:text-foreground/70"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" required>Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="you@example.com"
                className="placeholder:text-foreground/70"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="subject" required>Subject</Label>
              <Input
                id="subject"
                value={formData.subject}
                onChange={(e) => handleInputChange('subject', e.target.value)}
                placeholder="Brief description of your issue"
                className="placeholder:text-foreground/70"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category" required>Category</Label>
              <Select value={formData.category} onValueChange={(value) => handleInputChange('category', value)}>
                <SelectTrigger className="data-[placeholder]:text-foreground/70">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {supportCategories.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message" required>Message</Label>
            <Textarea
              id="message"
              value={formData.message}
              onChange={(e) => handleInputChange('message', e.target.value)}
              placeholder="Please describe your issue or question in detail..."
              className="placeholder:text-foreground/70"
              rows={5}
              required
            />
          </div>

          <div className="flex items-center justify-between pt-4">
            <p className="text-sm text-foreground/90">
              We typically respond within 24 hours during business days.
            </p>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Message
                </>
              )}
            </Button>
          </div>
        </form>

        <div className="mt-6 pt-6 border-t border-border">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div>
              <h4 className="font-medium text-foreground mb-1">Email Support</h4>
              <p className="text-sm text-foreground/90">
                <a href="mailto:writeoffapp@gmail.com" className="text-green-600 font-medium hover:text-green-500 hover:underline">
                  writeoffapp@gmail.com
                </a>
              </p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-1">Response Time</h4>
              <p className="text-sm text-foreground/90">Within 24 hours</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-1">Business Hours</h4>
              <p className="text-sm text-foreground/90">Mon-Fri, 9AM-6PM EST</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
