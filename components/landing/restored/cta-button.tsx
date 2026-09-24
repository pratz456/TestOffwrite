"use client";

import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CtaButtonProps {
  className?: string;
  size?: "default" | "lg";
  label?: string;
  variant?: "default" | "outline";
}

export function CtaButton({ className, size = "default", label, variant = "default" }: CtaButtonProps) {
  const { user, loading } = useAuth();
  const text = user ? "Go to Dashboard" : (label ?? "Get Started Free");
  const classes = cn("min-h-11 rounded-lg font-semibold transition-all duration-200", size === "lg" && "h-12 px-8 text-base", variant === "default" && "bg-primary text-white shadow-md hover:shadow-lg hover:brightness-110", variant === "outline" && "border-primary text-primary hover:bg-primary/5", className);

  if (loading) {
    return <Button variant={variant} size={size} disabled className={classes} aria-label="Loading account">{label ?? "Get started"}</Button>;
  }

  return (
    <Button asChild variant={variant} size={size} className={classes}>
      <Link href={user ? "/protected" : "/welcome"}>{text}</Link>
    </Button>
  );
}

export function AuthButtons({ className, size = "default" }: { className?: string; size?: "default" | "lg" }) {
  return <div className={cn("flex items-center gap-2", className)}><CtaButton size={size} label="Login / Register" /></div>;
}
