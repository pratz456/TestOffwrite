
import { redirect } from 'next/navigation';

export default function PlaidPage() {
  redirect('/protected?screen=banks-detail');
}
