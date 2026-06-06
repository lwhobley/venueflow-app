export type SubscriptionRequiredReason =
  | 'trial_expired'
  | 'trial_active'
  | 'payment_failed'
  | 'cancelled'
  | 'never_subscribed';
