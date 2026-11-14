// "What if?" stress-test sandbox.
// Shock one sector and see how the others would likely react, using betas from
// public/stress.json (built by build_world.py from daily sector returns, split by VIX regime).
// Model: move[j] = beta[shocked][j] × shock, clamped to ±100%; the shocked sector moves by exactly shock.
// Works fully offline (no backend).

const pct = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(0)}%`;

export function predictMoves(stress, regime, shocked, shock) {
  const beta = stress.regimes[regime].beta[shocked];
  const moves = {};
  for (const s of stress.sectors) {
    moves[s] = s === shocked ? shock : Math.max(-1, Math.min(1, beta[s] * shock));
  }
  return moves;
}

// One sentence comparing regimes, computed from the data
export function headline(stress, shocked, shock) {
  const calm = predictMoves(stress, 'calm', shocked, shock);
  const crisis = predictMoves(stress, 'crisis', shocked, shock);
  const others = stress.sectors.filter((s) => s !== shocked);
  const j = others.reduce((a, b) => (Math.abs(crisis[b]) > Math.abs(crisis[a]) ? b : a));
  const verb = shock < 0 ? 'drags' : 'lifts';
  const link = Math.abs(crisis[j]) > Math.abs(calm[j]) ? 'but' : 'and';
  const article = /^[AEIOU]/i.test(shocked) ? 'An' : 'A';
  return `${article} ${shocked} ${pct(shock)} shock ${verb} ${j} ${pct(calm[j])} in calm times, ${link} ${pct(crisis[j])} in a crisis.`;
}

/**
 * ctx: { stress, $, enter(), exit(), apply(moves, regime) }
 *   enter(): pause playback and remember the week · exit(): return to it
 *   apply(moves, regime): show predicted moves on the planet
 */
export function createSandbox(ctx) {
  const { $, stress } = ctx;
  const ui = { sector: $('wiSector'), shock: $('wiShock'), shockVal: $('wiShockVal'), bars: $('wiBars'),
    headline: $('wiHeadline'), panel: $('whatif'), calm: $('wiCalm'), crisis: $('wiCrisis') };
  let regime = 'crisis', active = false;

  for (const s of stress.sectors) {
    const o = document.createElement('option');
    o.value = o.textContent = s;
    ui.sector.appendChild(o);
  }
  ui.sector.value = stress.sectors.includes('Energy') ? 'Energy' : stress.sectors[0];

  function render() {
    const shocked = ui.sector.value, shock = Number(ui.shock.value) / 100;
    ui.shockVal.textContent = pct(shock);
    ui.calm.setAttribute('aria-pressed', String(regime === 'calm'));
    ui.crisis.setAttribute('aria-pressed', String(regime === 'crisis'));
    const moves = predictMoves(stress, regime, shocked, shock);
    const sorted = Object.entries(moves).sort((a, b) => a[1] - b[1]);
    const max = Math.max(0.05, ...sorted.map(([, v]) => Math.abs(v)));
    ui.bars.innerHTML = sorted.map(([s, v]) => `
      <div class="wi-row${s === shocked ? ' shocked' : ''}">
        <span class="wi-name">${s}</span>
        <span class="wi-track"><span class="wi-bar ${v < 0 ? 'down' : 'up'}" style="width:${(Math.abs(v) / max) * 100}%"></span></span>
        <span class="wi-val ${v < 0 ? 'down' : 'up'}">${pct(v)}</span>
      </div>`).join('');
    ui.headline.textContent = headline(stress, shocked, shock);
    ctx.apply(moves, regime);
  }

  function open() {
    if (active) return;
    active = true;
    ctx.enter();
    ui.panel.style.display = 'block';
    for (const id of ['week', 'tour', 'info']) $(id).dataset.hiddenBySandbox = $(id).style.display = 'none';
    render();
  }
  function close() {
    if (!active) return;
    active = false;
    ui.panel.style.display = 'none';
    $('week').style.display = '';
    ctx.exit();
  }

  ui.sector.addEventListener('change', render);
  ui.shock.addEventListener('input', render);
  ui.calm.addEventListener('click', () => { regime = 'calm'; render(); });
  ui.crisis.addEventListener('click', () => { regime = 'crisis'; render(); });
  $('wiExit').addEventListener('click', close);
  $('whatIfBtn').addEventListener('click', () => (active ? close() : open()));
  return { open, close, isActive: () => active };
}
