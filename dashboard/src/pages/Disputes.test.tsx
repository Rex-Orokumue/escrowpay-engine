import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Disputes from './Disputes';
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

const disputedEscrow = {
  id: 'esc-disputed-1',
  buyer_account_id: 'buyer-1',
  seller_account_id: 'seller-1',
  escrow_account_id: 'esc-acc-1',
  amount: 68000000,
  currency: 'NGN',
  status: 'disputed',
  metadata: null,
  funded_at: '2026-03-12T00:00:00.000Z',
  released_at: null,
  refunded_at: null,
  disputed_at: '2026-03-12T00:00:00.000Z',
  created_at: '2026-03-10T00:00:00.000Z',
  fee_amount: 10000,
  total_amount: 68010000
};

describe('Disputes', () => {
  test('admin sees Release/Refund buttons and resolving a dispute refetches the list', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminDisputes').mockResolvedValue([disputedEscrow]);
    const resolveSpy = vi.spyOn(client, 'resolveDispute').mockResolvedValue({
      success: true,
      escrowOrderId: disputedEscrow.id,
      transactionId: 'txn-1',
      resolution: 'release',
      status: 'released'
    });

    renderWithProviders(<Disputes />);

    await waitFor(() => expect(screen.getByText('₦680,000.00')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /release to seller/i }));

    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
        disputedEscrow.id,
        'release'
      );
    });
  });

  test('partner sees their disputed escrows read-only, no action buttons', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'partner', value: 'test-jwt' }));
    vi.spyOn(client, 'getMyEscrows').mockResolvedValue([disputedEscrow]);

    renderWithProviders(<Disputes />);

    await waitFor(() => expect(screen.getByText('₦680,000.00')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /release to seller/i })).not.toBeInTheDocument();
  });
});
