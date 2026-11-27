import { useId, useState, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';

interface Common { label: string; hint?: string; error?: string }

export function TextField({ label, hint, error, id, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const senha = rest.type === 'password';
  const [ver, setVer] = useState(false);
  const input = <input id={fid} {...rest} type={senha ? (ver ? 'text' : 'password') : (rest.type ?? 'text')} aria-invalid={error ? true : undefined} />;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      {senha ? (
        // campo de senha: sempre com o "olho" para mostrar/ocultar o que está sendo digitado
        <div className="senha-wrap">
          {input}
          <button type="button" className="senha-olho" aria-label={ver ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={ver}
            aria-controls={fid} onClick={() => setVer(v => !v)}>
            <Icon name={ver ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </div>
      ) : input}
      {hint && <p className="hint">{hint}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

export type Option = string | { value: string; label: string };

export function SelectField({ label, hint, error, id, options, placeholder, ...rest }:
  Common & SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <select id={fid} {...rest} aria-invalid={error ? true : undefined}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => {
          const v = typeof o === 'string' ? o : o.value;
          return <option key={v} value={v}>{typeof o === 'string' ? o : o.label}</option>;
        })}
      </select>
      {hint && <p className="hint">{hint}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

export function TextAreaField({ label, hint, error, id, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <textarea id={fid} {...rest} />
      {hint && <p className="hint">{hint}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}
