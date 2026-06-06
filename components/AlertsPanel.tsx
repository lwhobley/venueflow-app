import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandSurface, CommandText, StatusPill } from './FutureUI';
import type { DesignPalette } from '../lib/theme';
import { spacing } from '../lib/theme';
import type { Id } from '../lib/ids';

type NotificationItem = {
  _id: Id<'notificationEvents'>;
  title: string;
  body: string;
  read: boolean;
};

export function AlertsPanel({
  palette,
  notifications,
  onClose,
  onMarkRead,
  onMarkAllRead,
}: {
  palette: DesignPalette;
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkRead: (notificationId: Id<'notificationEvents'>) => void;
  onMarkAllRead: () => void;
}) {
  const unreadCount = notifications.filter((item) => !item.read).length;

  return (
    <CommandSurface palette={palette} strong style={{ gap: spacing.md, borderColor: unreadCount ? palette.warning : palette.primary }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <CommandText palette={palette} variant="label">Alerts</CommandText>
          <CommandText palette={palette} variant="title">Notification center</CommandText>
          <CommandText palette={palette} variant="caption">
            {unreadCount ? `${unreadCount} unread alert${unreadCount === 1 ? '' : 's'} need attention.` : 'No unread alerts right now.'}
          </CommandText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'flex-end' }}>
          {unreadCount ? <CommandButton palette={palette} icon="check-all" onPress={onMarkAllRead}>Mark all</CommandButton> : null}
          <CommandButton palette={palette} icon="close" onPress={onClose}>Close</CommandButton>
        </View>
      </View>

      {notifications.length === 0 ? (
        <View style={{ padding: spacing.md, borderRadius: 10, backgroundColor: palette.surfaceSoft, gap: spacing.xs }}>
          <MaterialCommunityIcons name="bell-check-outline" size={22} color={palette.primary} />
          <CommandText palette={palette} variant="body">You are all caught up.</CommandText>
          <CommandText palette={palette} variant="caption">Schedule, reservation, clock, and request alerts will appear here.</CommandText>
        </View>
      ) : (
        notifications.slice(0, 8).map((item) => (
          <View
            key={item._id}
            style={{
              flexDirection: 'row',
              gap: spacing.sm,
              padding: spacing.md,
              borderRadius: 10,
              backgroundColor: item.read ? palette.surfaceSoft : `${palette.warning}18`,
              borderWidth: item.read ? 0 : 1,
              borderColor: item.read ? 'transparent' : `${palette.warning}66`,
            }}
          >
            <MaterialCommunityIcons name={item.read ? 'bell-outline' : 'bell-ring-outline'} size={20} color={item.read ? palette.muted : palette.warning} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' }}>
                <CommandText palette={palette} variant="body" style={{ flex: 1, fontWeight: item.read ? '600' : '900' }}>{item.title}</CommandText>
                {!item.read ? <StatusPill palette={palette} tone="warn">Unread</StatusPill> : null}
              </View>
              <CommandText palette={palette} variant="caption">{item.body}</CommandText>
              {!item.read ? (
                <CommandButton palette={palette} icon="check" onPress={() => onMarkRead(item._id)} style={{ alignSelf: 'flex-start' }}>
                  Mark read
                </CommandButton>
              ) : null}
            </View>
          </View>
        ))
      )}
    </CommandSurface>
  );
}
