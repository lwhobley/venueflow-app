import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Menu, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../lib/theme';

export type ProviderOption<T extends string> = { value: T; label: string };

/**
 * Anchor-button dropdown for selecting one of N providers (POS, payroll, etc).
 * A dropdown scales to long lists where the chip-cloud pattern wraps awkwardly,
 * and matches what users expect on a desktop layout.
 */
export function ProviderDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<ProviderOption<T>>;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Text>
      <Menu
        visible={open}
        onDismiss={() => setOpen(false)}
        anchor={
          <Pressable
            disabled={disabled}
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${current?.label ?? value}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.sm,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              backgroundColor: colors.surface,
              paddingHorizontal: spacing.md,
              paddingVertical: 12,
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <Text style={{ color: colors.charcoal, fontSize: 14, fontWeight: '600' }}>
              {current?.label ?? value}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={20} color={colors.muted} />
          </Pressable>
        }
      >
        {options.map((option) => (
          <Menu.Item
            key={option.value}
            onPress={() => {
              onChange(option.value);
              setOpen(false);
            }}
            title={option.label}
            leadingIcon={option.value === value ? 'check' : undefined}
          />
        ))}
      </Menu>
    </View>
  );
}
