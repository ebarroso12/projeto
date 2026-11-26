import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
  iconOnly?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, block, iconOnly, className, children, disabled, ...rest }: Props) {
  const cls = ['btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', iconOnly && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} className={cls} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
