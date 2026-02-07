export interface OutcomeMapping {
  YES: string;  // Original affirmative outcome name
  NO: string;   // Original negative outcome name
}

export function normalizeOutcomes(
  outcomes: string[],
  question: string
): OutcomeMapping | null {
  if (outcomes.length !== 2) return null; // Only binary markets

  const affirmativeIndex = detectAffirmativeOutcome(outcomes, question);
  const negativeIndex = affirmativeIndex === 0 ? 1 : 0;

  return {
    YES: outcomes[affirmativeIndex],
    NO: outcomes[negativeIndex]
  };
}

function detectAffirmativeOutcome(outcomes: string[], question: string): number {
  const affirmativeKeywords = ['YES', 'TRUE', 'WIN', 'UP', 'OVER', 'SUCCESS'];
  const firstNormalized = outcomes[0].toUpperCase();

  // Exact match on affirmative keywords
  if (affirmativeKeywords.some(kw => firstNormalized === kw)) return 0;

  // Check if question mentions first outcome (e.g., "Will AFC win?" → AFC is affirmative)
  if (question.toUpperCase().includes(outcomes[0].toUpperCase())) return 0;

  // Default: first outcome is affirmative
  return 0;
}

// Helper: get original outcome from canonical YES/NO
export function getOriginalOutcome(
  outcomeMapping: OutcomeMapping | null,
  canonical: 'YES' | 'NO'
): string {
  return outcomeMapping?.[canonical] ?? canonical;
}
