import type { Credential } from '../api/types';

const STORAGE_KEY = 'escrowpay_dashboard_auth';

export function saveCredential(credential: Credential): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credential));
}

export function loadCredential(): Credential | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Credential;
  } catch {
    return null;
  }
}

export function clearCredential(): void {
  localStorage.removeItem(STORAGE_KEY);
}
