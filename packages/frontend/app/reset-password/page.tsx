import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/reset-password-form';

export const metadata = { title: 'New Password — MentalLoad' };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
