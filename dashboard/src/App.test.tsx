import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from './App';

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
      // Both the nav item and the page heading legitimately say "Overview"
      // (nav highlights the current page) — assert on at least one match
      // rather than the ambiguous single-match getByText.
      expect(screen.getAllByText(/overview/i).length).toBeGreaterThan(0);
    });
  });
});
