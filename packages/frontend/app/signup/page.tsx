import { Suspense } from 'react';
import { SignupForm } from '@/components/signup-form';

export const metadata = { title: 'Sign Up — MentalLoad' };

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
