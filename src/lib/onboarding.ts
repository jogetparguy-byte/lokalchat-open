export const teamSizes = ["Just me", "2–10 people", "11–50 people", "51–200 people", "201+ people"] as const;
export const useCases = ["Customer support", "Sales enquiries", "Order updates", "Something else"] as const;
export const referralSources = ["Google or another search engine", "Social media", "A friend or colleague", "GitHub or npm", "Somewhere else"] as const;

export type OnboardingAnswers = {
  full_name: string;
  team_size: string;
  use_case: string;
  referral_source: string;
};

// Allow older installers to register without the new onboarding payload.
export function parseOnboarding(value: unknown): OnboardingAnswers | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Maklumat akaun tidak sah.");
  const data = value as Partial<Record<keyof OnboardingAnswers, unknown>>;
  if (typeof data.full_name !== "string" || !data.full_name.trim() || data.full_name.trim().length > 160
    || !teamSizes.includes(data.team_size as typeof teamSizes[number])
    || !useCases.includes(data.use_case as typeof useCases[number])
    || !referralSources.includes(data.referral_source as typeof referralSources[number])) {
    throw new Error("Maklumat akaun tidak sah.");
  }
  return { full_name: data.full_name.trim(), team_size: data.team_size as string, use_case: data.use_case as string, referral_source: data.referral_source as string };
}
