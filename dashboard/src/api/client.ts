import type {
  AdminStats,
  Credential,
  DisputeResolution,
  EscrowOrder,
  LedgerEntry,
  LoginResponse,
  Transaction,
  Wallet
} from './types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface FetchOptions {
  credential?: Credential;
  method?: 'GET' | 'POST';
  body?: unknown;
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (options.credential?.role === 'admin') {
    headers['x-admin-key'] = options.credential.value;
  } else if (options.credential?.role === 'partner') {
    headers['Authorization'] = `Bearer ${options.credential.value}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const json = await response.json();

  if (!response.ok) {
    throw new ApiError(json.error ?? 'Request failed.', response.status);
  }

  return json.data as T;
}

export const login = (email: string, password: string) =>
  apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });

export const getMyWallets = (credential: Credential) =>
  apiFetch<Wallet[]>('/wallet/mine', { credential });

export const getMyEscrows = (credential: Credential, status?: string) =>
  apiFetch<EscrowOrder[]>(`/escrow/mine${status ? `?status=${status}` : ''}`, { credential });

export const getMyTransactions = (credential: Credential) =>
  apiFetch<Transaction[]>('/transactions/mine', { credential });

export const getAdminStats = (credential: Credential) =>
  apiFetch<AdminStats>('/admin/stats', { credential });

export const getAdminWallets = (credential: Credential) =>
  apiFetch<Wallet[]>('/admin/wallets?limit=200', { credential });

export const getAdminEscrows = (credential: Credential, status?: string) =>
  apiFetch<EscrowOrder[]>(`/admin/escrows?limit=200${status ? `&status=${status}` : ''}`, { credential });

export const getAdminTransactions = (credential: Credential) =>
  apiFetch<Transaction[]>('/admin/transactions?limit=200', { credential });

export const getAdminLedger = (credential: Credential, type?: string) =>
  apiFetch<LedgerEntry[]>(`/admin/ledger?limit=200${type ? `&type=${type}` : ''}`, { credential });

export const getAdminDisputes = (credential: Credential) =>
  apiFetch<EscrowOrder[]>('/admin/disputes?limit=200', { credential });

export const createAdminUser = (credential: Credential, platformId: string, email: string, password: string) =>
  apiFetch('/admin/users', { credential, method: 'POST', body: { platformId, email, password } });

export const resolveDispute = (
  credential: Credential,
  escrowOrderId: string,
  resolution: 'release' | 'refund'
) => apiFetch<DisputeResolution>(`/admin/disputes/${escrowOrderId}/${resolution}`, { credential, method: 'POST' });
