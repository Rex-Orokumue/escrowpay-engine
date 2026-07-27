import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import StatTile from './StatTile';

describe('StatTile', () => {
  test('renders label, value, and sublabel', () => {
    render(<StatTile label="Total Wallets" value="1,284" sublabel="12 new this week" />);
    expect(screen.getByText('Total Wallets')).toBeInTheDocument();
    expect(screen.getByText('1,284')).toBeInTheDocument();
    expect(screen.getByText('12 new this week')).toBeInTheDocument();
  });

  test('renders without a sublabel', () => {
    render(<StatTile label="Open Disputes" value="3" />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
