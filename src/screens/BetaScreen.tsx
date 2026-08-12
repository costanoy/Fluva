import { Mail } from 'lucide-react';
import { Button } from '../components/Button';
import { Footer } from '../components/Footer';
import { useApp } from '../state/AppContext';
import '../styles/empty-state.css';

export function BetaScreen() {
  const { actions } = useApp();

  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <div className="empty-state-content">
          <div className="pending-card" style={{ padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="dropzone-icon">
              <Mail size={20} strokeWidth={2.75} color="var(--color-accent)" />
            </div>
            <h4>Teste o nosso app</h4>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--color-neutral-700)', margin: 0 }}>
              Estamos abrindo uma versão de teste do Fluva e adoraríamos ter você participando. Envie um e-mail para{' '}
              <strong>vinicostamaga@outlook.com</strong> manifestando interesse e te avisamos assim que houver uma vaga
              disponível.
            </p>
            <Button variant="primary" style={{ alignSelf: 'flex-start' }} onClick={() => actions.setScreen('empty')}>
              Voltar
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}
