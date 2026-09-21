"use client";

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { UpdatePasswordForm } from "@/components/update-password-form";

function ResetLinkForm() {
  const params = useSearchParams();
  return <UpdatePasswordForm code={params.get('oobCode')} mode={params.get('mode')} />;
}

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={<p role="status">Loading reset link…</p>}><ResetLinkForm /></Suspense>
      </div>
    </div>
  );
}
