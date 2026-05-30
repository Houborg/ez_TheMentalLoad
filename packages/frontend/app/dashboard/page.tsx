import { redirect } from 'next/navigation';

// /dashboard is an alias for the root dashboard
export default function DashboardRedirect() {
  redirect('/');
}
