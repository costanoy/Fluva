import { useState } from 'react';
import { Modal } from './Dialog';
import { Icon } from './Icon';
import { useApp } from '../state/AppContext';
import { t } from '../i18n/translations';

/**
 * Asked for when a PDF needs a password to open (see `setPasswordAsker` in
 * pdf/loader.ts). The password goes only to the PDF reader, here, and stays
 * in memory while the file is open — never stored or sent anywhere.
 */
export function PasswordDialog() {
  const { state, actions } = useApp();
  const request = state.passwordRequest;
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  if (!request) return null;
  const wrong = request.wrong && !password;

  const submit = () => {
    if (!password) return;
    actions.answerPassword(password);
    setPassword('');
  };
  const cancel = () => {
    actions.answerPassword(null);
    setPassword('');
  };

  return (
    <Modal onClose={cancel} labelledBy="password-title" className="password-dialog">
      <div className="dialog-main">
        <h2 id="password-title" className="display dialog-title">
          {t('password.title')}
        </h2>
        <p className="dialog-text">{t('password.body', { name: request.fileName })}</p>
        <div className="field">
          <label htmlFor="pdf-pass" className="field-label">
            {t('password.label')}
          </label>
          <div className={wrong ? 'password-box password-box-invalid' : 'password-box'}>
            <input
              id="pdf-pass"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              autoComplete="off"
              aria-invalid={wrong}
              aria-describedby={wrong ? 'pdf-pass-error' : 'pdf-pass-help'}
              data-autofocus
            />
            <button
              className="password-eye"
              aria-label={show ? t('sign.hidePassword') : t('sign.showPassword')}
              aria-pressed={show}
              onClick={() => setShow((v) => !v)}
            >
              <Icon name={show ? 'eyeOff' : 'eye'} size={20} />
            </button>
          </div>
          {wrong ? (
            <div id="pdf-pass-error" className="field-error" role="alert">
              <span className="field-error-mark" aria-hidden="true">
                !
              </span>
              {t('password.wrong')}
            </div>
          ) : (
            <div id="pdf-pass-help" className="field-help">
              {t('password.note')}
            </div>
          )}
        </div>
      </div>
      <div className="dialog-foot">
        <div className="dialog-foot-note">
          <Icon name="lock" size={16} strokeWidth={2.4} />
          {t('password.localNote')}
        </div>
        <div className="dialog-foot-actions">
          <button className="btn btn-secondary dialog-btn dialog-btn-cancel" onClick={cancel}>
            {t('password.cancel')}
          </button>
          <button className="btn btn-primary dialog-btn" onClick={submit} disabled={!password}>
            <Icon name="lock" size={18} strokeWidth={2.4} />
            {t('password.open')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
