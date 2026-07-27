import { NavLink } from 'react-router-dom';
import type { Role } from '../api/types';

interface SidebarProps {
  role: Role;
  onLogout: () => void;
}

const NAV_ITEMS: { path: string; label: string; adminOnly?: boolean }[] = [
  { path: '/overview', label: 'Overview' },
  { path: '/ledger', label: 'Ledger', adminOnly: true },
  { path: '/wallets', label: 'Wallets' },
  { path: '/escrow', label: 'Escrow' },
  { path: '/transactions', label: 'Transactions' },
  { path: '/disputes', label: 'Disputes' }
];

export default function Sidebar({ role, onLogout }: SidebarProps) {
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');

  return (
    <aside className="w-64 bg-surface-2 border-r border-border p-6 flex flex-col">
      <div className="font-display text-lg mb-8">EscrowPay Engine</div>
      <nav className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `px-3 py-2 rounded-lg ${isActive ? 'bg-blue-dim text-blue' : 'text-muted'}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <button onClick={onLogout} className="mt-auto text-sm text-muted underline text-left">
        Log out
      </button>
    </aside>
  );
}
