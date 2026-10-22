import React from "react";
import { PUBLIC_LOGIN_HREF, PUBLIC_LOGIN_LINK_LABEL } from "@/lib/public-auth-links";

export function LoginAnchor({ className }: { className?: string }) {
  return (
    <a href={PUBLIC_LOGIN_HREF} className={className ?? "inline-flex min-h-11 items-center px-2 text-sm font-medium text-primary"}>
      {PUBLIC_LOGIN_LINK_LABEL}
    </a>
  );
}
