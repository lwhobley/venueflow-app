import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

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
    <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800' }}>{initials(name)}</Text>
    </View>
  );
}

function Row({ name, subtitle, color, icon, onPress }: { name: string; subtitle?: string | null; color: string; icon?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      {icon ? (
        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={icon as any} size={22} color="#fff" />
        </View>
      ) : (
        <Avatar name={name} color={color} />
      )}
      <View style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 10 }}>
        <Text style={{ fontWeight: '700' }}>{name}</Text>
        {subtitle ? <Text style={{ color: colors.muted }} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

export default function ChatScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const ensureSetup = useMutation(api.chat.ensureChatSetup);
  const openDm = useMutation(api.chat.openDm);
  const conversations = useQuery(api.chat.listConversations, venue?.id ? { venueId: venue.id } : 'skip');
  const directory = useQuery(api.chat.listDirectory, venue?.id ? { venueId: venue.id } : 'skip');

  useEffect(() => {
    if (venue?.id) void ensureSetup({ venueId: venue.id });
  }, [venue?.id, ensureSetup]);

  const groups = conversations?.groups ?? [];
  const dms = conversations?.dms ?? [];
  const dmNames = useMemo(() => new Set(dms.map((d) => d.title)), [dms]);
  const newPeople = (directory ?? []).filter((u) => !dmNames.has(u.fullName));

  const palette = accents;
  const colorFor = (i: number) => palette[i % palette.length].fg;

  const startDm = async (otherId: string) => {
    if (!venue?.id) return;
    const id = await openDm({ venueId: venue.id, otherProfileId: otherId as Id<'profiles'> });
    router.push(`/chat/${id}`);
  };

  if (!venue?.id) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>No venue assigned yet.</Text>
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

      {/* Groups */}
      <View>
        <Text style={{ color: colors.muted, fontWeight: '700', marginBottom: 4 }}>GROUPS</Text>
        {groups.map((g) => (
          <Row key={g._id} name={g.title} subtitle={g.lastMessageText ?? 'Tap to open the team chat'} color={colors.primary} icon="account-group" onPress={() => router.push(`/chat/${g._id}`)} />
        ))}
      </View>

      {/* Active DMs */}
      {dms.length > 0 ? (
        <View>
          <Text style={{ color: colors.muted, fontWeight: '700', marginBottom: 4 }}>DIRECT MESSAGES</Text>
          {dms.map((d, i) => (
            <Row key={d._id} name={d.title} subtitle={d.lastMessageText} color={colorFor(i)} onPress={() => router.push(`/chat/${d._id}`)} />
          ))}
        </View>
      ) : null}

      {/* Directory to start new chats */}
      <View>
        <Text style={{ color: colors.muted, fontWeight: '700', marginBottom: 4 }}>START A CHAT</Text>
        {directory === undefined ? (
          <Text style={{ color: colors.muted }}>Loading teammates…</Text>
        ) : newPeople.length === 0 ? (
          <Text style={{ color: colors.muted }}>Everyone is in your message list. Add teammates from the Staff tab.</Text>
        ) : (
          newPeople.map((u, i) => (
            <Row key={u._id} name={u.fullName} subtitle={`${u.role} · ${u.jobTitle}`} color={colorFor(i + 2)} onPress={() => void startDm(u._id)} />
          ))
        )}
      </View>
    </ScrollView>
  );
}
