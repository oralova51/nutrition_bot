import { describe, expect, it } from 'vitest';
import { selectProposalsToSend } from './proposal-selection.js';
import type { RecommendationProposal } from './types.js';

function proposal(
  partial: Pick<RecommendationProposal, 'criterion' | 'priority'>,
): RecommendationProposal {
  return {
    id: partial.criterion,
    type: 'habit',
    rationale: 'test',
    draftText: 'test',
    ...partial,
  };
}

describe('selectProposalsToSend', () => {
  it('sends at most one recommendation per diary entry', () => {
    const selected = selectProposalsToSend(
      [
        proposal({ criterion: 'water', priority: 'medium' }),
        proposal({ criterion: 'protein_deficit', priority: 'high' }),
        proposal({ criterion: 'vegetables_fiber_deficit', priority: 'medium' }),
      ],
      3,
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.criterion).toBe('protein_deficit');
  });

  it('respects remaining daily slots', () => {
    const selected = selectProposalsToSend(
      [proposal({ criterion: 'water', priority: 'medium' })],
      0,
    );
    expect(selected).toHaveLength(0);
  });
});
