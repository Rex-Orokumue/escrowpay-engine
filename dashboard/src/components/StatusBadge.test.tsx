import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  test('renders a known status with its mapped color class', () => {
    render(<StatusBadge status="disputed" />);
    const badge = screen.getByText('disputed');
    expect(badge.className).toContain('red');
  });

  test('renders an unknown status without throwing', () => {
    render(<StatusBadge status="something_new" />);
    expect(screen.getByText('something_new')).toBeInTheDocument();
  });
});
