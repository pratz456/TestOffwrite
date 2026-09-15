"use client";

import { useAuth } from "@/lib/firebase/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function LogoutButton({ className = "", icon = false, ...props }) {
  const { signOut } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const logout = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await signOut();
      router.push('/auth/login');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign-out could not be completed. Please retry.');
    } finally { inFlight.current = false; setPending(false); }
  };

  return (
    <Button onClick={logout} className={className} {...props} disabled={pending}>
      {icon && <LogOut className="w-4 h-4" />}
      {icon && <span className="ml-1">Sign Out</span>}
      {!icon && <LogOut className="w-4 h-4" />}
    </Button>
  );
}
