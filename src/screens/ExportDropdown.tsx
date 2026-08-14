import { Check, FileText, Image as ImageIcon } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { t } from '../i18n/translations';
import type { ExportFormat } from '../pdf/exporters';

export function ExportDropdown() {
  const { state, actions } = useApp();
  const isPdf = state.doc.kind === 'pdf';

  const Row = ({
    format,
    icon,
    label,
    showCheck = true,
    badge,
  }: {
    format: ExportFormat;
    icon: React.ReactNode;
    label: string;
    showCheck?: boolean;
    badge?: string;
  }) => (
    <button className="export-row" onClick={() => actions.runExport(format)} disabled={!!state.busy}>
      {icon}
      <span className="export-row-label">{label}</span>
      {badge && <span className="export-badge">{badge}</span>}
      {showCheck && state.exportFormat === format && <Check size={15} strokeWidth={2.75} color="var(--color-accent)" />}
    </button>
  );

  return (
    <div className="export-menu" onClick={(e) => e.stopPropagation()}>
      {isPdf && (
        <Row format="pdf" icon={<FileText size={17} strokeWidth={2.75} color="var(--color-accent)" />} label={t('export.asPdf')} showCheck={false} />
      )}

      {!isPdf && <h6 className="export-heading">{t('export.asImageHeading')}</h6>}
      <Row format="png" icon={<ImageIcon size={17} strokeWidth={2.75} />} label={t('export.asPng')} />
      <Row format="jpg" icon={<ImageIcon size={17} strokeWidth={2.75} />} label={t('export.asJpg')} />

      {!isPdf && (
        <>
          <h6 className="export-heading">{t('export.orAsDocument')}</h6>
          <Row format="pdf" icon={<FileText size={17} strokeWidth={2.75} />} label={t('export.asPdf')} />
        </>
      )}

      {isPdf && (
        <>
          <h6 className="export-heading">{t('export.orConvertTo')}</h6>
          <Row format="docx" icon={<FileText size={17} strokeWidth={2.75} />} label={t('export.word')} badge={t('export.beta')} />
        </>
      )}
    </div>
  );
}
