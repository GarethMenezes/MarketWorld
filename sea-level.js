// Correlation controls a visual sea level, not a physical elevation in metres.
export const SEA_CONFIG = Object.freeze({
  corrLow: 0.3,
  corrHigh: 0.85,
  normal: 0,
  lowest: -0.065,
  seconds: 1.2,
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Missing correlation has no sea-level target; callers must handle it explicitly. */
export function seaLevelFromCorrelation(correlation, config = SEA_CONFIG) {
  if (!Number.isFinite(correlation)) return null;
  const drop = clamp01((correlation - config.corrLow) / (config.corrHigh - config.corrLow));
  return config.normal + drop * (config.lowest - config.normal);
}

/** Fraction of the configured visual fall: 0 = normal, 1 = lowest. */
export function seaDropFraction(level, config = SEA_CONFIG) {
  if (!Number.isFinite(level)) return null;
  return clamp01((config.normal - level) / (config.normal - config.lowest));
}
