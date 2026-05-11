import { Suspense } from 'react';
import { ForgotPasswordForm } from '@/components/forgot-password-form';

export const metadata = { title: 'Reset Password — MentalLoad' };

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
