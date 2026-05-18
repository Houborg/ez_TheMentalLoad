import { redirect } from 'next/navigation';

export default function PlannerRedirect() {
  redirect('/?section=planner');
}
