import { createContext, useContext, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Arte e grupo do módulo atual (fornecidos pela casca do app), mostrados no cabeçalho da página. */
export interface PageInfo { art?: string; grupo?: string }
export const PageArt = createContext<PageInfo>({});

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const { art, grupo } = useContext(PageArt);
  return (
    <div className="page-head">
      <div className="page-title">
        {art && <img className="page-art" src={art} alt="" width={56} height={56} decoding="async" />}
        <div>
        {grupo && <div className="eyebrow">{grupo}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  tone?: 'alert';
  children: ReactNode;
}
export function Card({ title, subtitle, actions, flush, tone, children }: CardProps) {
  return (
    <section className={`card${flush ? ' flush' : ''}${tone === 'alert' ? ' card-alert' : ''}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'danger' }) {
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'; children: ReactNode }) {
  return <span className={`badge${tone === 'neutral' ? '' : ` badge-${tone}`}`}>{children}</span>;
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger'; children: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'info' ? 'status' : 'alert'}>
      <Icon name="alert" />
      <p>{children}</p>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((100 * value) / max)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon = 'check', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <div className="icon-wrap"><Icon name={icon} size={24} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}
