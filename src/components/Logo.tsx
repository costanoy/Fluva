import logoIcon from '../assets/logo-icon.png';

const ASPECT_RATIO = 1359 / 1222;

export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return <img src={logoIcon} alt="" width={size * ASPECT_RATIO} height={size} className={className} />;
}
