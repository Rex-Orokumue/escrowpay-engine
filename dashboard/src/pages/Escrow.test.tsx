import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Escrow from './Escrow';
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

describe('Escrow', () => {
  test('renders escrow rows with status and amount, no action buttons', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminEscrows').mockResolvedValue([
      {
        id: 'esc-1',
        buyer_account_id: 'buyer-account-uuid',
        seller_account_id: 'seller-account-uuid',
        escrow_account_id: 'esc-acc-1',
        amount: 8500000,
        currency: 'NGN',
        status: 'funded',
        metadata: null,
        funded_at: '2026-03-17T00:00:00.000Z',
        released_at: null,
        refunded_at: null,
        disputed_at: null,
        created_at: '2026-03-17T00:00:00.000Z',
        fee_amount: 12750,
        total_amount: 8512750
      }
    ]);

    renderWithProviders(<Escrow />);

    await waitFor(() => {
      expect(screen.getByText('₦85,000.00')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /release/i })).not.toBeInTheDocument();
    });
  });
});
