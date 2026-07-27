import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, apiFetch } from './client';

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns parsed JSON data on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { foo: 'bar' } })
    }));

    const result = await apiFetch<{ foo: string }>('/admin/stats', {
      credential: { role: 'admin', value: 'test-admin-key' }
    });

    expect(result).toEqual({ foo: 'bar' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/stats'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-admin-key': 'test-admin-key' })
      })
    );
  });

  test('sends Authorization Bearer header for partner credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] })
    }));

    await apiFetch('/wallet/mine', { credential: { role: 'partner', value: 'test-jwt' } });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wallet/mine'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt' })
      })
    );
  });

  test('throws ApiError with status on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Invalid or expired token.' })
    }));

    await expect(
      apiFetch('/wallet/mine', { credential: { role: 'partner', value: 'bad-jwt' } })
    ).rejects.toMatchObject(new ApiError('Invalid or expired token.', 401));
  });
});
