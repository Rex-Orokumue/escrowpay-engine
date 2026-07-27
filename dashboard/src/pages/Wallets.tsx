import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminWallets, getMyWallets } from '../api/client';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import type { Wallet } from '../api/types';

function walletDisplayId(wallet: Wallet): string {
  const walletId = wallet.walletId ?? wallet.wallet_id;
  if (walletId) return walletId;
  const userId = wallet.userId ?? wallet.user_id ?? '';
  return userId ? `${userId.slice(0, 8)}…` : '—';
}

export default function Wallets() {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['wallets', credential?.role],
    queryFn: () => (credential!.role === 'admin' ? getAdminWallets(credential!) : getMyWallets(credential!))
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Wallets</h1>
      <DataTable
        columns={[
          { key: 'walletId', header: 'Wallet ID', render: walletDisplayId },
          { key: 'type', header: 'Type' },
          { key: 'currency', header: 'Currency' },
          { key: 'balanceFormatted', header: 'Balance' },
          { key: 'status', header: 'Status', render: (row: Wallet) => <StatusBadge status={row.status} /> },
          {
            key: 'created_at',
            header: 'Created',
            render: (row: Wallet) => new Date(row.createdAt ?? row.created_at ?? '').toLocaleDateString()
          }
        ]}
        rows={data}
        emptyMessage="No wallets yet."
        getRowKey={(row: Wallet) => row.accountId ?? row.id ?? Math.random().toString()}
      />
    </div>
  );
}
