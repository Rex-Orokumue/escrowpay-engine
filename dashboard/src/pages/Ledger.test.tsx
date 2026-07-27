import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Ledger from './Ledger';
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

describe('Ledger', () => {
  test('renders ledger entries with direction and balance after', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminLedger').mockResolvedValue([
      {
        id: 'ldg-1',
        transaction_id: 'txn-1',
        account_id: 'acc-1',
        direction: 'CR',
        amount: 500000,
        balance_after: 500000,
        created_at: '2026-03-17T00:00:00.000Z',
        account_type: 'user_wallet',
        wallet_id: 'ZLX-441-7823',
        transaction_type: 'deposit'
      }
    ]);

    renderWithProviders(<Ledger />);

    await waitFor(() => {
      expect(screen.getByText('CR')).toBeInTheDocument();
      // Amount and balance_after are both 500000 in this mock, so
      // "₦5,000.00" legitimately renders in two columns.
      expect(screen.getAllByText('₦5,000.00').length).toBe(2);
    });
  });
});
