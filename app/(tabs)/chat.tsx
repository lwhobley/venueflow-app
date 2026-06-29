import { memo, type ComponentProps, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, HelperText, IconButton, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageVenue } from '../../lib/permissions';

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type FilterKey = 'all' | 'direct' | 'groups' | 'shifts';
type ConversationRow = {
  _id: string;
  title: string;
  type?: string;
  lastMessageText?: string | null;
  lastMessageAt?: number | null;
  unread?: boolean;
};
type DirectoryEntry = { _id: string; fullName: string; role: string; jobTitle: string };

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'direct', label: 'Direct' },
  { key: 'groups', label: 'Groups' },
  { key: 'shifts', label: 'Shifts' },
];

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatRelativeTime(value?: number | null) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function colorFor(index: number) {
  return accents[index % accents.length].fg;
}

const ConversationListRow = memo(function ConversationListRow({
  row,
  index,
  icon,
  subtitle,
  onPress,
  onDelete,
}: {
  row: ConversationRow;
  index: number;
  icon?: MaterialIconName;
  subtitle?: string | null;
  onPress: () => void;
  onDelete?: () => void;
}) {
  const accent = colorFor(index);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.md,
          opacity: pressed ? 0.78 : 1,
        })}
      >
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
          {icon ? (
            <MaterialCommunityIcons name={icon} size={22} color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: '900' }}>{initials(row.title)}</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text numberOfLines={1} style={{ flex: 1, color: colors.charcoal, fontSize: 15, fontWeight: row.unread ? '900' : '700' }}>
              {row.title}
            </Text>
            {row.lastMessageAt ? (
              <Text style={{ color: row.unread ? colors.primary : colors.muted, fontSize: 11, fontWeight: '700' }}>
                {formatRelativeTime(row.lastMessageAt)}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: row.unread ? colors.primary : colors.muted, fontSize: 13, fontWeight: row.unread ? '700' : '400' }}>
              {subtitle ?? row.lastMessageText ?? 'No messages yet'}
            </Text>
            {row.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} /> : null}
          </View>
        </View>
      </Pressable>
      {onDelete ? <IconButton icon="delete-outline" iconColor={colors.danger} onPress={onDelete} /> : null}
    </View>
  );
});

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.charcoal, fontSize: 16, fontWeight: '900' }}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export default function ChatScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const ensureSetup = useMutation(api.chat.ensureChatSetup);
  const openDm = useMutation(api.chat.openDm);
  const createGroup = useMutation(api.chat.createGroup);
  const deleteConversation = useMutation(api.chat.deleteConversation);
  const conversations = useQuery(api.chat.listConversations, isReady && venue?.id ? { venueId: venue.id } : 'skip');
  const directory = useQuery(api.chat.listDirectory, isReady && venue?.id ? { venueId: venue.id } : 'skip');

  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !venue?.id) return;
    setError(null);
    void ensureSetup({ venueId: venue.id }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Could not prepare chat.');
    });
  }, [ensureSetup, isReady, venue?.id]);

  const groups = (conversations?.groups ?? []) as ConversationRow[];
  const dms = (conversations?.dms ?? []) as ConversationRow[];
  const roles = (conversations?.roles ?? []) as ConversationRow[];
  const shifts = (conversations?.shifts ?? []) as ConversationRow[];
  const canManage = Boolean(me && canManageVenue(me.profile.role, me.profile.allAccess));
  const unreadCount = [...groups, ...dms, ...roles, ...shifts].filter((row) => row.unread).length;

  const dmByName = useMemo(() => new Map(dms.map((dm) => [dm.title, dm])), [dms]);
  const byPosition = useMemo(() => {
    const map = new Map<string, DirectoryEntry[]>();
    for (const person of (directory ?? []) as DirectoryEntry[]) {
      const key = person.jobTitle?.trim() || 'Team';
      const list = map.get(key) ?? [];
      list.push(person);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [directory]);

  const startDm = async (otherId: string) => {
    if (!venue?.id) return;
    setError(null);
    try {
      const result = await openDm({ venueId: venue.id, targetProfileId: otherId as Id<'profiles'> });
      router.push(`/chat/${result?.conversationId ?? result}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open direct message.');
    }
  };

  const onCreateGroup = async () => {
    if (!venue?.id || !groupName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createGroup({ venueId: venue.id, name: groupName.trim() });
      setGroupName('');
      setShowNewGroup(false);
      router.push(`/chat/${result?.conversationId ?? result}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create group.');
    } finally {
      setCreating(false);
    }
  };

  const onDeleteConversation = async (conversationId: string) => {
    setError(null);
    try {
      await deleteConversation({ conversationId: conversationId as Id<'conversations'> });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete chat.');
    }
  };

  if (!venue?.id) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center' }}>
        <Text style={{ color: colors.charcoal, fontSize: 18, fontWeight: '900', textAlign: 'center' }}>Chat unlocks after you join a venue</Text>
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: spacing.sm }}>Ask an admin or manager to add your email to their team.</Text>
      </View>
    );
  }

  const showDirect = activeFilter === 'all' || activeFilter === 'direct';
  const showGroups = activeFilter === 'all' || activeFilter === 'groups';
  const showShifts = activeFilter === 'all' || activeFilter === 'shifts';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: spacing.xs }}>
        <Text variant="headlineMedium" style={{ color: colors.charcoal, fontWeight: '900' }}>Chat</Text>
        <Text style={{ color: colors.muted }}>{unreadCount ? `${unreadCount} unread conversation${unreadCount === 1 ? '' : 's'}` : 'All caught up'}</Text>
      </View>

      <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceSoft, borderRadius: radius.md, padding: 3, gap: 3 }}>
        {FILTERS.map((filter) => {
          const active = activeFilter === filter.key;
          return (
            <Pressable
              key={filter.key}
              onPress={() => setActiveFilter(filter.key)}
              style={{
                flex: 1,
                minHeight: 36,
                borderRadius: radius.sm,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.surface : 'transparent',
                borderWidth: active ? 1 : 0,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: active ? colors.primary : colors.muted, fontWeight: '800', fontSize: 12 }}>{filter.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <HelperText type="error" visible>{error}</HelperText> : null}

      {showShifts && roles.length + shifts.length > 0 ? (
        <Section title="Operations channels">
          {roles.map((row, index) => (
            <ConversationListRow
              key={row._id}
              row={row}
              index={index}
              icon="pound"
              subtitle={row.lastMessageText ?? 'Role updates and quick handoffs'}
              onPress={() => router.push(`/chat/${row._id}`)}
            />
          ))}
          {shifts.map((row, index) => (
            <ConversationListRow
              key={row._id}
              row={row}
              index={index + 3}
              icon="clock-outline"
              subtitle={row.lastMessageText ?? "Today's shift crew"}
              onPress={() => router.push(`/chat/${row._id}`)}
            />
          ))}
        </Section>
      ) : null}

      {showGroups ? (
        <Section
          title="Group chats"
          action={
            <Button compact mode="text" textColor={colors.primary} icon="plus" onPress={() => setShowNewGroup((value) => !value)}>
              New
            </Button>
          }
        >
          {showNewGroup ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.xs }}>
              <TextInput
                placeholder="Group name"
                value={groupName}
                onChangeText={setGroupName}
                mode="outlined"
                dense
                style={{ flex: 1, backgroundColor: colors.surface }}
                onSubmitEditing={() => void onCreateGroup()}
              />
              <IconButton
                icon="check"
                mode="contained"
                containerColor={colors.primary}
                iconColor="#fff"
                disabled={!groupName.trim() || creating}
                onPress={() => void onCreateGroup()}
              />
            </View>
          ) : null}
          {groups.length ? (
            groups.map((row, index) => (
              <ConversationListRow
                key={row._id}
                row={row}
                index={index + 1}
                icon="account-group"
                subtitle={row.lastMessageText ?? 'Tap to open the group chat'}
                onPress={() => router.push(`/chat/${row._id}`)}
                onDelete={canManage ? () => void onDeleteConversation(row._id) : undefined}
              />
            ))
          ) : (
            <Text style={{ color: colors.muted }}>No group chats yet.</Text>
          )}
        </Section>
      ) : null}

      {showDirect && dms.length > 0 ? (
        <Section title="Direct messages">
          {dms.map((row, index) => (
            <ConversationListRow
              key={row._id}
              row={row}
              index={index}
              onPress={() => router.push(`/chat/${row._id}`)}
              onDelete={canManage ? () => void onDeleteConversation(row._id) : undefined}
            />
          ))}
        </Section>
      ) : null}

      {showDirect ? (
        <Section title="Team directory">
          {directory === undefined ? (
            <Text style={{ color: colors.muted }}>Loading teammates...</Text>
          ) : byPosition.length === 0 ? (
            <Text style={{ color: colors.muted }}>No teammates yet. Add staff from the Staff tab.</Text>
          ) : (
            byPosition.map(([position, people], groupIndex) => (
              <View key={position} style={{ gap: spacing.xs }}>
                <Text style={{ color: colors.primary, fontWeight: '900', marginTop: spacing.xs }}>{position}</Text>
                {people.map((person, index) => {
                  const existingDm = dmByName.get(person.fullName);
                  return (
                    <ConversationListRow
                      key={person._id}
                      row={{ _id: person._id, title: person.fullName, lastMessageText: person.role }}
                      index={groupIndex + index + 2}
                      onPress={() => (existingDm ? router.push(`/chat/${existingDm._id}`) : void startDm(person._id))}
                    />
                  );
                })}
              </View>
            ))
          )}
        </Section>
      ) : null}
    </ScrollView>
  );
}
