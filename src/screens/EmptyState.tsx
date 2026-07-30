import { useCallback, useState, type DragEvent } from 'react';
import { FileText, Image as ImageIcon, Upload, X } from 'lucide-react';
import { Button } from '../components/Button';
import { useApp } from '../state/AppContext';
import { formatBytes } from '../pdf/loader';
import '../styles/empty-state.css';

const CONVERT_TARGETS: Array<{ key: 'pdf' | 'png' | 'jpg'; label: string }> = [
  { key: 'pdf', label: 'PDF' },
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
];

export function EmptyState() {
  const { state, actions } = useApp();
  const [dragOver, setDragOver] = useState(false);
  const [converting, setConverting] = useState(false);
  const [target, setTarget] = useState<'pdf' | 'png' | 'jpg'>('pdf');

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) actions.addFiles(files);
    },
    [actions],
  );

  const hasQueue = state.queue.length > 0;

  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            className={`dropzone${dragOver ? ' dropzone-active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={actions.pickFiles}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void actions.pickFiles();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="dropzone-icon">
              <Upload size={20} strokeWidth={2.75} color="var(--color-accent)" />
            </div>
            <h4 style={{ textAlign: 'center' }}>Arraste seus arquivos aqui ou clique para selecionar</h4>
            <div className="dropzone-sub">PDF · PNG · JPG — até 50MB por arquivo</div>
          </div>

          {state.error && (
            <div className="inline-error">
              <span>{state.error}</span>
              <button className="icon-btn-plain" aria-label="Dispensar" onClick={actions.clearError}>
                <X size={14} strokeWidth={2.75} />
              </button>
            </div>
          )}

          {hasQueue && (
            <div className="pending-card">
              {state.queue.map((item) => (
                <div className="pending-row" key={item.id}>
                  {item.kind === 'pdf' ? (
                    <FileText size={16} strokeWidth={2.75} color="var(--color-neutral-600)" />
                  ) : (
                    <ImageIcon size={16} strokeWidth={2.75} color="var(--color-neutral-600)" />
                  )}
                  <span className="pending-row-name">{item.name}</span>
                  <span className="pending-row-size">{formatBytes(item.size)}</span>
                  <button className="icon-btn-plain" aria-label={`Remover ${item.name}`} onClick={() => actions.removeQueued(item.id)}>
                    <X size={16} strokeWidth={2.75} />
                  </button>
                </div>
              ))}

              <div className="pending-actions">
                {!converting ? (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Button variant="primary" style={{ flex: 1, justifyContent: 'center' }} onClick={actions.openQueue} disabled={!!state.busy}>
                      Editar
                    </Button>
                    <Button style={{ flex: 1, justifyContent: 'center' }} onClick={() => setConverting(true)} disabled={!!state.busy}>
                      Alterar formato
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="batch-format-box">
                      <div className="batch-format-label">Converter todos para</div>
                      <div className="batch-format-chips">
                        {CONVERT_TARGETS.map((t) => (
                          <button
                            key={t.key}
                            className="batch-format-chip"
                            style={{
                              background: t.key === target ? 'var(--color-accent)' : 'transparent',
                              color: t.key === target ? 'var(--color-bg)' : 'var(--color-text)',
                            }}
                            onClick={() => setTarget(t.key)}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Button style={{ flex: 1, justifyContent: 'center' }} onClick={() => setConverting(false)}>
                        Cancelar
                      </Button>
                      <Button
                        variant="primary"
                        style={{ flex: 1, justifyContent: 'center' }}
                        disabled={!!state.busy}
                        onClick={async () => {
                          await actions.convertQueue(target);
                          setConverting(false);
                        }}
                      >
                        Converter e baixar
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="empty-hint">
          <h6 style={{ marginBottom: 8, color: 'var(--color-neutral-600)' }}>Tudo acontece no seu dispositivo</h6>
          <p>
            Nenhum arquivo é enviado para servidores. A leitura, a edição e a exportação são feitas inteiramente no seu
            navegador — o documento nunca sai do seu computador.
          </p>
        </div>
      </div>
    </div>
  );
}
