'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

export function BottomSheet({ open, onClose, children, className }: BottomSheetProps) {
  // Prevent body scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

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
      >
        {/* Drag handle */}
        <div className="mx-auto mt-3 mb-1 h-1 w-8 rounded-full bg-muted-foreground/30" />
        {children}
      </div>
    </div>
  );
}
