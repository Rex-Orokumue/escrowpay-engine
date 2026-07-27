import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Wallets from './Wallets';
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

describe('Wallets', () => {
  test('renders wallet rows with wallet_id, never a fabricated name', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminWallets').mockResolvedValue([
      {
        id: 'acc-1',
        wallet_id: 'ZLX-441782-7823',
        type: 'user_wallet',
        currency: 'NGN',
        status: 'active',
        balance: 120000,
        balanceFormatted: '₦1,200.00',
        created_at: '2026-01-01T00:00:00.000Z'
      }
    ] as never);

    renderWithProviders(<Wallets />);

    await waitFor(() => {
      expect(screen.getByText('ZLX-441782-7823')).toBeInTheDocument();
      expect(screen.getByText('₦1,200.00')).toBeInTheDocument();
    });
  });

  test('shows an empty state with no wallets', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminWallets').mockResolvedValue([]);

    renderWithProviders(<Wallets />);

    await waitFor(() => {
      expect(screen.getByText(/no wallets/i)).toBeInTheDocument();
    });
  });
});
