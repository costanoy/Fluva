import type { CSSProperties, ElementType, ReactNode } from 'react';

const SPEED_LINES = (
  <>
    <rect x="17" y="22.5" width="17.5" height="6.5" rx="3.25" />
    <rect x="1" y="37.8" width="33.5" height="6.7" rx="3.35" />
    <rect x="13.7" y="53" width="20.8" height="6.7" rx="3.35" />
  </>
);
const DOC_PATH = 'M44.3 .7H77L96.2 26V67a4 4 0 0 1-4 4H44.3a4 4 0 0 1-4-4V4.7a4 4 0 0 1 4-4z';
const LETTER_F = (
  <>
    <rect x="53.5" y="21.7" width="14.4" height="42" rx="3" />
    <rect x="53.5" y="21.7" width="28.2" height="11.3" rx="3" />
    <rect x="60" y="38.7" width="18.5" height="10.9" rx="3" />
  </>
);

/**
 * O símbolo do Fluva em vetor (proporção 104:78): camada rosa deslocada,
 * camada verde por cima, dobra do canto em sobreimpressão e o "F" em papel.
 * `mono` é a variante para fundo verde (rodapé): documento e linhas em grafite.
 */
export function Logo({
  width = 61,
  variant = 'default',
  className,
  style,
  title,
}: {
  width?: number;
  variant?: 'default' | 'mono';
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const height = Math.round((width * 78) / 104);
  const ink = variant === 'mono' ? 'var(--graphite)' : 'var(--ink-green)';
  return (
    <svg
      viewBox="0 0 104 78"
      width={width}
      height={height}
      className={className}
      style={{ flexShrink: 0, ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill="var(--ink-pink)">
        <g transform="translate(1.2 1.6)">{SPEED_LINES}</g>
        <path transform="translate(5.5 5.5)" d={DOC_PATH} />
      </g>
      <g fill={ink}>
        {SPEED_LINES}
        <path d={DOC_PATH} />
      </g>
      <path d="M77 .7V22a4 4 0 0 0 4 4H96.2Z" fill="var(--overprint)" />
      <g fill="var(--ink-pink)" transform="translate(2.4 2.4)">
        {LETTER_F}
      </g>
      <g fill="var(--paper)">{LETTER_F}</g>
    </svg>
  );
}

/**
 * Título com desalinhamento de registro: uma cópia em `shadowColor`, só
 * decorativa (`aria-hidden`), fica atrás deslocada por `offset`.
 */
export function RisoHeading({
  as: Tag = 'h2',
  children,
  shadowText,
  offset = [3, 2],
  shadowColor,
  className,
  style,
}: {
  as?: ElementType;
  children: ReactNode;
  /** Texto puro da cópia deslocada (os filhos podem ter cor/marcação própria). */
  shadowText: string;
  offset?: [number, number];
  shadowColor?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Tag className={`display riso${className ? ` ${className}` : ''}`} style={style}>
      <span
        aria-hidden="true"
        className="riso-shadow"
        style={{ transform: `translate(${offset[0]}px, ${offset[1]}px)`, color: shadowColor }}
      >
        {shadowText}
      </span>
      <span className="riso-ink">{children}</span>
    </Tag>
  );
}
