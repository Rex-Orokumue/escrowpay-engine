import { useState } from 'react';
import { ApiError, login } from '../api/client';
import type { Credential, Role } from '../api/types';

interface LoginPageProps {
  onLogin: (credential: Credential) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [activeTab, setActiveTab] = useState<Role>('admin');
  const [adminKey, setAdminKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (activeTab === 'admin') {
      onLogin({ role: 'admin', value: adminKey });
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(email, password);
      onLogin({ role: 'partner', value: result.token });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-8">
        <h1 className="font-display text-2xl mb-6">EscrowPay Engine</h1>

        <div role="tablist" className="flex gap-2 mb-6">
          <button
            role="tab"
            aria-selected={activeTab === 'admin'}
            className={`flex-1 py-2 rounded-lg text-sm ${activeTab === 'admin' ? 'bg-blue-dim text-blue' : 'text-muted'}`}
            onClick={() => setActiveTab('admin')}
            type="button"
          >
            Admin
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'partner'}
            className={`flex-1 py-2 rounded-lg text-sm ${activeTab === 'partner' ? 'bg-blue-dim text-blue' : 'text-muted'}`}
            onClick={() => setActiveTab('partner')}
            type="button"
          >
            Partner
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {activeTab === 'admin' ? (
            <label className="flex flex-col gap-1 text-sm">
              Admin key
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                className="bg-surface-2 border border-border rounded-lg px-3 py-2"
                required
              />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-surface-2 border border-border rounded-lg px-3 py-2"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-surface-2 border border-border rounded-lg px-3 py-2"
                  required
                />
              </label>
            </>
          )}

          {error && <p className="text-red text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="bg-blue text-bg font-semibold rounded-lg py-2 disabled:opacity-50"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
