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
  const { user } = useAuth();
  const href = user ? "/protected" : "/welcome";
  const text = label ?? (user ? "Go to Dashboard" : "Get Started Free");

  return (
    <Link href={href} className={cn("inline-flex", className)}>
      <Button variant={variant} size={size} className={cn(
        "font-semibold rounded-lg transition-all duration-200",
        size === "lg" && "px-8 py-3 text-base h-12",
        variant === "default" && "bg-primary text-white shadow-md hover:shadow-lg hover:brightness-110",
        variant === "outline" && "border-primary text-primary hover:bg-primary/5",
      )}>
        {text}
      </Button>
    </Link>
  );
}

export function AuthButtons({ className, size = "default" }: { className?: string; size?: "default" | "lg" }) {
  const { user } = useAuth();

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
