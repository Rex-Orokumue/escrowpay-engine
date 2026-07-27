import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from './App';

describe('App', () => {
  test('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeTruthy();
  });
});
