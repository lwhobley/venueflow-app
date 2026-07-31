// Per-user intro access helpers. The access window is stored on the profile
// (trialEndsAt) by the backend. During intro access users can browse everything
// except premium features (Integrations, CRM). After it expires all features are
// locked until they upgrade.

export type TrialState = {
  active: boolean;
  expired: boolean;
  daysLeft: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function getTrialState(trialEndsAt: number | null | undefined): TrialState {
  if (trialEndsAt == null) {
    return { active: false, expired: false, daysLeft: 0 };
  }
  const remaining = trialEndsAt - Date.now();
  const active = remaining > 0;
  return {
    active,
    expired: !active,
    daysLeft: Math.max(0, Math.ceil(remaining / DAY_MS)),
  };
}
