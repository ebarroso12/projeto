import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'modal' | 'drawer';
  wide?: boolean;
}

/** <dialog> nativo: foco preso, Esc fecha, leitor de tela entende. O conteúdo só existe enquanto aberto (formulários nascem limpos). */
export function Dialog({ open, onClose, title, children, footer, variant = 'modal', wide }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dlg${variant === 'drawer' ? ' drawer' : ''}${wide ? ' wide' : ''}`}
      aria-label={title}
      onClose={onClose}
      onClick={e => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <>
          <div className="dlg-head">
            <h2>{title}</h2>
            <Button variant="ghost" iconOnly onClick={onClose} aria-label="Fechar"><Icon name="x" /></Button>
          </div>
          <div className="dlg-body">{children}</div>
          {footer && <div className="dlg-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
}
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

/** Substitui window.confirm: mesmo uso (`await confirm(...)`), visual próprio e acessível. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback<ConfirmFn>(opts => new Promise<boolean>(resolve => setState({ opts, resolve })), []);
  const finish = (v: boolean) => { state?.resolve(v); setState(null); };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog
        open={state !== null}
        onClose={() => finish(false)}
        title={state?.opts.title ?? ''}
        footer={
          <>
            <Button onClick={() => finish(false)}>{state?.opts.cancelLabel ?? 'Cancelar'}</Button>
            <Button variant={state?.opts.tone === 'danger' ? 'danger' : 'primary'} onClick={() => finish(true)}>
              {state?.opts.confirmLabel ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        {state?.opts.message}
      </Dialog>
    </ConfirmCtx.Provider>
  );
}
