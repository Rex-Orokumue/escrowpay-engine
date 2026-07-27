import { beforeEach, describe, expect, test } from 'vitest';
import { clearCredential, loadCredential, saveCredential } from './storage';

describe('auth storage', () => {
  beforeEach(() => localStorage.clear());

  test('round-trips a credential through localStorage', () => {
    saveCredential({ role: 'admin', value: 'abc123' });
    expect(loadCredential()).toEqual({ role: 'admin', value: 'abc123' });
  });

  test('returns null when nothing is stored', () => {
    expect(loadCredential()).toBeNull();
  });

  test('clearCredential removes it', () => {
    saveCredential({ role: 'partner', value: 'jwt-token' });
    clearCredential();
    expect(loadCredential()).toBeNull();
  });
});
