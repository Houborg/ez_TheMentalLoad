'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AppSettings } from '@mental-load/contracts';
import { loadSettings, saveSettings } from '@/lib/api';
import { cn } from '@/lib/utils';

export function MobileSettingsContent() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings).catch(console.error);
  }, []);

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Indlæser indstillinger…
      </div>
    );
  }

  async function saveTheme(mode: AppSettings['theme']['mode']) {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await saveSettings({ theme: { ...settings.theme, mode } });
      setSettings(updated);
    } finally {
      setSaving(false);
    }
  }

  async function saveLanguage(lang: AppSettings['language']) {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await saveSettings({ language: lang });
      setSettings(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 flex flex-col gap-5">
      {saving && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Gemmer…
        </div>
      )}

      {/* Theme */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Tema</p>
        <div className="flex rounded-xl border border-border overflow-hidden">
          {(['system', 'light', 'dark'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => saveTheme(mode)}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium transition-colors',
                settings.theme.mode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground',
              )}
            >
              {mode === 'system' ? 'Auto' : mode === 'light' ? 'Lys' : 'Mørk'}
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Sprog</p>
        <div className="flex rounded-xl border border-border overflow-hidden">
          {(['da', 'en'] as const).map(lang => (
            <button
              key={lang}
              type="button"
              onClick={() => saveLanguage(lang)}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium transition-colors',
                settings.language === lang
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground',
              )}
            >
              {lang === 'da' ? 'Dansk' : 'English'}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center pt-2">
        Avancerede indstillinger (kalender, mail, helligdage m.m.) er tilgængelige i desktopvisningen.
      </p>
    </div>
  );
}
