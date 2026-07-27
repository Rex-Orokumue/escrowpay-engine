import { useRef, useState, type ReactNode } from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import { ApiError } from './api/client';
import Sidebar from './components/Sidebar';
import Overview from './pages/Overview';
import Wallets from './pages/Wallets';
import Escrow from './pages/Escrow';
import Transactions from './pages/Transactions';
import Disputes from './pages/Disputes';
import Ledger from './pages/Ledger';

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
        }),
        defaultOptions: {
          queries: {
            // A 401 means the stored credential is bad — retrying with the
            // same credential can never succeed, and it would also delay
            // the onError-triggered logout above by several seconds of
            // exponential backoff for no benefit.
            retry: (failureCount, error) =>
              !(error instanceof ApiError && error.status === 401) && failureCount < 3
          }
        }
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function AuthedShell() {
  const { credential, logout } = useAuth();
  if (!credential) return null;

  return (
    <div className="min-h-screen flex">
      <Sidebar role={credential.role} onLogout={logout} />
      <main className="flex-1 p-8">
        <Routes>
          <Route path="/overview" element={<Overview />} />
          <Route path="/wallets" element={<Wallets />} />
          <Route path="/escrow" element={<Escrow />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/disputes" element={<Disputes />} />
          <Route
            path="/ledger"
            element={credential.role === 'admin' ? <Ledger /> : <Navigate to="/overview" replace />}
          />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Shell() {
  const { credential, login } = useAuth();

  if (!credential) {
    return <LoginPage onLogin={login} />;
  }

  return <AuthedShell />;
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
