import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminTransactions, getMyTransactions } from '../api/client';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import { formatNaira } from '../lib/currency';
import type { Transaction } from '../api/types';

export default function Transactions() {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', credential?.role],
    queryFn: () =>
      credential!.role === 'admin' ? getAdminTransactions(credential!) : getMyTransactions(credential!)
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Transactions</h1>
      <DataTable
        columns={[
          { key: 'id', header: 'Transaction ID', render: (row: Transaction) => row.id.slice(0, 8) },
          { key: 'type', header: 'Type' },
          { key: 'amount', header: 'Amount', render: (row: Transaction) => formatNaira(row.amount) },
          { key: 'status', header: 'Status', render: (row: Transaction) => <StatusBadge status={row.status} /> },
          {
            key: 'created_at',
            header: 'Time',
            render: (row: Transaction) => new Date(row.created_at).toLocaleString()
          }
        ]}
        rows={data}
        emptyMessage="No transactions yet."
        getRowKey={(row: Transaction) => row.id}
      />
    </div>
  );
}
