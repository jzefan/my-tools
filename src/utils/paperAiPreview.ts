/** Pricing copied from reader's 2026-10-08 configuration, not a live quotation. */
const prices: Record<string, [number, number]> = {
  'deepseek-flash': [.15, .60], 'deepseek-v4-pro': [.66, 1.98],
  'qwen3.8-max': [1.79, 5.37], 'qwen3.7-plus': [.30, 1.19], 'qwen3.8-flash': [.12, .40],
};
export function paperAiPreview(model: string, characters: number, screenshots = 0) {
  const tokens = Math.ceil(characters / 2.5) + screenshots * 1600;
  const pricing = prices[model];
  return { tokens, maximumOutputTokens: 8192, pricingAsOf: '2026-10-08',
    estimatedMaximumUsd: pricing ? (tokens * pricing[0] + 8192 * pricing[1]) / 1_000_000 : undefined };
}
