import { Suspense } from 'react';
import { DashboardApp } from '@/components/dashboard-app';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DashboardApp />
    </Suspense>
  );
}
