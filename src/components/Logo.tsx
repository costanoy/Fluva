export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="220 55 125 150" fill="none">
      <rect x="271" y="150" width="8" height="45" rx="2" fill="var(--color-accent-700)" />
      <rect x="245" y="130" width="90" height="34" rx="3" fill="var(--color-accent-100)" stroke="var(--color-accent-400)" strokeWidth="1.5" />
      <rect x="252" y="100" width="76" height="34" rx="3" fill="var(--color-accent-300)" stroke="var(--color-accent)" strokeWidth="1.5" />
      <rect x="259" y="70" width="62" height="34" rx="3" fill="var(--color-accent)" />
    </svg>
  );
}
