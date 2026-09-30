import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useApp } from '../state/AppContext';
import { t } from '../i18n/translations';
import type { ExportFormat } from '../pdf/exporters';
import '../styles/menu.css';

/** Closes a floating menu on Esc or on a press anywhere outside it (the
 * button that opened it included — that one toggles on its own). */
function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && e.target instanceof Node && !anchor.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return ref;
}

function MenuRow({
  tag,
  tagClass,
  label,
  desc,
  badge,
  highlighted,
  disabled,
  onClick,
}: {
  tag: ReactNode;
  tagClass: string;
  label: string;
  desc: string;
  badge?: string;
  highlighted?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`menu-row${highlighted ? ' menu-row-active' : ''}`} role="menuitem" onClick={onClick} disabled={disabled}>
      <span className={`format-tag ${tagClass}`}>{tag}</span>
      <span className="menu-row-text">
        <span className="menu-row-label">
          {label}
          {badge && <span className="menu-badge">{badge}</span>}
        </span>
        <span className="menu-row-desc">{desc}</span>
      </span>
    </button>
  );
}

/** "Baixar como" — the editor's Exportar menu. */
export function ExportDropdown() {
  const { state, actions } = useApp();
  const ref = useDismiss(actions.closeExport);
  const isPdf = state.doc.kind === 'pdf';
  const busy = !!state.busy;
  const run = (format: ExportFormat) => actions.runExport(format);

  const pdfRow = (
    <MenuRow
      tag="PDF"
      tagClass="format-tag-green"
      label={t('export.pdf')}
      desc={isPdf ? t('export.pdfDesc') : t('export.pdfFromImagesDesc')}
      highlighted={state.exportFormat === 'pdf'}
      disabled={busy}
      onClick={() => run('pdf')}
    />
  );

  return (
    <div className="popover export-menu" role="menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="menu-heading">{t('export.heading')}</div>
      {isPdf && pdfRow}
      <MenuRow tag="PNG" tagClass="format-tag-pink" label={t('export.png')} desc={t('export.pngDesc')} highlighted={state.exportFormat === 'png'} disabled={busy} onClick={() => run('png')} />
      <MenuRow tag="JPG" tagClass="format-tag-pink" label={t('export.jpg')} desc={t('export.jpgDesc')} highlighted={state.exportFormat === 'jpg'} disabled={busy} onClick={() => run('jpg')} />
      {!isPdf && pdfRow}
      {isPdf && (
        <MenuRow
          tag="DOCX"
          tagClass="format-tag-docx"
          label={t('export.wordLabel')}
          desc={t('export.wordDesc')}
          badge={t('export.beta')}
          highlighted={state.exportFormat === 'docx'}
          disabled={busy}
          onClick={() => run('docx')}
        />
      )}
      {isPdf && (
        <>
          <div className="menu-divider" />
          <MenuRow
            tag={<Icon name="signature" size={18} color="var(--paper)" />}
            tagClass="format-tag-ink"
            label={t('export.signLabel')}
            desc={t('export.signDesc')}
            disabled={busy}
            onClick={() => actions.setSignDialogOpen(true)}
          />
        </>
      )}
    </div>
  );
}

/** The reader's "Alterar formato" — the same menu minus the signed PDF, for
 * the conversions the reader itself can run. */
export function FormatMenu({ onClose, onPick }: { onClose: () => void; onPick: (format: 'pdf' | 'png' | 'jpg') => void }) {
  const ref = useDismiss(onClose);
  return (
    <div className="popover export-menu" role="menu" ref={ref}>
      <div className="menu-heading">{t('export.heading')}</div>
      <MenuRow tag="PDF" tagClass="format-tag-green" label={t('export.pdf')} desc={t('export.pdfFromImagesDesc')} onClick={() => onPick('pdf')} />
      <MenuRow tag="PNG" tagClass="format-tag-pink" label={t('export.png')} desc={t('export.pngDesc')} onClick={() => onPick('png')} />
      <MenuRow tag="JPG" tagClass="format-tag-pink" label={t('export.jpg')} desc={t('export.jpgDesc')} onClick={() => onPick('jpg')} />
    </div>
  );
}
