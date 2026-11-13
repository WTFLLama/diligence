// dil.js - the Diligence tab: Pace, Spend & budget, Cashflow & capex, Receivables, Payables.
import { h, useState, Pg, Pills } from '../lib.js';
import { t } from '../prefs.js';
import { Pace } from './pace.js';
import { Spend } from './spend.js';
import { Plan } from './plan.js';
import { Recv } from './recv.js';

export function Dil({ m, start }) {
  const [v, setV] = useState(typeof start === 'string' ? start : 'pace');
  return h(Pg, { title: t('Diligence') },
    h(Pills, { v, set: setV, o: [['pace', t('Pace')], ['spend', t('Spend & budget')], ['plan', t('Cashflow & capex')], ['ar', t('Receivables')], ['ap', t('Payables')]] }),
    v === 'pace' ? h(Pace, { m }) : v === 'spend' ? h(Spend, { m, goPlan: () => setV('plan') }) : v === 'plan' ? h(Plan, { m }) : h(Recv, { m, kind: v, key: v }));
}
