import { Suspense, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Api } from './api/client';
import { AppShell } from './app/AppShell';
import { AuthProvider, useAuth } from './app/auth';
import { BootGate, FullLoading, useBoot } from './app/boot';
import { LoginPage } from './app/LoginPage';
import { TestePage } from './app/TestePage';
import { homePath, visibleFeatures } from './app/registry';
import { ThemeProvider } from './app/theme';
import { ConfirmProvider } from './ui/Dialog';
import { LoadingBlock } from './ui/QueryView';
import { ToastProvider } from './ui/Toast';

function AuthedRoutes() {
  const { eu } = useBoot();
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          {visibleFeatures(eu).map(f => (
            <Route key={f.id} path={f.path} element={<Suspense fallback={<LoadingBlock />}><f.Page /></Suspense>} />
          ))}
          <Route path="*" element={<Navigate to={homePath(eu)} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

function Root() {
  const { token, booting } = useAuth();
  const [convite, setConvite] = useState(() => new URLSearchParams(window.location.search).get('convite'));
  if (booting) return <FullLoading text="Entrando…" />;
  if (!token && convite) return <TestePage convite={convite} onVoltar={() => setConvite(null)} />;
  if (!token) return <LoginPage />;
  return <BootGate><AuthedRoutes /></BootGate>;
}

export default function App({ makeApi, demo }: { makeApi: (getToken: () => string | null) => Api; demo: boolean }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider makeApi={makeApi} demo={demo}>
            <Root />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
