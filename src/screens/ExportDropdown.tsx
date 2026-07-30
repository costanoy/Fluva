import { Check, FileText, Image as ImageIcon } from 'lucide-react';
import { useApp } from '../state/AppContext';
import type { ExportFormat } from '../pdf/exporters';

export function ExportDropdown() {
  const { state, actions } = useApp();
  const isPdf = state.doc.kind === 'pdf';
  const multiPage = state.doc.pages.length > 1;

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

      {multiPage && (
        <div className="export-zip-note text-muted">
          O documento tem {state.doc.pages.length} páginas, então a exportação em imagem gera um .zip com uma imagem por página.
        </div>
      )}

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
          <div className="export-zip-note text-muted">
            A conversão para Word recupera o texto e a ordem de leitura do PDF, mas não reproduz o layout original,
            colunas ou imagens.
          </div>
        </>
      )}
    </div>
  );
}
