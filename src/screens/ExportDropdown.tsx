import { Check, FileText, Image as ImageIcon } from 'lucide-react';
import { useApp } from '../state/AppContext';
import type { ExportFormat } from '../pdf/exporters';

export function ExportDropdown() {
  const { state, actions } = useApp();
  const isPdf = state.doc.kind === 'pdf';

  const Row = ({ format, icon, label }: { format: ExportFormat; icon: React.ReactNode; label: string }) => (
    <button className="export-row" onClick={() => actions.runExport(format)} disabled={!!state.busy}>
      {icon}
      <span className="export-row-label">{label}</span>
      {state.exportFormat === format && <Check size={15} strokeWidth={2.75} color="var(--color-accent)" />}
    </button>
  );

  return (
    <div className="export-menu" onClick={(e) => e.stopPropagation()}>
      {isPdf && (
        <Row format="pdf" icon={<FileText size={17} strokeWidth={2.75} color="var(--color-accent)" />} label="Exportar como PDF" />
      )}

      <h6 className="export-heading">{isPdf ? 'ou exportar como imagem' : 'Exportar como imagem'}</h6>
      <Row format="png" icon={<ImageIcon size={17} strokeWidth={2.75} />} label="Exportar como PNG" />
      <Row format="jpg" icon={<ImageIcon size={17} strokeWidth={2.75} />} label="Exportar como JPG" />

      {!isPdf && (
        <>
          <h6 className="export-heading">ou exportar como documento</h6>
          <Row format="pdf" icon={<FileText size={17} strokeWidth={2.75} />} label="Exportar como PDF" />
        </>
      )}

      {isPdf && (
        <>
          <h6 className="export-heading">ou converter para</h6>
          <Row format="docx" icon={<FileText size={17} strokeWidth={2.75} />} label="Word (.docx)" />
        </>
      )}
    </div>
  );
}
