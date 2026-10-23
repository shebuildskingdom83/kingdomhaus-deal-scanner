export const founderDecisionChoices = ["Continue Reviewing", "Pursue", "Hold", "Pass"] as const;

export type FounderDecision = {
  decision: (typeof founderDecisionChoices)[number] | null;
  rationale: string;
  nextDiligenceAction: string;
};

export const createFounderDecision = (): FounderDecision => ({
  decision: null,
  rationale: "",
  nextDiligenceAction: ""
});

export const founderDecisionOf = (value?: FounderDecision): FounderDecision => value ?? createFounderDecision();
export const founderDecisionLabel = (value?: FounderDecision): string => founderDecisionOf(value).decision ?? "Not Yet Decided";
export const founderDecisionDisplayLabel = (value?: FounderDecision): string => {
  const decision = founderDecisionOf(value).decision;
  return decision === "Continue Reviewing" ? "Reviewing" : decision ?? "Undecided";
};
