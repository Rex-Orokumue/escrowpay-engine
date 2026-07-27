import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import DataTable from './DataTable';

interface Row {
  id: string;
  name: string;
}

describe('DataTable', () => {
  const columns = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'Name' }
  ];

  test('renders rows and headers', () => {
    const rows: Row[] = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }];
    render(<DataTable columns={columns} rows={rows} emptyMessage="No rows" getRowKey={(r) => r.id} />);

    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  test('renders the empty message when rows is empty', () => {
    render(<DataTable columns={columns} rows={[]} emptyMessage="No rows yet" getRowKey={(r: Row) => r.id} />);
    expect(screen.getByText('No rows yet')).toBeInTheDocument();
  });

  test('uses a column render function when provided', () => {
    const rows: Row[] = [{ id: '1', name: 'Alice' }];
    const columnsWithRender = [
      { key: 'id', header: 'ID' },
      { key: 'name', header: 'Name', render: (row: Row) => <strong>{row.name.toUpperCase()}</strong> }
    ];
    render(<DataTable columns={columnsWithRender} rows={rows} emptyMessage="No rows" getRowKey={(r) => r.id} />);
    expect(screen.getByText('ALICE')).toBeInTheDocument();
  });
});
