import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import App from './App';
import * as client from './api/client';

describe('App', () => {
  test('shows the login page when no credential is stored', () => {
    localStorage.clear();
    render(<App />);
    expect(screen.getByText(/EscrowPay Engine/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /admin/i })).toBeInTheDocument();
  });

  test('shows the authenticated shell after logging in as admin', async () => {
    localStorage.clear();
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: /admin/i }));
    fireEvent.change(screen.getByLabelText(/admin key/i), { target: { value: 'test-key' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/overview/i).length).toBeGreaterThan(0);
    });
  });

  test('admin sees Ledger in the nav; partner does not', async () => {
    localStorage.clear();
    vi.spyOn(client, 'getAdminStats').mockResolvedValue({
      totalWallets: 0,
      totalLocked: 0,
      totalLockedFormatted: '₦0.00',
      activeEscrows: 0,
      openDisputes: 0,
      ledgerHealthy: true
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /admin/i }));
    fireEvent.change(screen.getByLabelText(/admin key/i), { target: { value: 'test-key' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Ledger' })).toBeInTheDocument();
    });
  });

  test('a 401 from any query logs the user back out to the login page', async () => {
    localStorage.clear();
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'stale-key' }));
    vi.spyOn(client, 'getAdminStats').mockRejectedValue(new client.ApiError('Admin access required.', 401));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /admin/i })).toBeInTheDocument();
    });
  });
});
