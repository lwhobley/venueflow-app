import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { colors } from '../lib/theme';

/**
 * Scrollable screen that behaves correctly while the keyboard is up.
 *
 * Only the (auth) stack and chat detail handled this; every in-app form used a
 * bare ScrollView, which produced two bugs on every one of them:
 *
 *   - Occlusion. On iOS a ScrollView does not adjust its content inset for the
 *     keyboard unless `automaticallyAdjustKeyboardInsets` is set, so fields in
 *     the lower half of a form — and the save button — sat behind it with no
 *     way to scroll to them.
 *   - The swallowed first tap. Without `keyboardShouldPersistTaps="handled"`,
 *     the first tap on any control while the keyboard is open is consumed
 *     dismissing it, so Save appeared to do nothing until pressed twice.
 */
export function FormScreen({
  children,
  contentContainerStyle,
  style,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1, backgroundColor: colors.background }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={contentContainerStyle}
        // Lets a press reach the control on the first tap instead of being
        // consumed dismissing the keyboard.
        keyboardShouldPersistTaps="handled"
        // iOS: inset the scroll content by the keyboard's height.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
