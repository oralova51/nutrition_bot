import type { RecommendationPriority, RecommendationProposal } from './types.js';

export const MAX_DAILY_RECOMMENDATIONS = 3;
/** Одна рекомендация на запись, иначе первая еда за день превращается в пачку сообщений. */
export const MAX_RECOMMENDATIONS_PER_ENTRY = 1;

const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function selectProposalsToSend(
  proposals: RecommendationProposal[],
  availableDailySlots: number,
  maxPerEntry = MAX_RECOMMENDATIONS_PER_ENTRY,
): RecommendationProposal[] {
  const limit = Math.max(0, Math.min(maxPerEntry, availableDailySlots));
  return sortProposalsByPriority(proposals).slice(0, limit);
}

export function sortProposalsByPriority(
  proposals: RecommendationProposal[],
): RecommendationProposal[] {
  return [...proposals].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
