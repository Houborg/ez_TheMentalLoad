import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

export const metadata = {
  title: 'Sign In — MentalLoad',
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
