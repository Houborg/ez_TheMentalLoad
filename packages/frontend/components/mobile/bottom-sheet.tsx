'use client';

import { useEffect, useRef, useState } from 'react';
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
  /** Enables drag-to-expand gesture and tap on handle to toggle full-screen */
  expandable?: boolean;
  /** Start the sheet in full-screen expanded state (requires expandable={true}) */
  defaultExpanded?: boolean;
};

export function BottomSheet({
  open,
  onClose,
  children,
  className,
  ariaLabelledby,
  expandable,
  defaultExpanded,
}: BottomSheetProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const touchStartY = useRef<number | null>(null);

  // Reset expanded state when sheet closes
  useEffect(() => {
    if (!open) setExpanded(defaultExpanded ?? false);
  }, [open, defaultExpanded]);

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

  function handleTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartY.current === null) return;
    const delta = touchStartY.current - (e.changedTouches[0]?.clientY ?? touchStartY.current);
    if (delta > 50) setExpanded(true);
    if (delta < -50) setExpanded(false);
    touchStartY.current = null;
  }

  const isExpanded = expandable && expanded;

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
          'absolute bottom-0 left-0 right-0 bg-card border-t border-border',
          isExpanded
            ? 'h-screen max-h-screen overflow-hidden rounded-t-none flex flex-col'
            : 'rounded-t-2xl max-h-[90vh] overflow-y-auto',
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledby}
      >
        {/* Drag handle */}
        {expandable ? (
          <button
            type="button"
            aria-label={isExpanded ? 'Skjul' : 'Udvid'}
            aria-expanded={isExpanded}
            onClick={() => setExpanded(e => !e)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="flex-shrink-0 w-full flex justify-center pt-3 pb-1 touch-none"
          >
            <span className="h-1 w-8 rounded-full bg-muted-foreground/30" />
          </button>
        ) : (
          <div aria-hidden="true" className="mx-auto mt-3 mb-1 h-1 w-8 rounded-full bg-muted-foreground/30" />
        )}

        {/* Content — when expanded, grows to fill remaining sheet height */}
        {isExpanded ? (
          <div className="flex-1 overflow-y-auto min-h-0">
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
