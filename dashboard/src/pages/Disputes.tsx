import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminDisputes, getMyEscrows, resolveDispute } from '../api/client';
import DataTable from '../components/DataTable';
import { formatNaira } from '../lib/currency';
import type { Credential, EscrowOrder } from '../api/types';

function truncateId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

export default function Disputes() {
  const { credential } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['disputes', credential?.role],
    queryFn: () =>
      credential!.role === 'admin' ? getAdminDisputes(credential!) : getMyEscrows(credential!, 'disputed')
  });

  const releaseMutation = useMutation({
    mutationFn: (escrowOrderId: string) => resolveDispute(credential as Credential, escrowOrderId, 'release'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disputes'] })
  });

  const refundMutation = useMutation({
    mutationFn: (escrowOrderId: string) => resolveDispute(credential as Credential, escrowOrderId, 'refund'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disputes'] })
  });

  if (isLoading || !data || !credential) return <p className="text-muted">Loading...</p>;

  const isAdmin = credential.role === 'admin';

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Disputes</h1>
      <p className="text-muted text-sm mb-6">
        Active dispute cases — funds frozen in escrow pending admin resolution
      </p>
      <DataTable
        columns={[
          { key: 'id', header: 'Escrow ID', render: (row: EscrowOrder) => truncateId(row.id) },
          { key: 'buyer_account_id', header: 'Buyer', render: (row: EscrowOrder) => truncateId(row.buyer_account_id) },
          { key: 'seller_account_id', header: 'Seller', render: (row: EscrowOrder) => truncateId(row.seller_account_id) },
          { key: 'amount', header: 'Amount', render: (row: EscrowOrder) => formatNaira(row.amount) },
          {
            key: 'disputed_at',
            header: 'Opened',
            render: (row: EscrowOrder) => (row.disputed_at ? new Date(row.disputed_at).toLocaleDateString() : '—')
          },
          ...(isAdmin
            ? [
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (row: EscrowOrder) => (
                    <div className="flex gap-2">
                      <button
                        className="text-xs px-3 py-1 rounded-md bg-blue-dim text-blue"
                        onClick={() => releaseMutation.mutate(row.id)}
                        disabled={releaseMutation.isPending}
                      >
                        Release to Seller
                      </button>
                      <button
                        className="text-xs px-3 py-1 rounded-md bg-surface-2 text-muted"
                        onClick={() => refundMutation.mutate(row.id)}
                        disabled={refundMutation.isPending}
                      >
                        Refund Buyer
                      </button>
                    </div>
                  )
                }
              ]
            : [])
        ]}
        rows={data}
        emptyMessage="No open disputes."
        getRowKey={(row: EscrowOrder) => row.id}
      />
    </div>
  );
}
