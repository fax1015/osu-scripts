export const DEFAULT_MANIA_SCROLL_SPEED = 28;
export const DEFAULT_MANIA_SCROLL_SCALE_WITH_BPM = false;

export const calculateManiaScrollTimeMs = (speed, bpm, scaleWithBpm) => {
  const base = (16 * 1000) / (speed || 28);
  if (!scaleWithBpm) return base;
  return base * (120 / (bpm || 120));
};

export const normalizePreviewSettings = (overrides = {}) => {
  return {
    providerOverride: null,
    audioVolume: 0,
    maniaScrollSpeed: DEFAULT_MANIA_SCROLL_SPEED,
    maniaScaleScrollSpeedWithBpm: DEFAULT_MANIA_SCROLL_SCALE_WITH_BPM,
    standardSnakingSliders: true,
    standardSliderEndCircles: false,
    ...overrides,
  };
};
