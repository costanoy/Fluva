import { useRef, useState } from 'react';
import { DialogClose, Modal } from './Dialog';
import { Icon } from './Icon';
import { useApp } from '../state/AppContext';
import type { SignOutcome } from '../state/appTypes';
import { formatBytes } from '../pdf/loader';
import { getLang, t } from '../i18n/translations';

type Done = Extract<SignOutcome, { ok: true }>;

function formatDate(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(getLang() === 'pt' ? 'pt-BR' : 'en-US', opts).format(d);
}

/**
 * Certificate + password → signed PDF. The file and password only ever live
 * in this component's own state and `signAndDownload`'s call stack — never
 * written to the store, `localStorage`, or sent anywhere.
 */
export function SignDialog() {
  const { state, actions } = useApp();
  const [pfxFile, setPfxFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<'idle' | 'signing' | 'wrong-password'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const close = () => {
    if (status === 'signing') return;
    actions.setSignDialogOpen(false);
  };

  const canSign = !!pfxFile && !!password && status !== 'signing';

  const sign = async () => {
    if (!pfxFile || !password) return;
    setStatus('signing');
    setError(null);
    const outcome = await actions.signAndDownload(pfxFile, password);
    if (outcome.ok) {
      setStatus('idle');
      setPassword('');
      setDone(outcome);
      return;
    }
    if (outcome.wrongPassword) {
      setStatus('wrong-password');
      // Mantém o certificado escolhido e deixa a senha selecionada para redigitar.
      requestAnimationFrame(() => passwordRef.current?.select());
      return;
    }
    setStatus('idle');
    setError(outcome.message);
  };

  const downloadAgain = async () => {
    if (!done) return;
    const { downloadBytes } = await import('../pdf/exporters');
    downloadBytes(done.bytes, done.fileName, 'application/pdf');
  };

  const header = (
    <div className="sign-head">
      <div className="sign-head-left">
        {done ? (
          <div className="sign-done-mark">
            <Icon name="check" size={30} strokeWidth={2.8} />
          </div>
        ) : (
          <div className="sign-shield">
            <Icon name="shield" size={26} />
          </div>
        )}
        <div className="sign-head-text">
          <h2 id="sign-title" className="display dialog-title">
            {done ? t('sign.doneTitle') : t('sign.title')}
          </h2>
          <div className={done ? 'sign-head-sub sign-head-sub-done' : 'sign-head-sub'}>
            {done ? t('sign.doneDownload', { file: done.fileName }) : state.doc.name}
          </div>
        </div>
      </div>
      {!done && <DialogClose onClose={close} />}
    </div>
  );

  if (done) {
    const { signer, signedAt } = done;
    const certParts = [signer.icpBrasil ? 'ICP-Brasil' : null, signer.validUntil ? t('sign.validUntil', { date: formatDate(signer.validUntil, { month: '2-digit', year: 'numeric' }) }) : null].filter(Boolean);
    const rows: Array<[string, string]> = [];
    if (signer.name) rows.push([t('sign.signedBy'), signer.name]);
    if (signer.cpfMasked) rows.push([t('sign.cpf'), signer.cpfMasked]);
    if (certParts.length) rows.push([t('sign.certificate'), certParts.join(' · ')]);
    rows.push([
      t('sign.dateTime'),
      t('sign.at', {
        date: formatDate(signedAt, { day: '2-digit', month: '2-digit', year: 'numeric' }),
        time: formatDate(signedAt, { hour: '2-digit', minute: '2-digit' }),
      }),
    ]);
    rows.push([t('sign.standard'), 'PAdES']);

    return (
      <Modal onClose={close} labelledBy="sign-title" className="sign-dialog">
        <div className="sign-stripe" />
        <div className="dialog-main sign-main">
          {header}
          <div className="sign-table">
            {rows.map(([k, v]) => (
              <div className="sign-table-row" key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <div className="sign-validator">{t('sign.validatorNote')}</div>
        </div>
        <div className="dialog-foot">
          <button className="link-btn" onClick={downloadAgain}>
            {t('sign.downloadAgain')}
          </button>
          <button className="btn btn-primary dialog-btn" onClick={close} data-autofocus>
            {t('sign.finish')}
          </button>
        </div>
      </Modal>
    );
  }

  const wrong = status === 'wrong-password';

  return (
    <Modal onClose={close} labelledBy="sign-title" className="sign-dialog">
      <div className="sign-stripe" />
      <div className="dialog-main sign-main">
        {header}
        <p className="dialog-text">{t('sign.intro')}</p>

        <div className="field">
          <div className="field-label">{t('sign.certificateLabel')}</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pfx,.p12"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setPfxFile(f);
                if (status === 'wrong-password') setStatus('idle');
              }
              e.target.value = '';
            }}
          />
          {pfxFile ? (
            <div className="cert-card">
              <div className="cert-tag">{/\.p12$/i.test(pfxFile.name) ? 'P12' : 'PFX'}</div>
              <div className="cert-text">
                <span className="cert-name">{pfxFile.name}</span>
                <span className="cert-meta">{t('sign.certMeta', { size: formatBytes(pfxFile.size) })}</span>
              </div>
              <button className="btn btn-secondary cert-swap" onClick={() => fileInputRef.current?.click()} disabled={status === 'signing'}>
                {t('sign.swapFile')}
              </button>
            </div>
          ) : (
            <button className="cert-empty" onClick={() => fileInputRef.current?.click()} data-autofocus>
              <Icon name="upload" size={20} />
              {t('sign.chooseFile')}
            </button>
          )}
        </div>

        <div className="field">
          <label htmlFor="sign-pass" className="field-label">
            {t('sign.passwordLabel')}
          </label>
          <div className={wrong ? 'password-box password-box-invalid' : 'password-box'}>
            <input
              ref={passwordRef}
              id="sign-pass"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (wrong) setStatus('idle');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSign) void sign();
              }}
              autoComplete="off"
              aria-invalid={wrong}
              aria-describedby={wrong ? 'sign-pass-error' : 'sign-pass-help'}
              disabled={status === 'signing'}
            />
            <button
              className="password-eye"
              aria-label={showPassword ? t('sign.hidePassword') : t('sign.showPassword')}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              <Icon name={showPassword ? 'eyeOff' : 'eye'} size={20} />
            </button>
          </div>
          {wrong ? (
            <div id="sign-pass-error" className="field-error" role="alert">
              <span className="field-error-mark" aria-hidden="true">
                !
              </span>
              {t('sign.wrongPassword')}
            </div>
          ) : (
            <div id="sign-pass-help" className="field-help">
              {t('sign.passwordNote')}
            </div>
          )}
        </div>

        {error && (
          <div className="alert" role="alert">
            <span className="alert-mark" aria-hidden="true">
              !
            </span>
            <div className="alert-body">
              <div className="alert-text">{error}</div>
            </div>
          </div>
        )}
      </div>

      <div className="dialog-foot">
        <div className="dialog-foot-note">
          <Icon name="lock" size={16} strokeWidth={2.4} />
          {t('sign.localNote')}
        </div>
        <div className="dialog-foot-actions">
          <button className="btn btn-secondary dialog-btn dialog-btn-cancel" onClick={close} disabled={status === 'signing'}>
            {t('sign.cancel')}
          </button>
          <button className="btn btn-primary dialog-btn" onClick={sign} disabled={!canSign}>
            {status === 'signing' ? <span className="busy-spinner" /> : <Icon name="download" size={18} strokeWidth={2.4} />}
            {status === 'signing' ? t('sign.signing') : t('sign.signButton')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
