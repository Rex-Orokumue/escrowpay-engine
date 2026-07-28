import type { ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  emptyMessage: string;
  getRowKey: (row: T) => string;
}

export default function DataTable<T>({
  columns,
  rows,
  emptyMessage,
  getRowKey
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-8 text-center text-muted text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th key={col.key} className="text-left text-xs uppercase text-muted px-4 py-3">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="border-b border-border last:border-0">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3">
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
