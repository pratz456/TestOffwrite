"use client";

import { TaxFormsSetupScreen } from '@/components/tax-forms-setup-screen';
import { useAuth } from '@/lib/firebase/auth-context';
import { ToastContainer, useToasts } from '@/components/ui/toast';

export default function TaxFormsSetupPage() {
  const { user, loading: authLoading } = useAuth();
  const { toasts, removeToast } = useToasts();

  if (authLoading) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Authentication Required</h2>
          <p className="text-gray-600">Please sign in to access tax forms setup.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <TaxFormsSetupScreen />
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </>
  );
}
