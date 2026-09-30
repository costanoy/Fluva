// Global styles first, so each screen's own stylesheet (imported by its
// component) comes after them in the cascade and can override the base rules.
import './styles/tokens.css';
import './styles/base.css';
import './styles/fonts.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
