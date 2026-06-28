import { Text } from 'react-native-paper';
import { colors } from '../lib/theme';

// Centralizes the inline status-message tone that was duplicated (inconsistently)
// across screens — some checked for "required", some didn't. A message reads as an
// error (danger color) when it looks like a failure; otherwise it's a neutral notice.
// One place to later map raw server messages to friendlier copy.
const ERROR_HINTS = /\b(could|couldn't|cannot|can't|fail|failed|invalid|required|denied|error|not\s)/i;

export function InlineMessage({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <Text style={{ color: ERROR_HINTS.test(message) ? colors.danger : colors.muted }}>{message}</Text>;
}
