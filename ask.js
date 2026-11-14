// "Ask the planet": a question box → jump to the week, fly the camera, show the answer.
//
// With an API key on the backend, /api/ask uses an LLM (answers checked against the data).
// Without one — or if the backend is down — the keyword matcher below answers in the browser.
// It understands: crashes / best weeks / fear / calm / sectors moving together, a company or
// sector on its own, a year, month or exact date, "grew the most / least", "now", and named
// events (COVID, Lehman, Brexit, SVB, tariffs…). When it can't match, it says what it can do
// and offers clickable examples, so the user is never stuck.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const SECTOR_WORDS = {
  Technology: ['technology', 'tech', 'software', 'chips', 'semiconductors?'],
  Financials: ['financials?', 'banks?', 'banking', 'finance', 'lenders?'],
  Energy: ['energy', 'oil', 'gas', 'petroleum'],
  Healthcare: ['healthcare', 'health', 'pharma', 'pharmaceuticals?', 'drugs?', 'medical'],
  Consumer: ['consumer', 'retail', 'retailers?', 'shopping', 'shops'],
  Industrials: ['industrials?', 'manufacturing', 'manufacturers?', 'defen[cs]e', 'aerospace'],
};
// Extra words for US companies (other markets use the company names in their data)
const COMPANY_WORDS = {
  AAPL: ['apple', 'iphone'], MSFT: ['microsoft'], NVDA: ['nvidia'], GOOGL: ['google', 'alphabet'], ORCL: ['oracle'],
  JPM: ['jpmorgan', 'jp morgan', 'chase'], BAC: ['bank of america'], GS: ['goldman'], MS: ['morgan stanley'], WFC: ['wells fargo'],
  XOM: ['exxon'], CVX: ['chevron'], COP: ['conocophillips'], SLB: ['schlumberger'], OXY: ['occidental'],
  JNJ: ['johnson & johnson', 'johnson and johnson'], PFE: ['pfizer'], UNH: ['unitedhealth'], MRK: ['merck'], ABT: ['abbott'],
  AMZN: ['amazon'], WMT: ['walmart'], KO: ['coca-cola', 'coca cola', 'coke'], PG: ['procter'], MCD: ['mcdonald'],
  CAT: ['caterpillar'], BA: ['boeing'], DE: ['deere'], UPS: ['ups'], LMT: ['lockheed'],
};
// Well-known companies that are NOT on any planet: answer helpfully instead of failing
const NOT_HERE = ['tesla', 'meta', 'facebook', 'netflix', 'disney', 'intel', 'ibm', 'nike', 'starbucks', 'visa',
  'mastercard', 'paypal', 'uber', 'airbnb', 'alibaba', 'berkshire', 'twitter', 'spotify', 'adobe', 'salesforce'];
// Named events → date range, default question type, default focus
const EVENTS = [
  { re: /covid|corona|pandemic|lockdown/, name: 'the COVID crash', from: '2020-02-14', to: '2020-04-30', kind: 'worst' },
  { re: /lehman|financial crisis|great recession|subprime|credit crunch|\bgfc\b/, name: 'the 2008 financial crisis', from: '2008-09-01', to: '2009-03-31', kind: 'worst' },
  { re: /flash crash/, name: 'the 2010 flash crash', from: '2010-05-01', to: '2010-05-31', kind: 'worst' },
  { re: /downgrade|euro ?(zone)? crisis|debt crisis|debt ceiling/, name: 'the 2011 debt crisis', from: '2011-07-15', to: '2011-10-15', kind: 'worst' },
  { re: /taper tantrum/, name: 'the 2013 taper tantrum', from: '2013-05-15', to: '2013-07-15', kind: 'worst' },
  { re: /devaluation|yuan|china (crash|sell-?off)/, name: 'the 2015 China sell-off', from: '2015-08-01', to: '2016-02-29', kind: 'worst' },
  { re: /brexit/, name: 'the Brexit vote', from: '2016-06-17', to: '2016-07-08', kind: 'worst' },
  { re: /volmageddon|vix spike/, name: 'the 2018 volatility spike', from: '2018-01-26', to: '2018-02-28', kind: 'worst' },
  { re: /trade war/, name: 'the US–China trade war', from: '2018-03-01', to: '2019-08-31', kind: 'worst' },
  { re: /oil (price )?war|negative oil/, name: 'the 2020 oil price war', from: '2020-03-01', to: '2020-04-30', kind: 'worst', focus: 'Energy' },
  { re: /vaccine/, name: 'the vaccine news', from: '2020-11-01', to: '2020-11-30', kind: 'best' },
  { re: /inflation|rate hikes?|fed hikes?|interest rates?|bear market/, name: 'the 2022 rate-hike bear market', from: '2022-01-01', to: '2022-12-31', kind: 'worst' },
  { re: /\bsvb\b|silicon valley bank|banking crisis|regional banks?/, name: 'the 2023 banking scare', from: '2023-03-01', to: '2023-03-31', kind: 'worst', focus: 'Financials' },
  { re: /\bai\b|artificial intelligence|chatgpt|\bgpt\b/, name: 'the AI boom', from: '2023-01-01', to: '2024-12-31', kind: 'best', focus: 'AI' },
  { re: /tariffs?|liberation day/, name: 'the 2025 tariff shock', from: '2025-03-20', to: '2025-04-30', kind: 'worst' },
];
const INTENTS = [
  ['growthMax', /grew (the )?most|biggest (winner|gainer|mountain)|best (performer|performing|stock|company)|tallest|most growth|top (stock|company)/],
  ['growthMin', /grew (the )?least|worst (performer|performing|stock|company)|lost (the )?most|smallest mountain|biggest loser/],
  ['latest', /\b(now|today|latest|current|currently|this week|recent(ly)?)\b/],
  ['fear', /fear|scar(y|ed|iest)|afraid|panic(ky)?|\bvix\b|volatil|turbulen|stress/],
  ['calm', /calm|quiet|stable|boring|peaceful|least volatile/],
  ['together', /together|connected|correlat|in sync|lockstep|diversif/],
  ['bestYear', /best (calendar )?year|strongest year|(year|years) .*(grew|rose|gained) (the )?most/],
  ['worstYear', /worst (calendar )?year|weakest year|(year|years) .*(fell|lost) (the )?most/],
  ['best', /best|boom|rally|recover|surge|soar|rise|rose|gain|jump|up the most|bull/],
  ['worst', /crash|worst|fall|fell|drop|plunge|collapse|tank|slump|sell-?off|bad|down the most|lost/],
];
const ADVICE = /\bshould (i|we|you)\b|\bwould you (buy|sell|invest)|\bworth buying\b|\bgood (investment|buy|time to)|\brecommend|\bprice target|\bpredict|\bforecast|\bwhat (stock|stocks|shares) (to|should)|\bwill [\w\s]+ (go up|go down|rise|fall|crash)|\b(buy|sell) (now|today|it)\b/;
const NO_ADVICE = "Market Worlds is for exploring market history, not for investment advice. Try asking about a past event, like 'When did banks crash?'";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const p = (x) => (x == null ? 'n/a' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
const f = (v, n) => (v == null ? 'n/a' : v.toFixed(n));

// Example questions for this planet (shown under the search bar and when a question can't be matched)
export function suggestions(data) {
  const top = [...data.stocks].sort((a, b) => (b.growth.at(-1) ?? 0) - (a.growth.at(-1) ?? 0))[0];
  const name = top?.name ?? top?.ticker ?? 'Apple';
  return ['When did banks crash?', 'Show me the COVID crash', `Best year for ${name}`, 'What happened in 2016?',
    'When was fear highest?', 'Which company grew the most?', 'Calmest week in 2017', 'Brexit'];
}

function findFocus(q, data) {
  for (const s of data.stocks) {
    const words = [...(COMPANY_WORDS[s.ticker] ?? []), ...(s.name && s.name.length > 2 ? [s.name.toLowerCase()] : [])];
    const tick = s.ticker.toLowerCase().replace(/\..*$/, '');
    if ((tick.length > 1 && new RegExp(`\\b${esc(tick)}\\b`).test(q)) || words.some((w) => q.includes(w))) return s.ticker;
  }
  for (const [name, words] of Object.entries(SECTOR_WORDS)) {
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(q))) return name;
  }
  return 'market';
}

function findDate(q) {
  let m = q.match(/\b(20[0-2]\d)-(\d{1,2})-(\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = q.match(/\b(\d{1,2})(?:st|nd|rd|th)? (january|february|march|april|may|june|july|august|september|october|november|december) (20[0-2]\d)\b/)
    || q.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2})(?:st|nd|rd|th)?,? (20[0-2]\d)\b/);
  if (!m) return null;
  const [day, mon, yr] = isNaN(+m[1]) ? [m[2], m[1], m[3]] : [m[1], m[2], m[3]];
  return `${yr}-${String(MONTHS.indexOf(mon) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function nearest(dates, iso) {
  const t = Date.parse(`${iso}T12:00:00Z`);
  let best = 0, gap = Infinity;
  dates.forEach((d, i) => { const g = Math.abs(Date.parse(`${d}T12:00:00Z`) - t); if (g < gap) { gap = g; best = i; } });
  return best;
}

export function localAnswer(question, data) {
  const q = question.toLowerCase().replace(/[’']/g, "'").trim();
  const help = (answer) => ({ weekIndex: null, date: null, focus: 'market', answer, source: 'fallback', help: true });
  if (ADVICE.test(q)) return { ...help(NO_ADVICE), help: false };

  const m = data.market, d = data.dates, fear = data.meta?.fearLabel ?? 'VIX';
  const marketName = data.meta?.name ?? 'the market';
  const missing = NOT_HERE.find((w) => new RegExp(`\\b${w}\\b`).test(q));
  let focus = findFocus(q, data);
  if (missing && focus === 'market') {
    const list = data.stocks.map((s) => s.name ?? s.ticker).join(', ');
    return help(`${missing[0].toUpperCase()}${missing.slice(1)} isn't one of the 30 companies on this planet. The companies here are: ${list}.`);
  }

  // Constraints: exact date, year, month, named event
  const exact = findDate(q);
  const ym = q.match(/\b(20[0-2]\d)\b/);
  const year = ym && +ym[1] >= 2007 && +ym[1] <= 2026 ? +ym[1] : null;
  const mi = MONTHS.findIndex((mn) => new RegExp(`\\b${mn}\\b|\\b${mn.slice(0, 3)}\\b`).test(q));
  const month = mi === -1 ? null : mi + 1;
  const event = EVENTS.find((e) => e.re.test(q));
  if (event?.focus && focus === 'market') {
    focus = event.focus === 'AI' ? (data.stocks.some((s) => s.ticker === 'NVDA') ? 'NVDA' : 'Technology') : event.focus;
  }
  let kind = INTENTS.find(([, re]) => re.test(q))?.[0] ?? null;

  const stock = data.stocks.find((s) => s.ticker === focus), sector = data.sectors.find((s) => s.name === focus);
  const own = stock ? stock.ret : sector ? sector.ret : m.ret;
  const subject = stock ? (stock.name ?? focus) : sector ? `the ${focus} sector` : `the ${marketName} market`;
  const inRange = (i) => (!year || d[i].startsWith(String(year))) && (!month || +d[i].slice(5, 7) === month)
    && (!event || year || (d[i] >= event.from && d[i] <= event.to));
  const monthName = month ? `${MONTHS[month - 1][0].toUpperCase()}${MONTHS[month - 1].slice(1)} ` : '';
  const where = event && !year ? ` during ${event.name}` : year ? ` in ${monthName}${year}` : month ? ` in ${monthName.trim()}` : '';
  const facts = (i) => ` ${subject[0].toUpperCase()}${subject.slice(1)} moved ${p(own[i])} that week; the whole market moved ${p(m.ret[i])} with ${fear} ${f(m.vix[i], 0)} and sector correlation ${f(m.avgCorr[i], 2)}.`;
  const done = (i, lead) => ({ weekIndex: i, date: d[i], focus, answer: lead + facts(i), source: 'fallback' });
  // Big weekly gains usually come in the middle of crises, as prices bounce from deep falls: say so
  const reboundNote = (i) => {
    if (m.vix[i] == null || m.vix[i] < 30) return '';
    let note = ' This was a rebound in the middle of a crisis: the biggest weekly gains usually come when fear is highest and prices have already fallen a long way.';
    if (stock) {
      const peak = Math.max(...stock.growth.slice(0, i).filter((g) => g != null));
      const below = 1 - stock.growth[i] / peak;
      if (below > 0.15) note += ` Even after this week, ${stock.name ?? focus} was still ${Math.round(below * 100)}% below its earlier peak.`;
    }
    return note;
  };

  // 1. An exact date
  if (exact) {                                   // the week (ending Friday) that contains that day
    const k = d.findIndex((x) => x >= exact);
    const i = k === -1 ? nearest(d, exact) : k;
    return done(i, `The week of ${d[i]}:`);
  }
  // 2. Now / latest
  if (kind === 'latest' && !year && !event) return done(d.length - 1, `The latest week in the data is ${d.at(-1)}.`);
  // 3. Which company grew the most / least
  if (kind === 'growthMax' || kind === 'growthMin') {
    const i = year ? Math.max(...d.map((x, k) => (x.startsWith(String(year)) ? k : -1))) : d.length - 1;
    const pool = data.stocks.filter((s) => s.growth[i] != null && (!sector || s.sector === focus));
    if (!pool.length) return help("I couldn't find growth figures for that. Try 'Which company grew the most?'");
    const s = pool.reduce((a, b) => ((kind === 'growthMax' ? b.growth[i] > a.growth[i] : b.growth[i] < a.growth[i]) ? b : a));
    focus = s.ticker;
    return { weekIndex: i, date: d[i], focus, source: 'fallback',
      answer: `${s.name ?? s.ticker} (${s.sector}) grew the ${kind === 'growthMax' ? 'most' : 'least'}${sector ? ` in ${sector.name}` : ''}: ×${s.growth[i].toFixed(1)} from 2007 to ${d[i]}${s.growth[i] < 1 ? ', a fall' : ''}.` };
  }
  // 4a. Best / worst calendar year: compound the weekly returns within each year
  if (kind === 'bestYear' || kind === 'worstYear') {
    const years = {};
    own.forEach((v, i) => { if (v != null) { const y = d[i].slice(0, 4); years[y] = (years[y] ?? 1) * (1 + v); } });
    const full = Object.entries(years).filter(([y]) => y > d[0].slice(0, 4) || d[0].endsWith('-01-05'));
    if (!full.length) return help('I found no yearly data for that.');
    const [y, g] = full.reduce((a, b) => ((kind === 'bestYear' ? b[1] > a[1] : b[1] < a[1]) ? b : a));
    const i = Math.max(...d.map((x, k) => (x.startsWith(y) ? k : -1)));
    // No single-week facts here: they would distract from the whole-year figure
    return { weekIndex: i, date: d[i], focus, source: 'fallback',
      answer: `The ${kind === 'bestYear' ? 'best' : 'worst'} calendar year for ${subject} was ${y}: ${p(g - 1)} over the year.`
        + `${y === d.at(-1).slice(0, 4) ? ' (This year is not finished yet.)' : ''} The planet now shows the last week of ${y}.` };
  }
  // 4. A question type (or the default one for a named event)
  if (!kind && event) kind = event.kind;
  const pick = (series, best) => {
    let w = -1;
    series.forEach((v, i) => { if (v != null && inRange(i) && (w === -1 || (best ? v > series[w] : v < series[w]))) w = i; });
    return w;
  };
  if (kind) {
    const map = { fear: [m.vix, true], calm: [m.vix, false], together: [m.avgCorr, true], best: [own, true], worst: [own, false] };
    const [series, best] = map[kind] ?? [own, false];
    const i = pick(series, best);
    if (i === -1) return help(`I found no data${where} for that. The planet covers ${d[0]} to ${d.at(-1)}.`);
    const lead = {
      fear: `Fear peaked${where} in the week of ${d[i]} (${fear} ${f(m.vix[i], 0)}).`,
      calm: `The calmest week${where} was ${d[i]} (${fear} ${f(m.vix[i], 0)}).`,
      together: `Sectors moved most closely together${where} in the week of ${d[i]} (correlation ${f(m.avgCorr[i], 2)}).`,
      best: `The best week for ${subject}${where} was ${d[i]}.${reboundNote(i)}`,
      worst: `The worst week for ${subject}${where} was ${d[i]}.`,
    }[kind];
    return done(i, lead);
  }
  // 5. Just a company, sector, year, month or event: its most dramatic week, plus the bigger picture
  if (focus !== 'market' || year || month || event) {
    let i = -1;
    own.forEach((v, k) => { if (v != null && inRange(k) && (i === -1 || Math.abs(v) > Math.abs(own[i]))) i = k; });
    if (i === -1) return help(`I found no data${where}. The planet covers ${d[0]} to ${d.at(-1)}.`);
    let picture = '';
    if (stock && !year && stock.growth.at(-1) != null) picture = ` Since 2007 it has grown ×${stock.growth.at(-1).toFixed(1)}.`;
    if (year || month) {
      const span = own.filter((v, k) => v != null && inRange(k));
      picture = ` Over that period ${subject} moved ${p(span.reduce((a, r) => a * (1 + r), 1) - 1)} in total.`;
    }
    return done(i, `The biggest move for ${subject}${where} was the week of ${d[i]} (${p(own[i])}).${picture}`);
  }
  return help("I couldn't match that question. I understand weeks from 2007 to 2026: crashes, best weeks, fear, calm, "
    + 'sectors moving together, a company or sector, a year, month or date, and events like COVID, Lehman, Brexit or the AI boom. '
    + 'Try one of these:');
}

/**
 * ctx: { $, data, go(weekIndex, focus), fmtDate, market }
 */
export function createAsk(ctx) {
  const { $ } = ctx;
  const form = $('askForm'), input = $('askInput'), card = $('ask'), hints = $('askHints');
  let seq = 0;
  const examples = suggestions(ctx.data);

  function chips(el, list) {
    el.replaceChildren(...list.map((text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('mousedown', (e) => e.preventDefault());   // keep focus; click still fires
      b.addEventListener('click', () => { input.value = text; hints.hidden = true; ask(text); });
      return b;
    }));
  }
  chips(hints, examples);

  function show(question, res) {
    card.style.display = 'block';
    $('askQ').textContent = `“${question}”`;
    $('askAnswer').textContent = res.answer;
    $('askLabel').textContent = res.help ? '' : res.source === 'ai' ? 'Generated by AI · checked against the data' : 'Based on the data';
    $('askWhere').textContent = res.date ? `${ctx.fmtDate(res.date)} · ${res.focus === 'market' ? 'whole market' : res.focus}` : '';
    const more = $('askMore');
    more.hidden = !res.help;
    if (res.help) chips(more, examples);
  }

  async function ask(question) {
    const my = ++seq;
    card.style.display = 'block';
    $('askQ').textContent = `“${question}”`;
    $('askAnswer').textContent = 'Searching…';
    $('askLabel').textContent = '';
    $('askWhere').textContent = '';
    $('askMore').hidden = true;
    let res = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, market: ctx.market ?? 'us' }), signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) res = await r.json();
    } catch { /* backend down or slow: answer locally */ }
    // Use the AI answer when there is one; otherwise the richer matcher in this file
    if (!res || res.source !== 'ai') {
      const local = localAnswer(question, ctx.data);
      if (!(local.help && res?.weekIndex != null)) res = local;
    }
    if (my !== seq) return;               // a newer question replaced this one
    if (res.weekIndex != null) ctx.go(res.weekIndex, res.focus);
    show(question, res);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    hints.hidden = true;
    if (q) ask(q);
  });
  input.addEventListener('focus', () => { hints.hidden = input.value.length > 0; });
  input.addEventListener('blur', () => { hints.hidden = true; });
  input.addEventListener('input', () => { hints.hidden = input.value.length > 0; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; input.blur(); card.style.display = 'none'; e.stopPropagation(); }
  });
  $('askClose').addEventListener('click', () => { card.style.display = 'none'; });
  return { ask };
}
