import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Overview from './Overview';
import * as client from '../api/client';
import { AuthProvider } from '../auth/AuthContext';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('Overview', () => {
  test('admin role shows system-wide stats and ledger health', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminStats').mockResolvedValue({
      totalWallets: 1284,
      totalLocked: 840000000,
      totalLockedFormatted: '₦8,400,000.00',
      activeEscrows: 47,
      openDisputes: 3,
      ledgerHealthy: true
    });

    renderWithProviders(<Overview />);

    await waitFor(() => {
      expect(screen.getByText('1284')).toBeInTheDocument();
      expect(screen.getByText('47')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText(/all invariants passing/i)).toBeInTheDocument();
    });
  });

  test('partner role derives stats from their own wallets and escrows', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'partner', value: 'test-jwt' }));
    vi.spyOn(client, 'getMyWallets').mockResolvedValue([
      { accountId: 'a1', type: 'user_wallet', currency: 'NGN', status: 'active', balance: 0, balanceFormatted: '₦0.00' }
    ] as never);
    vi.spyOn(client, 'getMyEscrows').mockResolvedValue([
      { id: 'e1', status: 'funded' } as never,
      { id: 'e2', status: 'disputed' } as never
    ]);

    renderWithProviders(<Overview />);

    await waitFor(() => {
      // With 1 wallet, 1 funded escrow, and 1 disputed escrow, three tiles
      // legitimately render "1" — assert count rather than a single match.
      expect(screen.getAllByText('1').length).toBe(3);
    });
  });
});
