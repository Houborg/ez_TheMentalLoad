import { Suspense } from 'react';
import { VerifyEmailForm } from '@/components/verify-email-form';

export const metadata = { title: 'Bekræft e-mail — MentalLoad' };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
