import { useRef, useState, type ReactNode } from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import { ApiError } from './api/client';

function QueryProvider({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (error instanceof ApiError && error.status === 401) {
              logoutRef.current();
            }
          }
        })
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function AuthedShell() {
  const { credential, logout } = useAuth();
  if (!credential) return null;

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-surface-2 border-r border-border p-6">
        <div className="font-display text-lg mb-8">EscrowPay Engine</div>
        <nav className="flex flex-col gap-1 text-sm text-muted">
          <span>Overview</span>
        </nav>
        <button onClick={logout} className="mt-auto text-sm text-muted underline">
          Log out
        </button>
      </aside>
      <main className="flex-1 p-8">
        <h1>Overview</h1>
      </main>
    </div>
  );
}

function Shell() {
  const { credential, login } = useAuth();

  if (!credential) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <Routes>
      <Route path="*" element={<AuthedShell />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <QueryProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </QueryProvider>
    </AuthProvider>
  );
}
