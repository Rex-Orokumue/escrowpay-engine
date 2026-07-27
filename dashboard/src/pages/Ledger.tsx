import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminLedger } from '../api/client';
import DataTable from '../components/DataTable';
import { formatNaira } from '../lib/currency';
import type { LedgerEntry } from '../api/types';

export default function Ledger() {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['ledger'],
    queryFn: () => getAdminLedger(credential!)
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Ledger Entries</h1>
      <p className="text-muted text-sm mb-6">
        Double-entry accounting records — every debit has a matching credit
      </p>
      <DataTable
        columns={[
          { key: 'id', header: 'Entry ID', render: (row: LedgerEntry) => row.id.slice(0, 8) },
          {
            key: 'wallet_id',
            header: 'Account',
            render: (row: LedgerEntry) => row.wallet_id ?? row.account_id.slice(0, 8)
          },
          { key: 'transaction_type', header: 'Type' },
          { key: 'direction', header: 'Direction' },
          { key: 'amount', header: 'Amount', render: (row: LedgerEntry) => formatNaira(row.amount) },
          {
            key: 'balance_after',
            header: 'Balance After',
            render: (row: LedgerEntry) => formatNaira(row.balance_after)
          },
          {
            key: 'created_at',
            header: 'Timestamp',
            render: (row: LedgerEntry) => new Date(row.created_at).toLocaleString()
          }
        ]}
        rows={data}
        emptyMessage="No ledger entries yet."
        getRowKey={(row: LedgerEntry) => row.id}
      />
    </div>
  );
}
