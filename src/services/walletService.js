// ============================================================
// WALLET SERVICE
// Manages user wallets and balances.
// All money movements go through the Transaction Engine
// which ensures atomicity and double-entry accounting.
// Operations:
//   - create_wallet
//   - deposit
//   - withdraw
//   - transfer
//   - get_balance
// ============================================================

const pool = require('../config/db');
const accountRepository = require('../repositories/accountRepository');
const transactionService = require('./transactionService');
const ledgerService = require('./ledgerService');

// System account ID — the source/sink for deposits and withdrawals
// This must exist in your accounts table as a 'system' type account
const SYSTEM_ACCOUNT_ID = process.env.SYSTEM_ACCOUNT_ID;

class WalletService {

  // ── Create a new wallet ──────────────────────────────────────
  async createWallet({ userId, currency = 'NGN' }) {
    // Check if user already has a wallet
    const existing = await accountRepository.findByUserIdAndType(userId, 'user_wallet');

    if (existing) {
      throw new Error(`User ${userId} already has a wallet.`);
    }

    const account = await accountRepository.create({
      userId,
      type: 'user_wallet',
      currency
    });

    return {
      accountId: account.id,
      userId: account.user_id,
      type: account.type,
      currency: account.currency,
      status: account.status,
      balance: 0,
      createdAt: account.created_at
    };
  }

  // ── Get wallet balance ───────────────────────────────────────
  // Balance is ALWAYS computed from ledger entries.
  // There is no balance column — this is intentional.
  async getBalance(accountId) {
    const account = await accountRepository.findById(accountId);

    if (!account) {
      throw new Error(`Account ${accountId} not found.`);
    }

    const balanceInKobo = await ledgerService.getBalance(accountId);

    return {
      accountId,
      balance: balanceInKobo,
      balanceFormatted: `₦${(balanceInKobo / 100).toFixed(2)}`,
      currency: account.currency,
      status: account.status
    };
  }

  // ── Deposit funds ────────────────────────────────────────────
  // Moves money FROM the system account TO the user wallet.
  // DR system account / CR user wallet
  async deposit({ accountId, amount, currency = 'NGN', metadata = {} }) {

    if (!SYSTEM_ACCOUNT_ID) {
      throw new Error('SYSTEM_ACCOUNT_ID is not configured in environment variables.');
    }

    // Validate amount — must be positive integer in kobo
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Send amount in kobo (e.g. 500000 for ₦5,000).`);
    }

    const account = await accountRepository.findById(accountId);
    if (!account) throw new Error(`Account ${accountId} not found.`);
    if (account.status !== 'active') throw new Error(`Account is ${account.status}.`);

    const result = await transactionService.execute({
      type: 'deposit',
      amount,
      currency,
      debitAccountId: SYSTEM_ACCOUNT_ID,
      creditAccountId: accountId,
      metadata: {
        ...metadata,
        accountId,
        description: `Wallet deposit of ₦${(amount / 100).toFixed(2)}`
      }
    });

    const newBalance = await ledgerService.getBalance(accountId);

    return {
      success: true,
      transactionId: result.transaction.id,
      amount,
      amountFormatted: `₦${(amount / 100).toFixed(2)}`,
      newBalance,
      newBalanceFormatted: `₦${(newBalance / 100).toFixed(2)}`,
      status: result.transaction.status
    };
  }

  // ── Withdraw funds ───────────────────────────────────────────
  // Moves money FROM the user wallet TO the system account.
  // DR user wallet / CR system account
  async withdraw({ accountId, amount, currency = 'NGN', metadata = {} }) {

    if (!SYSTEM_ACCOUNT_ID) {
      throw new Error('SYSTEM_ACCOUNT_ID is not configured in environment variables.');
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Send amount in kobo.`);
    }

    const account = await accountRepository.findById(accountId);
    if (!account) throw new Error(`Account ${accountId} not found.`);
    if (account.status !== 'active') throw new Error(`Account is ${account.status}.`);

    // Invariant 7 — check sufficient balance before attempting
    const currentBalance = await ledgerService.getBalance(accountId);
    if (currentBalance < amount) {
      throw new Error(
        `Insufficient balance. Available: ₦${(currentBalance / 100).toFixed(2)}, Requested: ₦${(amount / 100).toFixed(2)}`
      );
    }

    const result = await transactionService.execute({
      type: 'withdrawal',
      amount,
      currency,
      debitAccountId: accountId,
      creditAccountId: SYSTEM_ACCOUNT_ID,
      metadata: {
        ...metadata,
        accountId,
        description: `Wallet withdrawal of ₦${(amount / 100).toFixed(2)}`
      }
    });

    const newBalance = await ledgerService.getBalance(accountId);

    return {
      success: true,
      transactionId: result.transaction.id,
      amount,
      amountFormatted: `₦${(amount / 100).toFixed(2)}`,
      newBalance,
      newBalanceFormatted: `₦${(newBalance / 100).toFixed(2)}`,
      status: result.transaction.status
    };
  }

  // ── Transfer funds ───────────────────────────────────────────
  // Moves money FROM one user wallet TO another.
  // DR sender wallet / CR recipient wallet
  async transfer({ fromAccountId, toAccountId, amount, currency = 'NGN', note = '', metadata = {} }) {

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Send amount in kobo.`);
    }

    if (fromAccountId === toAccountId) {
      throw new Error('Cannot transfer to the same account.');
    }

    const fromAccount = await accountRepository.findById(fromAccountId);
    if (!fromAccount) throw new Error(`Sender account ${fromAccountId} not found.`);
    if (fromAccount.status !== 'active') throw new Error(`Sender account is ${fromAccount.status}.`);

    const toAccount = await accountRepository.findById(toAccountId);
    if (!toAccount) throw new Error(`Recipient account ${toAccountId} not found.`);
    if (toAccount.status !== 'active') throw new Error(`Recipient account is ${toAccount.status}.`);

    // Invariant 6 — currency must match
    if (fromAccount.currency !== toAccount.currency) {
      throw new Error(`Currency mismatch: ${fromAccount.currency} vs ${toAccount.currency}.`);
    }

    // Invariant 7 — check sufficient balance
    const currentBalance = await ledgerService.getBalance(fromAccountId);
    if (currentBalance < amount) {
      throw new Error(
        `Insufficient balance. Available: ₦${(currentBalance / 100).toFixed(2)}, Requested: ₦${(amount / 100).toFixed(2)}`
      );
    }

    const result = await transactionService.execute({
      type: 'transfer',
      amount,
      currency,
      debitAccountId: fromAccountId,
      creditAccountId: toAccountId,
      metadata: {
        ...metadata,
        fromAccountId,
        toAccountId,
        note,
        description: `Transfer of ₦${(amount / 100).toFixed(2)}`
      }
    });

    const newBalance = await ledgerService.getBalance(fromAccountId);

    return {
      success: true,
      transactionId: result.transaction.id,
      amount,
      amountFormatted: `₦${(amount / 100).toFixed(2)}`,
      fromAccountId,
      toAccountId,
      newBalance,
      newBalanceFormatted: `₦${(newBalance / 100).toFixed(2)}`,
      status: result.transaction.status
    };
  }

  // ── Get wallet with full details ─────────────────────────────
  async getWallet(accountId) {
    const account = await accountRepository.findById(accountId);
    if (!account) throw new Error(`Account ${accountId} not found.`);

    const balance = await ledgerService.getBalance(accountId);
    const recentTransactions = await transactionService.getForAccount(accountId, 10);

    return {
      accountId: account.id,
      userId: account.user_id,
      type: account.type,
      currency: account.currency,
      status: account.status,
      balance,
      balanceFormatted: `₦${(balance / 100).toFixed(2)}`,
      recentTransactions,
      createdAt: account.created_at
    };
  }

  // ── Get all wallets for a platform ───────────────────────────
  async getForPlatform(platformId, limit = 50, offset = 0) {
    const accounts = await accountRepository.findByPlatformId(platformId, limit, offset);

    return Promise.all(accounts.map(async (account) => {
      const balance = await ledgerService.getBalance(account.id);
      return {
        accountId: account.id,
        userId: account.user_id,
        walletId: account.wallet_id,
        type: account.type,
        currency: account.currency,
        status: account.status,
        balance,
        balanceFormatted: `₦${(balance / 100).toFixed(2)}`,
        createdAt: account.created_at
      };
    }));
  }
}

module.exports = new WalletService();