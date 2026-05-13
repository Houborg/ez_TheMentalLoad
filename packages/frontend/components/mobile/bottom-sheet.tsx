'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

// z-50: intentional. MobileShell ensures only one BottomSheet is mounted open at a time.
// Do not use outside the mobile shell guard (useMobile) to avoid z-index conflicts with desktop modals.

// Module-level ref counter — safe because BottomSheet only runs client-side ('use client')
let openCount = 0;

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  ariaLabelledby?: string;
};

export function BottomSheet({ open, onClose, children, className, ariaLabelledby }: BottomSheetProps) {
  // Prevent body scroll while open — ref-counted so multiple sheets don't fight each other
  useEffect(() => {
    if (open) {
      openCount++;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      if (open) {
        openCount--;
        if (openCount === 0) document.body.style.overflow = '';
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 rounded-t-2xl bg-card border-t border-border',
          'max-h-[90vh] overflow-y-auto',
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledby}
      >
        {/* Drag handle */}
        <div aria-hidden="true" className="mx-auto mt-3 mb-1 h-1 w-8 rounded-full bg-muted-foreground/30" />
        {children}
      </div>
    </div>
  );
}
