export function Footer() {
  return (
    <footer className="site-footer">
      <span className="site-footer-brand">Fluva</span>
      <span className="site-footer-dot">·</span>
      <span>Editor de PDF e imagens</span>
      <span className="site-footer-dot">·</span>
      <span>© {new Date().getFullYear()}</span>
      <span className="site-footer-dot">·</span>
      <span>Cyberhat</span>
    </footer>
  );
}
