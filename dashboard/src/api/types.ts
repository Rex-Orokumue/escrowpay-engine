export type Role = 'admin' | 'partner';

export interface Credential {
  role: Role;
  value: string; // ADMIN_KEY for 'admin', JWT for 'partner'
}

export interface Wallet {
  accountId?: string; // present on /wallet/mine and /admin/wallets rows
  id?: string;        // /admin/wallets returns the raw account row shape (id, not accountId)
  userId?: string;
  user_id?: string;
  walletId?: string | null;
  wallet_id?: string | null;
  type: string;
  currency: string;
  status: string;
  balance: number;
  balanceFormatted: string;
  platform_name?: string;
  platform_prefix?: string;
  createdAt?: string;
  created_at?: string;
}

export interface EscrowOrder {
  id: string;
  buyer_account_id: string;
  seller_account_id: string;
  escrow_account_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'funded' | 'released' | 'refunded' | 'disputed';
  metadata: Record<string, unknown> | null;
  funded_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
  disputed_at: string | null;
  created_at: string;
  fee_amount: number;
  total_amount: number;
}

export interface Transaction {
  id: string;
  idempotency_key: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  transaction_id: string;
  account_id: string;
  direction: 'DR' | 'CR';
  amount: number;
  balance_after: number;
  created_at: string;
  account_type: string;
  wallet_id: string | null;
  transaction_type: string;
}

export interface AdminStats {
  totalWallets: number;
  totalLocked: number;
  totalLockedFormatted: string;
  activeEscrows: number;
  openDisputes: number;
  ledgerHealthy: boolean;
}

export interface LoginResponse {
  token: string;
  userId: string;
  platformId: string;
  platformName: string;
  expiresIn: string;
}

export interface DisputeResolution {
  success: boolean;
  escrowOrderId: string;
  transactionId: string;
  resolution: 'release' | 'refund';
  status: string;
}
