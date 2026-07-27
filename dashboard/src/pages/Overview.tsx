import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminStats, getMyEscrows, getMyWallets } from '../api/client';
import StatTile from '../components/StatTile';
import { formatNaira } from '../lib/currency';

export default function Overview() {
  const { credential } = useAuth();
  if (!credential) return null;

  if (credential.role === 'admin') {
    return <AdminOverview />;
  }
  return <PartnerOverview />;
}

function AdminOverview() {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => getAdminStats(credential!)
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Dashboard Overview</h1>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatTile label="Total Wallets" value={String(data.totalWallets)} />
        <StatTile label="Total Locked" value={formatNaira(data.totalLocked)} />
        <StatTile label="Active Escrows" value={String(data.activeEscrows)} tone="orange" />
        <StatTile label="Open Disputes" value={String(data.openDisputes)} tone="red" />
      </div>
      <div className="bg-surface border border-border rounded-2xl p-5">
        <div className="text-sm font-semibold mb-3">Ledger Health</div>
        <div className={data.ledgerHealthy ? 'text-green' : 'text-red'}>
          {data.ledgerHealthy ? 'All invariants passing' : 'Ledger imbalance detected — investigate immediately'}
        </div>
      </div>
    </div>
  );
}

function PartnerOverview() {
  const { credential } = useAuth();
  const wallets = useQuery({ queryKey: ['my-wallets'], queryFn: () => getMyWallets(credential!) });
  const escrows = useQuery({ queryKey: ['my-escrows'], queryFn: () => getMyEscrows(credential!) });

  if (wallets.isLoading || escrows.isLoading || !wallets.data || !escrows.data) {
    return <p className="text-muted">Loading...</p>;
  }

  const activeEscrows = escrows.data.filter((e) => e.status === 'funded').length;
  const disputedEscrows = escrows.data.filter((e) => e.status === 'disputed').length;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Dashboard Overview</h1>
      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Your Wallets" value={String(wallets.data.length)} />
        <StatTile label="Active Escrows" value={String(activeEscrows)} tone="orange" />
        <StatTile label="Open Disputes" value={String(disputedEscrows)} tone="red" />
      </div>
    </div>
  );
}
