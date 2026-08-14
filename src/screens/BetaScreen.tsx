import { Combine, Droplet, FlaskConical, Minimize2, MoveDiagonal, Scissors, Type, Upload } from 'lucide-react';
import { Button } from '../components/Button';
import { Footer } from '../components/Footer';
import { useApp } from '../state/AppContext';
import '../styles/empty-state.css';

const FEATURES: Array<{ icon: React.ReactNode; label: string }> = [
  { icon: <Type size={17} strokeWidth={2.5} />, label: 'Editar texto e imagens direto na página' },
  { icon: <Combine size={17} strokeWidth={2.5} />, label: "Juntar vários arquivos em um só" },
  { icon: <Scissors size={17} strokeWidth={2.5} />, label: 'Dividir por intervalo ou por página' },
  { icon: <MoveDiagonal size={17} strokeWidth={2.5} />, label: 'Reorganizar páginas arrastando' },
  { icon: <Droplet size={17} strokeWidth={2.5} />, label: "Marca d'água em texto ou imagem" },
  { icon: <Minimize2 size={17} strokeWidth={2.5} />, label: 'Comprimir sem perder qualidade' },
  { icon: <Upload size={17} strokeWidth={2.5} />, label: 'Exportar em PDF, PNG, JPG ou Word' },
];

/**
 * This used to be a waitlist ("mande um e-mail e avisamos quando abrir uma
 * vaga") for an early build. Fluva has since grown into the same complete
 * editor as the home screen, so this is now a feature showcase with a direct
 * way in — no gate, no signup.
 */
export function BetaScreen() {
  const { actions } = useApp();

  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <div className="empty-state-content">
          <div className="pending-card" style={{ padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="dropzone-icon">
              <FlaskConical size={20} strokeWidth={2.75} color="var(--color-accent)" />
            </div>
            <h4>O Fluva já está completo</h4>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--color-neutral-700)', margin: 0 }}>
              Nada de lista de espera: todas as ferramentas abaixo já estão prontas e funcionando, direto no navegador,
              sem precisar instalar nada.
            </p>

            <div className="feature-grid">
              {FEATURES.map((f) => (
                <div className="feature-item" key={f.label}>
                  <span className="feature-item-icon">{f.icon}</span>
                  {f.label}
                </div>
              ))}
            </div>

            <Button variant="primary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => actions.setScreen('empty')}>
              Começar agora
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}
