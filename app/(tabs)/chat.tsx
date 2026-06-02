import { type ComponentProps, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800' }}>{initials(name)}</Text>
    </View>
  );
}

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

function Row({ name, subtitle, color, icon, onPress }: { name: string; subtitle?: string | null; color: string; icon?: MaterialIconName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      {icon ? (
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={icon} size={22} color="#fff" />
        </View>
      ) : (
        <Avatar name={name} color={color} />
      )}
      <View style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 }}>
        <Text style={{ fontWeight: '700' }}>{name}</Text>
        {subtitle ? <Text style={{ color: colors.muted }} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

type DirectoryEntry = { _id: string; fullName: string; role: string; jobTitle: string };

export default function ChatScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const ensureSetup = useMutation(api.chat.ensureChatSetup);
  const openDm = useMutation(api.chat.openDm);
  const createGroup = useMutation(api.chat.createGroup);
  const conversations = useQuery(api.chat.listConversations, isReady && venue?.id ? { venueId: venue.id } : 'skip');
  const directory = useQuery(api.chat.listDirectory, isReady && venue?.id ? { venueId: venue.id } : 'skip');

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !venue?.id) return;
    setError(null);
    void ensureSetup({ venueId: venue.id }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Could not prepare chat.');
    });
  }, [isReady, venue?.id, ensureSetup]);

  const groups = conversations?.groups ?? [];
  const dms = conversations?.dms ?? [];
  const dmByName = useMemo(() => new Map(dms.map((d) => [d.title, d])), [dms]);

  const palette = accents;
  const colorFor = (i: number) => palette[i % palette.length].fg;

  // Group teammates by their position (jobTitle) for the left-hand team list.
  const byPosition = useMemo(() => {
    const map = new Map<string, DirectoryEntry[]>();
    for (const person of directory ?? []) {
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
      const id = await openDm({ venueId: venue.id, otherProfileId: otherId as Id<'profiles'> });
      router.push(`/chat/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open direct message.');
    }
  };

  const onCreateGroup = async () => {
    if (!venue?.id || !groupName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const id = await createGroup({ venueId: venue.id, name: groupName.trim() });
      setGroupName('');
      setShowNewGroup(false);
      router.push(`/chat/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create group.');
    } finally {
      setCreating(false);
    }
  };

  if (!venue?.id) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>You're not part of a venue yet. An admin or manager adds your email to their team to unlock chat.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Chat</Text>
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}

      {/* Group chats: All Staff + any custom groups, plus a way to create more. */}
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ color: colors.muted, fontWeight: '700' }}>Group chats</Text>
          <Button compact mode="text" textColor={colors.primary} icon="plus" onPress={() => setShowNewGroup((s) => !s)}>
            New group
          </Button>
        </View>
        {showNewGroup ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <TextInput
              placeholder="Group name"
              value={groupName}
              onChangeText={setGroupName}
              mode="outlined"
              style={{ flex: 1, backgroundColor: colors.surface }}
              onSubmitEditing={() => void onCreateGroup()}
            />
            <Button mode="contained" buttonColor={colors.primary} loading={creating} disabled={!groupName.trim()} onPress={() => void onCreateGroup()}>
              Create
            </Button>
          </View>
        ) : null}
        {groups.map((g) => (
          <Row key={g._id} name={g.title} subtitle={g.lastMessageText ?? 'Tap to open the group chat'} color={colors.primary} icon="account-group" onPress={() => router.push(`/chat/${g._id}`)} />
        ))}
      </View>

      {/* Direct messages already in progress */}
      {dms.length > 0 ? (
        <View>
          <Text style={{ color: colors.muted, fontWeight: '700', marginBottom: 4 }}>Direct messages</Text>
          {dms.map((d, i) => (
            <Row key={d._id} name={d.title} subtitle={d.lastMessageText} color={colorFor(i)} onPress={() => router.push(`/chat/${d._id}`)} />
          ))}
        </View>
      ) : null}

      {/* Team, grouped by position. Tap a teammate to open (or start) a DM. */}
      <View>
        <Text style={{ color: colors.muted, fontWeight: '700', marginBottom: 4 }}>Team</Text>
        {directory === undefined ? (
          <Text style={{ color: colors.muted }}>Loading teammates…</Text>
        ) : byPosition.length === 0 ? (
          <Text style={{ color: colors.muted }}>No teammates yet. Add staff from the Staff tab.</Text>
        ) : (
          byPosition.map(([position, people], gi) => (
            <View key={position} style={{ marginBottom: spacing.sm }}>
              <Text style={{ color: colors.primary, fontWeight: '800', marginTop: 4, marginBottom: 2 }}>{position}</Text>
              {people.map((person, i) => {
                const existingDm = dmByName.get(person.fullName);
                return (
                  <Row
                    key={person._id}
                    name={person.fullName}
                    subtitle={person.role}
                    color={colorFor(gi + i + 2)}
                    onPress={() => (existingDm ? router.push(`/chat/${existingDm._id}`) : void startDm(person._id))}
                  />
                );
              })}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}
