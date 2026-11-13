// ui.js - pickers and labels that depend on the chart of accounts.
import { accountsOf, parties } from './engine.js';
import { t } from './prefs.js';
import { h, In } from './lib.js';

// The Debit / Credit tag shown next to every account. It comes from the account's kind, never typed by hand:
// cash, receivables, stock and expenses are Debit accounts; cards, loans, payables and income are Credit accounts.
export const KIND_LABEL = { cash: 'Cash & bank', card: 'Credit card', loan: 'Loan', payable: 'Payable', receivable: 'Receivable', stock: 'Stock', investment: 'Investment', expense: 'Expense', income: 'Income', equity: 'Equity' };
export const sideLabel = a => t(a.normal_side === 'credit' || a.debit === false ? 'Credit' : 'Debit');
export const kindLabel = a => t(KIND_LABEL[a.kind] || a.kind);
// short tag for dropdowns: payment methods show Debit / Credit, special categories show what they are
export const payTag = a => (a.kind === 'cash' ? t('Debit') : a.kind === 'card' ? t('Credit') : kindLabel(a));
export const catTag = a => (a.kind === 'expense' || a.kind === 'income' ? '' : kindLabel(a));

const opts = (list, tag) => list.map(a => ({ v: a.id, l: a.name, e: a.emoji || '', k: tag ? tag(a) : '' }));
export const payOpts = (m, kinds) => opts(accountsOf(m, kinds || ['cash', 'card', 'payable']), payTag);
export const moneyOpts = m => opts(accountsOf(m, ['cash', 'card', 'loan', 'payable']), payTag);
export const expenseOpts = (m, plain) => opts(accountsOf(m, plain ? ['expense'] : ['expense', 'receivable', 'stock']), catTag);
export const incomeOpts = m => opts(accountsOf(m, ['income']), catTag);

// person (cari) input with suggestions from earlier entries
export const PartyIn = ({ m, v, on, ph }) => h('div', null,
  In(v, on, { placeholder: ph || t('Who owes or is owed?'), list: 'dl-party', autoComplete: 'off' }),
  h('datalist', { id: 'dl-party' }, parties(m).map(c => h('option', { key: c, value: c }))));
