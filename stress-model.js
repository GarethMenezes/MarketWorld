// Simple historical linear model. Returns are fractions, not percentages.
const clampMove = (value) => Math.max(-1, Math.min(1, value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const percent = (value) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${Math.abs(value * 100).toFixed(1).replace(/\.0$/, '')}%`;

export function simulateShock(stress, shockedSector, shock, regime) {
  const sectors = Array.isArray(stress?.sectors) ? stress.sectors : [];
  if (!sectors.includes(shockedSector) || !finite(shock) || shock < -1 || shock > 1) return [];
  const coefficients = stress?.regimes?.[regime]?.beta?.[shockedSector] || {};
  return sectors.map((sector) => {
    const beta = sector === shockedSector ? 1 : coefficients[sector];
    const available = finite(beta);
    return { sector, beta: available ? beta : null, move: available ? (sector === shockedSector ? shock : clampMove(beta * shock)) : null, available };
  }).sort((a, b) => (a.move === null) - (b.move === null) || (a.move ?? 0) - (b.move ?? 0));
}

export function compareShockRegimes(stress, shockedSector, shock) {
  const calm = simulateShock(stress, shockedSector, shock, 'calm');
  const crisis = new Map(simulateShock(stress, shockedSector, shock, 'crisis').map((row) => [row.sector, row]));
  let comparison = null;
  for (const row of calm) {
    const other = crisis.get(row.sector);
    if (row.sector === shockedSector || !row.available || !other?.available) continue;
    const difference = Math.abs(other.move - row.move);
    if (!comparison || difference > comparison.difference) comparison = { sector: row.sector, calm: row.move, crisis: other.move, difference };
  }
  if (!comparison) return 'There is not enough historical data to compare these regimes.';
  const article = /^[aeiou]/i.test(shockedSector) ? 'An' : 'A';
  return `${article} ${shockedSector} ${percent(shock)} shock maps to ${comparison.sector} ${percent(comparison.calm)} in calm times and ${percent(comparison.crisis)} in a crisis in this historical model.`;
}
