// "Ask the planet": a question box → POST /api/ask → jump to the week, fly the camera, show the answer.
// If the backend is unreachable, a copy of the backend's keyword matcher answers locally,
// so the demo never shows an error.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const SECTOR_WORDS = {
  Technology: ['technology', 'tech'], Financials: ['financials', 'financial', 'banks', 'bank', 'banking', 'finance'],
  Energy: ['energy', 'oil', 'gas'], Healthcare: ['healthcare', 'health', 'pharma', 'drug'],
  Consumer: ['consumer', 'retail', 'shopping'], Industrials: ['industrials', 'industrial', 'manufacturing', 'airline'],
};
// Same keywords as server/ask.py COMPANY_WORDS (full phrases, so "banks" never matches "Bank of America")
const COMPANY_WORDS = {
  AAPL: 'apple', MSFT: 'microsoft', NVDA: 'nvidia', GOOGL: 'google', ORCL: 'oracle',
  JPM: 'jpmorgan', BAC: 'bank of america', GS: 'goldman', MS: 'morgan stanley', WFC: 'wells fargo',
  XOM: 'exxon', CVX: 'chevron', COP: 'conocophillips', SLB: 'schlumberger', OXY: 'occidental',
  JNJ: 'johnson', PFE: 'pfizer', UNH: 'unitedhealth', MRK: 'merck', ABT: 'abbott',
  AMZN: 'amazon', WMT: 'walmart', KO: 'coca-cola', PG: 'procter', MCD: 'mcdonald',
  CAT: 'caterpillar', BA: 'boeing', DE: 'deere', UPS: 'ups', LMT: 'lockheed',
};
const CRASH = /crash|worst|fall|fell|drop|panic|plunge|collapse|tank|bad/;
const BEST = /best|boom|rally|recover|surge|soar|rise|rose|gain|good/;
const FEAR = /fear|scary|scared|afraid|vix|volatil/;
const TOGETHER = /together|connected|correlat|in sync|diversif/;
const ADVICE = /\bshould i\b|\bbuy\b|\bsell\b|\binvest(ing|ment)?\b|\bwhat will\b|\bwill .* (go up|rise|fall)\b|\bpredict|\brecommend|\bprice target|\bworth buying/;
const NO_ADVICE = "Market Worlds is for exploring market history, not for investment advice. Try asking about a past event, like 'When did banks crash?'";
const UNSURE = "I couldn't work that out. Try 'worst week for Energy in 2020'.";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Mirror of server/ask.py Asker.fallback
export function localAnswer(question, data) {
  const q = question.toLowerCase();
  const none = (answer) => ({ weekIndex: null, date: null, focus: 'market', answer, source: 'fallback' });
  if (ADVICE.test(q)) return none(NO_ADVICE);
  const ym = q.match(/\b(20[0-2]\d)\b/);
  let year = ym && +ym[1] >= 2007 && +ym[1] <= 2026 ? +ym[1] : null;
  const mi = MONTHS.findIndex((m) => q.includes(m) || new RegExp(`\\b${m.slice(0, 3)}\\b`).test(q));
  const month = mi === -1 ? null : mi + 1;
  let focus = 'market';
  for (const s of data.stocks) {
    const word = COMPANY_WORDS[s.ticker];
    if (new RegExp(`\\b${esc(s.ticker.toLowerCase())}\\b`).test(q) || (word && q.includes(word))) focus = s.ticker;
  }
  if (focus === 'market') {
    for (const [name, words] of Object.entries(SECTOR_WORDS)) {
      if (words.some((w) => new RegExp(`\\b${w}\\b`).test(q))) { focus = name; break; }
    }
  }
  if (/covid|pandemic/.test(q)) year = year ?? 2020;
  if (/lehman|financial crisis|great recession/.test(q)) year = year ?? 2008;
  if (/\bai\b/.test(q)) { if (focus === 'market') focus = 'NVDA'; year = year ?? 2023; }

  const m = data.market;
  const stock = data.stocks.find((s) => s.ticker === focus), sector = data.sectors.find((s) => s.name === focus);
  const own = stock ? stock.ret : sector ? sector.ret : m.ret;
  let kind, series, best;
  if (FEAR.test(q)) [kind, series, best] = ['fear', m.vix, true];
  else if (TOGETHER.test(q)) [kind, series, best] = ['together', m.avgCorr, true];
  else if (BEST.test(q)) [kind, series, best] = ['best', own, true];
  else if (CRASH.test(q) || /covid|lehman/.test(q)) [kind, series, best] = ['worst', own, false];
  else return none(UNSURE);

  let week = -1;
  series.forEach((v, i) => {
    if (v == null) return;
    const d = data.dates[i];
    if (year && !d.startsWith(String(year))) return;
    if (month && +d.slice(5, 7) !== month) return;
    if (week === -1 || (best ? v > series[week] : v < series[week])) week = i;
  });
  if (week === -1) return none(UNSURE);
  if (kind === 'fear' || kind === 'together') focus = 'market';
  const subject = stock ? focus : sector ? `the ${focus} sector` : 'the market';
  const d = data.dates[week];
  const p = (x) => (x == null ? 'n/a' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
  const lead = {
    fear: `Market fear peaked in the week of ${d} (VIX ${m.vix[week].toFixed(0)}).`,
    together: `Sectors moved most closely together in the week of ${d} (average correlation ${m.avgCorr[week].toFixed(2)}).`,
    best: `The best week for ${subject}${year ? ` in ${year}` : ''} was the week of ${d}.`,
    worst: `The worst week for ${subject}${year ? ` in ${year}` : ''} was the week of ${d}.`,
  }[kind];
  const ownSeries = kind === 'fear' || kind === 'together' ? m.ret : own;
  const extra = ` ${subject[0].toUpperCase()}${subject.slice(1)} moved ${p(ownSeries[week])} that week; the whole market moved ${p(m.ret[week])} with VIX ${m.vix[week]?.toFixed(0) ?? 'n/a'}.`;
  return { weekIndex: week, date: d, focus, answer: lead + extra, source: 'fallback' };
}

/**
 * ctx: { $, data, go(weekIndex, focus), fmtDate }
 */
export function createAsk(ctx) {
  const { $ } = ctx;
  const form = $('askForm'), input = $('askInput'), card = $('ask');
  let seq = 0;

  function show(question, res) {
    card.style.display = 'block';
    $('askQ').textContent = `“${question}”`;
    $('askAnswer').textContent = res.answer;
    $('askLabel').textContent = res.source === 'ai' ? 'Generated by AI · checked against the data' : 'Based on the data';
    $('askWhere').textContent = res.date ? `${ctx.fmtDate(res.date)} · ${res.focus === 'market' ? 'whole market' : res.focus}` : '';
  }

  async function ask(question) {
    const my = ++seq;
    card.style.display = 'block';
    $('askQ').textContent = `“${question}”`;
    $('askAnswer').textContent = 'Searching…';
    $('askLabel').textContent = '';
    $('askWhere').textContent = '';
    let res = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }), signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) res = await r.json();
    } catch { /* backend down or slow: answer locally */ }
    if (!res || typeof res.answer !== 'string') res = localAnswer(question, ctx.data);
    if (my !== seq) return;               // a newer question replaced this one
    if (res.weekIndex != null) ctx.go(res.weekIndex, res.focus);
    show(question, res);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) ask(q);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; input.blur(); card.style.display = 'none'; e.stopPropagation(); }
  });
  $('askClose').addEventListener('click', () => { card.style.display = 'none'; });
  return { ask };
}
