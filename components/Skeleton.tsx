import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { colors } from '../lib/theme';

export function Skeleton({
  width = '100%',
  height = 16,
  style,
}: {
  width?: number | string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ width, height, borderRadius: 12, backgroundColor: colors.border }, style]} />;
}