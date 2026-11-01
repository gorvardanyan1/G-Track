export type BudgetTone = 'none' | 'ok' | 'warning' | 'over';

export interface BudgetUsage {
  /** Used share of the budget (1 = exactly used up); null without a budget. */
  ratio: number | null;
  /** Rounded percentage for display; null without a budget. */
  percent: number | null;
  tone: BudgetTone;
  /** Seconds left (negative when over); null without a budget. */
  remainingSeconds: number | null;
}

/** From 80 % used the bar turns amber; past 100 % it turns red. */
export const BUDGET_WARNING_RATIO = 0.8;

export function budgetUsage(usedSeconds: number, budgetHours: number | null): BudgetUsage {
  if (budgetHours === null || budgetHours <= 0)
    return { ratio: null, percent: null, tone: 'none', remainingSeconds: null };
  const budgetSeconds = Math.round(budgetHours * 3600);
  const ratio = usedSeconds / budgetSeconds;
  return {
    ratio,
    percent: Math.round(ratio * 100),
    tone: ratio > 1 ? 'over' : ratio >= BUDGET_WARNING_RATIO ? 'warning' : 'ok',
    remainingSeconds: budgetSeconds - usedSeconds,
  };
}
