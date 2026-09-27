import { redirect } from 'next/navigation';

export default function ScheduleCPage() {
  redirect('/protected?screen=schedule-c-export');
}
