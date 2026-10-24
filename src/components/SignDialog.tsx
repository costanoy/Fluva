import { useEffect, useRef, useState } from 'react';
import { DialogClose, Modal } from './Dialog';
import { Icon } from './Icon';
import { useApp } from '../state/AppContext';
import type { SignOutcome } from '../state/appTypes';
import type { StampCorner } from '../pdf/sign';
import { formatBytes } from '../pdf/loader';
import { getLang, t, type TranslationKey } from '../i18n/translations';

type Done = Extract<SignOutcome, { ok: true }>;

const CORNERS: Array<{ key: StampCorner; label: TranslationKey }> = [
  { key: 'bottom-right', label: 'sign.cornerBottomRight' },
  { key: 'bottom-left', label: 'sign.cornerBottomLeft' },
  { key: 'top-right', label: 'sign.cornerTopRight' },
  { key: 'top-left', label: 'sign.cornerTopLeft' },
];

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
  // Where the signature shows: a stamp, on the last page's bottom right
  // unless chosen otherwise.
  const [stampOn, setStampOn] = useState(true);
  const [stampPage, setStampPage] = useState<'last' | 'first' | 'current'>('last');
  const [corner, setCorner] = useState<StampCorner>('bottom-right');
  /** The signatures the PDF already has, and whether they'll stay valid. */
  const [existing, setExisting] = useState<{ count: number; kept: boolean } | null>(null);
  const total = state.doc.pages.length;
  const active = state.activePageIndex;

  useEffect(() => {
    let alive = true;
    actions
      .inspectSignatures()
      .then((found) => alive && setExisting(found))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (status === 'signing') return;
    actions.setSignDialogOpen(false);
  };

  const canSign = !!pfxFile && !!password && status !== 'signing';

  const sign = async () => {
    if (!pfxFile || !password) return;
    setStatus('signing');
    setError(null);
    const page = stampPage === 'first' ? 0 : stampPage === 'current' ? active : total - 1;
    const outcome = await actions.signAndDownload(pfxFile, password, stampOn ? { page, corner } : null);
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
    setError(null);
    try {
      const { downloadBytes } = await import('../pdf/exporters');
      await downloadBytes(done.bytes, done.fileName, 'application/pdf');
      setDone({ ...done, saved: true });
    } catch (err) {
      if (!(err instanceof Error && err.name === 'SaveCancelled')) setError(err instanceof Error ? err.message : String(err));
    }
  };

  const errorAlert = error && (
    <div className="alert" role="alert">
      <span className="alert-mark" aria-hidden="true">
        !
      </span>
      <div className="alert-body">
        <div className="alert-text">{error}</div>
      </div>
    </div>
  );

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
            {done ? t(done.saved ? 'sign.doneDownload' : 'sign.doneNotSaved', { file: done.fileName }) : state.doc.name}
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
          {errorAlert}
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

        <div className="field">
          <label className="sign-check">
            <input type="checkbox" checked={stampOn} onChange={(e) => setStampOn(e.target.checked)} disabled={status === 'signing'} />
            {t('sign.stampLabel')}
          </label>
          {stampOn && (
            <div className="sign-stamp-options">
              {total > 1 && (
                <label className="sign-select">
                  <span>{t('sign.stampPage')}</span>
                  <select value={stampPage} onChange={(e) => setStampPage(e.target.value as typeof stampPage)} disabled={status === 'signing'}>
                    <option value="last">{t('sign.stampLast', { n: total })}</option>
                    <option value="first">{t('sign.stampFirst')}</option>
                    {active > 0 && active < total - 1 && <option value="current">{t('sign.stampCurrent', { n: active + 1 })}</option>}
                  </select>
                </label>
              )}
              <label className="sign-select">
                <span>{t('sign.stampCorner')}</span>
                <select value={corner} onChange={(e) => setCorner(e.target.value as StampCorner)} disabled={status === 'signing'}>
                  {CORNERS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {t(c.label)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {existing && existing.count > 0 && (
          <div className={existing.kept ? 'sign-existing' : 'sign-existing sign-existing-lost'} role="note">
            <Icon name={existing.kept ? 'check' : 'shield'} size={18} strokeWidth={2.4} />
            <span>{existing.kept ? t(existing.count === 1 ? 'sign.existingKeptOne' : 'sign.existingKeptMany', { count: existing.count }) : t('sign.existingLost')}</span>
          </div>
        )}

        {errorAlert}
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
