import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { useApp } from '../state/AppContext';
import { useGoBack } from '../hooks/useGoBack';
import { t } from '../i18n/translations';
import { ExportDropdown } from './ExportDropdown';
import { SignDialog } from '../components/SignDialog';
import '../styles/top-bar.css';

function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/** Barra superior do editor: voltar, nome editável, logo ao centro e Exportar. */
export function TopBar() {
  const { state, actions } = useApp();
  const goBack = useGoBack();
  const { base, ext } = splitName(state.doc.name);
  // The field holds just the base name — the extension sits beside it,
  // muted, and is kept as-is so renaming never drops it by accident.
  const [draft, setDraft] = useState(base);
  useEffect(() => setDraft(base), [base]);

  return (
    <div className="editor-bar grain">
      <div className="editor-bar-left">
        <button className="btn btn-secondary btn-icon editor-back" onClick={goBack} title={t('topbar.backHome')} aria-label={t('topbar.backHome')}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <label className="filename-field" title={t('topbar.renameTitle')}>
          <input
            className="filename-input"
            value={draft}
            size={Math.max(1, Math.min(draft.length, 40))}
            // Every export filename comes from this same name (see baseNameFor
            // in pdf/exporters.ts) — editing it here is the one place that
            // controls what the downloaded file is actually called.
            onChange={(e) => {
              setDraft(e.target.value);
              actions.renameDocument(e.target.value + ext);
            }}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              // An empty name would export as "documento" silently (baseNameFor's
              // fallback) — restoring a visible placeholder here instead keeps
              // that behavior from looking like the field just ate the text.
              if (!e.target.value.trim()) actions.renameDocument('documento' + ext);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            aria-label={t('topbar.renameAria')}
            spellCheck={false}
          />
          {ext && <span className="filename-ext">{ext}</span>}
          <Icon name="pencil" size={16} color="var(--graphite-muted)" className="filename-pencil" />
        </label>
      </div>

      <a
        href="/"
        className="editor-brand"
        onClick={(e) => {
          // A real <a href> so the middle mouse button (or Ctrl/Cmd-click) opens
          // Fluva's home in a new tab the normal browser way — none of those
          // reach onClick at all, so only a plain left click needs handling here.
          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          goBack();
        }}
        title={t('topbar.backHome')}
      >
        <Logo width={46} />
        <span className="wordmark">Fluva</span>
      </a>

      <div className="editor-export">
        <button
          className="btn btn-primary editor-export-btn"
          style={state.exportOpen ? { background: 'var(--ink-green-hover)' } : undefined}
          onClick={(e) => {
            e.stopPropagation();
            actions.toggleExport();
          }}
          aria-expanded={state.exportOpen}
          aria-haspopup="menu"
          disabled={!!state.busy}
        >
          {t('topbar.export')}
          <Icon name={state.exportOpen ? 'chevronUp' : 'chevronDown'} size={18} strokeWidth={2.4} className="editor-export-chevron" />
        </button>
        {state.exportOpen && <ExportDropdown />}
      </div>

      {state.signDialogOpen && <SignDialog />}
    </div>
  );
}
