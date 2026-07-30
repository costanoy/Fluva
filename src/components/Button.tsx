import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  icon?: boolean;
  block?: boolean;
  active?: boolean;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', icon, block, active, className, style, children, ...rest }: ButtonProps) {
  const classes = ['btn', variant === 'primary' ? 'btn-primary' : 'btn-secondary'];
  if (icon) classes.push('btn-icon');
  if (block) classes.push('btn-block');
  if (className) classes.push(className);

  const mergedStyle: CSSProperties = {
    ...(active ? { background: 'var(--color-accent-100)' } : null),
    ...style,
  };

  return (
    <button className={classes.join(' ')} style={mergedStyle} {...rest}>
      {children}
    </button>
  );
}
