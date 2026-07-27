import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Credential } from '../api/types';
import { clearCredential, loadCredential, saveCredential } from './storage';

interface AuthContextValue {
  credential: Credential | null;
  login: (credential: Credential) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [credential, setCredential] = useState<Credential | null>(loadCredential());

  function login(c: Credential) {
    saveCredential(c);
    setCredential(c);
  }

  function logout() {
    clearCredential();
    setCredential(null);
  }

  return (
    <AuthContext.Provider value={{ credential, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
