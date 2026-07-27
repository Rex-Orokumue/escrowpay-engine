import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Transactions from './Transactions';
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

describe('Transactions', () => {
  test('renders transaction rows', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminTransactions').mockResolvedValue([
      {
        id: 'txn-1',
        idempotency_key: 'idem-1',
        type: 'deposit',
        status: 'completed',
        amount: 500000,
        currency: 'NGN',
        metadata: null,
        created_at: '2026-03-17T00:00:00.000Z'
      }
    ]);

    renderWithProviders(<Transactions />);

    await waitFor(() => {
      expect(screen.getByText('₦5,000.00')).toBeInTheDocument();
      expect(screen.getByText('deposit')).toBeInTheDocument();
    });
  });
});
