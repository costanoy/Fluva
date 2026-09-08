import { useEffect, useRef, useState } from 'react';
import { PenLine } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { useApp } from '../state/AppContext';
import { t } from '../i18n/translations';

/**
 * Certificate + password → signed PDF. The file and password only ever live
 * in this component's own state and `signAndDownload`'s call stack — never
 * written to the store, `localStorage`, or sent anywhere.
 *
 * Closes itself once `state.busy` finishes (success or failure) rather than
 * on a result it tracks itself, so whichever toast or error banner the
 * store's own `signAndDownload` action already produces (the same mechanism
 * every other action here uses) isn't left hidden behind the dialog's own
 * backdrop — see `dialog.css`'s z-index vs `Toast.tsx`'s.
 */
export function SignDialog() {
  const { state, actions } = useApp();
  const [pfxFile, setPfxFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasBusyRef = useRef(false);

  useEffect(() => {
    if (state.busy) {
      wasBusyRef.current = true;
    } else if (wasBusyRef.current) {
      wasBusyRef.current = false;
      actions.setSignDialogOpen(false);
    }
  }, [state.busy, actions]);

  const close = () => actions.setSignDialogOpen(false);

  return (
    <Dialog title={t('sign.title')} onClose={close}>
      <p className="panel-note" style={{ margin: '0 0 16px' }}>
        {t('sign.legalNote')}
      </p>

      <div className="panel-label">{t('sign.certificateLabel')}</div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pfx,.p12"
        style={{ display: 'none' }}
        onChange={(e) => setPfxFile(e.target.files?.[0] ?? null)}
      />
      <Button block style={{ justifyContent: 'flex-start', marginBottom: 14 }} onClick={() => fileInputRef.current?.click()}>
        <PenLine size={15} strokeWidth={2.75} />
        {pfxFile ? pfxFile.name : t('sign.chooseFile')}
      </Button>

      <div className="panel-label">{t('sign.passwordLabel')}</div>
      <input
        type="password"
        className="text-input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="off"
      />
      <div className="panel-note panel-note-quiet" style={{ marginTop: 6, marginBottom: 16 }}>
        {t('sign.passwordNote')}
      </div>

      <Button
        variant="primary"
        block
        style={{ justifyContent: 'center' }}
        disabled={!!state.busy}
        onClick={() => pfxFile && actions.signAndDownload(pfxFile, password)}
      >
        {state.busy ? t('sign.signing') : t('sign.signButton')}
      </Button>
    </Dialog>
  );
}
