// capture.js - reads a bank SMS / e-mail text with simple rules (no AI): amount, date, merchant, card digits, refund or not.
// The raw message is stored by the database (inbox_capture); it is parsed here, when the app shows it.
const numText = s => {
  let t = String(s == null ? '' : s).replace(/\s/g, '');
  const c = t.lastIndexOf(','), d = t.lastIndexOf('.');
  if (c > -1 && d > -1) t = c > d ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (c > -1) t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');
  else if (d > -1) t = /\.\d{1,2}$/.test(t) && t.split('.').length === 2 ? t : t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export function parseBankText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const NUM = '(\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)', CUR = '(?:TL|TRY|₺)';
  const tries = [
    new RegExp('(?:harcama|i[sş]lem|[cç]ekim)?\\s*tutar[ıi]?\\s*[:=]?\\s*' + NUM + '\\s*' + CUR, 'i'),
    new RegExp(NUM + '\\s*' + CUR + '(?![A-Za-zÇĞİÖŞÜçğıöşü])', 'i'),
    new RegExp(CUR + '\\s*' + NUM, 'i')];
  let amount = NaN;
  for (const re of tries) { const m = t.match(re); if (m) { amount = numText(m[1]); if (amount > 0) break; } }
  if (!(amount > 0)) return null;
  // one-time codes, statements and ads are not transactions
  const txWord = /harcama|al[ıi][sş]veri[sş]|i[sş]lem yap|[cç]ekim|[öo]deme yap|iade|iptal|purchase|spent/i.test(t);
  if (!txWord && /[şs]ifre|do[gğ]rulama|onay kodu|tek kullan[ıi]ml[ıi]k|\bkod\b|\botp\b|ekstre|son [öo]deme|asgari|kampanya|f[ıi]rsat|kazan/i.test(t)) return null;

  let date = '';
  const dm = t.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/);
  if (dm) {
    let y = Number(dm[3]); if (y < 100) y += 2000;
    const mo = Number(dm[2]), da = Number(dm[1]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) date = y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
  }
  const lm = t.match(/(\d{4})\s*(?:ile\s+(?:biten|sona\s+eren|sonlanan)|nolu|no'?lu|numaral[ıi])/i) || t.match(/(?:\*{2,}|[xX]{2,})\s*(\d{4})\b/)
    || t.match(/son\s*(?:4|d[öo]rt)\s*(?:hanesi|hane)?\s*:?\s*(\d{4})\b/i) || t.match(/ending(?:\s+in)?\s*(\d{4})\b/i);
  const last4 = lm ? lm[1] : '';

  let pos = '';
  let mm = t.match(/(?:[üu]ye\s*)?[iıİI][sşSŞ]yeri(?:\s*ad[ıi])?\s*[:\-]\s*([^,;:]+?)(?=\s*(?:[,;]|\.\s|tutar|tarih|i[sş]lem|$))/i);
  if (mm) pos = mm[1];
  if (!pos) {
    // "... MIGROS isyerinden ..." / "... WWW.IDEFIX.COM firmasından ..."
    mm = t.match(/^(.*?)\s+(?:[iıİI][sşSŞ][yY][eE][rR](?:[iİıI])?(?:nden|nde|inden|inde|den|de|ine|e)?|[fF][iİI][rR][mM][aA](?:s[ıi]ndan|s[ıi]nda|dan|da)?)(?=[\s,.;:]|$)/);
    if (mm) pos = mm[1].replace(/^(?:.*\s)?(?:tarih\S*|saat\S*|itibar\S*|kart\S*|ile|biten|TL|TRY|₺|\d[\d./:,*-]*\S*)\s+/i, '');
  }
  if (!pos) { mm = t.match(/tutarl[ıi]\s+(.+?)\s+(?:i[sş]lem|harcama|al[ıi][sş]veri[sş])/i); if (mm) pos = mm[1]; }
  if (!pos) { mm = t.match(/\bat\s+([A-Z0-9][^,;]+?)(?=\s+(?:on|for)\b|[,;.]|$)/); if (mm) pos = mm[1]; }
  pos = pos.replace(/['’](?:den|dan|ten|tan|de|da|te|ta)$/i, '').trim().split(' ').slice(-6).join(' ').slice(0, 60);

  const kind = /iade|iptal|refund|reversal/i.test(t) ? 'refund'
    : (!/harcama|al[ıi][sş]veri[sş]/i.test(t) && /hesab[ıi]n[ıi]za.*(?:yat|ge[cç]|aktar)|gelen (?:eft|havale|fast)|maa[sş]/i.test(t) ? 'income' : 'expense');
  return { amount: Math.round(amount * 100) / 100, date, pos, last4, kind };
}

// which account a message belongs to: the card's last 4 digits first, then the sender set for that channel
export function matchAccount(accounts, channel, sender, last4) {
  const live = accounts.filter(a => (a.kind === 'cash' || a.kind === 'card') && !a.archived);
  if (last4) { const hit = live.filter(a => String(a.capture_last4 || '').trim() === last4); if (hit.length === 1) return hit[0].id; }
  const s = String(sender || '').toLocaleLowerCase('tr');
  const by = live.filter(a => { const f = String(a.capture_sender || '').trim().toLocaleLowerCase('tr'); return a.capture_channel === channel && f && s.indexOf(f) > -1; });
  return by.length === 1 ? by[0].id : '';
}
