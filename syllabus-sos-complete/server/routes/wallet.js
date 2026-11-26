import { config } from '../config.js';
import { get, all, run, tx, audit } from '../db.js';
import { HttpError, T, parse } from '../security.js';
import { EXTERNAL, PAYOUTS, balanceOf, heldFor, pendingEarnings, ledgerEntries, transfer } from '../money.js';

export function register(r) {
  r.get('/api/wallet', (ctx) => {
    const uid = ctx.user.id;
    return {
      balance: balanceOf(uid),
      held: heldFor(uid),
      pending_earnings: pendingEarnings(uid),
      entries: ledgerEntries(uid, 50),
      withdrawals: all('SELECT id, amount, status, note, created_at, resolved_at FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 20', uid),
      payments_mode: config.paymentsMode,
      fee_percent: config.feePercent,
    };
  });

  r.post('/api/wallet/topup', (ctx) => {
    if (config.paymentsMode !== 'test') throw new HttpError(403, 'Adding credits is not open yet.');
    const b = parse(ctx.body, { amount: T.int({ min: 50, max: 2000 }) });
    tx(() => {
      const last24 = get(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE account = ? AND kind = 'topup' AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')",
        ctx.user.id
      ).s;
      if (last24 + b.amount > 5000) throw new HttpError(429, 'Daily test credit limit reached.');
      transfer(EXTERNAL, ctx.user.id, b.amount, 'topup', null, 'Test credits');
    });
    audit(ctx.user.id, 'wallet.topup', String(b.amount), ctx.ip);
    return { balance: balanceOf(ctx.user.id) };
  });

  r.post('/api/wallet/withdraw', (ctx) => {
    const b = parse(ctx.body, {
      amount: T.int({ min: 100, max: 100000 }),
      note: T.str({ min: 1, max: 200, optional: true, default: '' }),
    });
    const id = tx(() => {
      if (get("SELECT COUNT(*) AS n FROM withdrawals WHERE user_id = ? AND status = 'pending'", ctx.user.id).n >= 3) {
        throw new HttpError(409, 'You already have 3 pending withdrawals.');
      }
      const res = run('INSERT INTO withdrawals (user_id, amount, note) VALUES (?, ?, ?)', ctx.user.id, b.amount, b.note);
      transfer(ctx.user.id, PAYOUTS, b.amount, 'withdrawal', null, `Withdrawal request ${Number(res.lastInsertRowid)}`);
      return Number(res.lastInsertRowid);
    });
    audit(ctx.user.id, 'wallet.withdraw', `${id}:${b.amount}`, ctx.ip);
    ctx.status = 201;
    return { id, balance: balanceOf(ctx.user.id) };
  });
}
