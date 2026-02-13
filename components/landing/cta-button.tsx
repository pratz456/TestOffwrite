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
  const href = user ? "/protected" : "/welcome";
  const text = label ?? (user ? "Go to Dashboard" : "Get Started Free");

  return (
    <Link href={href} className={cn("inline-flex", className)}>
      <Button variant={variant} size={size} disabled={loading} className={cn(
        "font-semibold rounded-lg transition-all duration-200",
        size === "lg" && "px-8 py-3 text-base h-12",
        variant === "default" && "bg-primary text-white shadow-md hover:shadow-lg hover:brightness-110",
        variant === "outline" && "border-primary text-primary hover:bg-primary/5",
      )}>
        {loading ? <span className="flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Loading...</span> : text}
      </Button>
    </Link>
  );
}

export function AuthButtons({ className, size = "default" }: { className?: string; size?: "default" | "lg" }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Button size={size} disabled className="rounded-lg font-semibold">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </Button>
      </div>
    );
  }

  if (user) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Link href="/protected">
          <Button size={size} className={cn("rounded-lg font-semibold bg-primary text-white shadow-md hover:shadow-lg hover:brightness-110", size === "lg" && "px-8 py-3 text-base h-12")}>
            Go to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Link href="/welcome">
        <Button size={size} className={cn("rounded-lg font-semibold bg-primary text-white shadow-md hover:shadow-lg hover:brightness-110", size === "lg" && "px-8 py-3 text-base h-12")}>
          Login / Register
        </Button>
      </Link>
    </div>
  );
}
