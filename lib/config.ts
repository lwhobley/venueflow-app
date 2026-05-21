// Centralized runtime feature flags.
//
// Billing is OFF by default: the in-app purchase layer is not wired to a real
// IAP provider yet (see lib/a0-purchases-stub.tsx). Until it is, the
// SubscriptionGate must not hard-lock users out of the app. Flip this on by
// setting EXPO_PUBLIC_BILLING_ENABLED=true once real purchases are connected.

function readEnvFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value === 'true' || value === '1';
}

export const config = {
  billingEnabled: readEnvFlag(process.env.EXPO_PUBLIC_BILLING_ENABLED, false),
};
