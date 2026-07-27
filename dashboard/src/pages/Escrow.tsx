import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminEscrows, getMyEscrows } from '../api/client';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import { formatNaira } from '../lib/currency';
import type { EscrowOrder } from '../api/types';

function truncateId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

export default function Escrow() {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['escrows', credential?.role],
    queryFn: () => (credential!.role === 'admin' ? getAdminEscrows(credential!) : getMyEscrows(credential!))
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Escrow</h1>
      <DataTable
        columns={[
          {
            key: 'id',
            header: 'Escrow ID',
            render: (row: EscrowOrder) => (
              <div>
                <div className="font-mono">{truncateId(row.id)}</div>
                {row.metadata && typeof row.metadata.description === 'string' && (
                  <div className="text-xs text-muted">{row.metadata.description}</div>
                )}
              </div>
            )
          },
          { key: 'buyer_account_id', header: 'Buyer', render: (row: EscrowOrder) => truncateId(row.buyer_account_id) },
          { key: 'seller_account_id', header: 'Seller', render: (row: EscrowOrder) => truncateId(row.seller_account_id) },
          { key: 'amount', header: 'Amount', render: (row: EscrowOrder) => formatNaira(row.amount) },
          { key: 'fee_amount', header: 'Fee', render: (row: EscrowOrder) => formatNaira(row.fee_amount) },
          { key: 'status', header: 'Status', render: (row: EscrowOrder) => <StatusBadge status={row.status} /> },
          {
            key: 'created_at',
            header: 'Created',
            render: (row: EscrowOrder) => new Date(row.created_at).toLocaleDateString()
          }
        ]}
        rows={data}
        emptyMessage="No escrow orders yet."
        getRowKey={(row: EscrowOrder) => row.id}
      />
    </div>
  );
}
