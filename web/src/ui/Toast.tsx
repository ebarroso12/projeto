import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info';
interface Item { id: number; message: string; tone: Tone }

const Ctx = createContext<(message: string, tone?: Tone, ms?: number) => void>(() => {});

export function useToast() {
  const push = useContext(Ctx);
  return useMemo(() => ({
    success: (m: string) => push(m, 'success'),
    error: (m: string) => push(m, 'error', 7000),
    info: (m: string) => push(m, 'info'),
  }), [push]);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const push = useCallback((message: string, tone: Tone = 'info', ms = 4000) => {
    const id = Date.now() + Math.random();
    setItems(s => [...s.slice(-3), { id, message, tone }]);
    setTimeout(() => setItems(s => s.filter(i => i.id !== id)), ms);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map(i => <div key={i.id} className={`toast ${i.tone}`} role={i.tone === 'error' ? 'alert' : 'status'}>{i.message}</div>)}
      </div>
    </Ctx.Provider>
  );
}
