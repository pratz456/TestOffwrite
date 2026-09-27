import { redirect } from 'next/navigation';

export default function ProtectedAboutPage() {
  redirect('/about');
}
