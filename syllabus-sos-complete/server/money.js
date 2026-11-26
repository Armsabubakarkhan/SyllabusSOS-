import crypto from 'node:crypto';
import { get, all, run } from './db.js';
import { HttpError } from './security.js';

/* Every movement of credits is a balanced transfer between two accounts:
   user ids (> 0), PLATFORM (0), ESCROW (-1), PAYOUTS (-2), EXTERNAL (-3).
   Ledger rows are append-only (database triggers) and always sum to zero. */

export const PLATFORM = 0;
export const ESCROW = -1;
export const PAYOUTS = -2;
export const EXTERNAL = -3;

export const balanceOf = (account) => get('SELECT COALESCE(SUM(amount), 0) AS b FROM ledger WHERE account = ?', account).b;

/** Must run inside tx(). */
export function transfer(from, to, amount, kind, bookingId = null, note = '') {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Transfer amount must be a positive whole number.');
  if (from > 0 && balanceOf(from) < amount) throw new HttpError(402, 'Not enough credits in your wallet.');
  const txn = crypto.randomBytes(12).toString('hex');
  const ins = 'INSERT INTO ledger (txn_id, account, booking_id, kind, amount, note) VALUES (?, ?, ?, ?, ?, ?)';
  run(ins, txn, from, bookingId, kind, -amount, note);
  run(ins, txn, to, bookingId, kind, amount, note);
}

export const heldFor = (userId) =>
  get(
    `SELECT COALESCE(SUM(price_total), 0) AS h FROM bookings WHERE learner_id = ? AND status IN ('requested','accepted','disputed')`,
    userId
  ).h;

export const pendingEarnings = (userId) =>
  get(
    `SELECT COALESCE(SUM(price_total - fee), 0) AS h FROM bookings WHERE tutor_id = ? AND status IN ('accepted','disputed')`,
    userId
  ).h;

export const ledgerEntries = (userId, limit = 50) =>
  all('SELECT id, kind, amount, note, booking_id, created_at FROM ledger WHERE account = ? ORDER BY id DESC LIMIT ?', userId, limit);

export function ledgerIsBalanced() {
  return get('SELECT COALESCE(SUM(amount), 0) AS s FROM ledger').s === 0;
}

export function priceFor(pricePerHour, durationMin, feePercent) {
  const total = Math.ceil((pricePerHour * durationMin) / 60);
  const fee = Math.floor((total * feePercent) / 100);
  return { total, fee };
}
