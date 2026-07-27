import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import LoginPage from './LoginPage';
import * as client from '../api/client';

describe('LoginPage', () => {
  test('admin tab stores an admin credential without calling the login API', async () => {
    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} />);

    fireEvent.click(screen.getByRole('tab', { name: /admin/i }));
    fireEvent.change(screen.getByLabelText(/admin key/i), { target: { value: 'my-admin-key' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({ role: 'admin', value: 'my-admin-key' });
    });
  });

  test('partner tab calls the login API and stores the returned JWT', async () => {
    const onLogin = vi.fn();
    vi.spyOn(client, 'login').mockResolvedValue({
      token: 'returned-jwt',
      userId: 'u1',
      platformId: 'p1',
      platformName: 'Test Platform',
      expiresIn: '7d'
    });

    render(<LoginPage onLogin={onLogin} />);

    fireEvent.click(screen.getByRole('tab', { name: /partner/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({ role: 'partner', value: 'returned-jwt' });
    });
  });

  test('partner tab shows an error message on failed login', async () => {
    vi.spyOn(client, 'login').mockRejectedValue(new client.ApiError('Invalid email or password.', 401));

    render(<LoginPage onLogin={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: /partner/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
  });
});
