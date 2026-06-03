import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { HelperText, IconButton, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { colors, spacing } from '../../lib/theme';
import { useAuthenticatedSession } from '../../lib/auth-readiness';

function fmtTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function isValidId(id: string): id is Id<'conversations'> {
  return /^[a-zA-Z0-9_-]+$/.test(id) && id.length >= 10;
}

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { isReady } = useAuthenticatedSession();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const conversationId: Id<'conversations'> | null = rawId && isValidId(rawId) ? rawId as Id<'conversations'> : null;
  const data = useQuery(api.chat.getMessages, isReady && conversationId ? { conversationId } : 'skip');
  const sendMessage = useMutation(api.chat.sendMessage);
  const deleteConversation = useMutation(api.chat.deleteConversation);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const messages = data?.messages ?? [];

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  const onSend = async () => {
    const t = text.trim();
    if (!t || !conversationId) return;
    setText('');
    await sendMessage({ conversationId, text: t });
  };

  const onDeleteChat = async () => {
    if (!conversationId) return;
    setError(null);
    try {
      await deleteConversation({ conversationId });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete chat.');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, paddingTop: 8, paddingBottom: 12, paddingHorizontal: 4 }}>
        <IconButton icon="arrow-left" iconColor="#fff" onPress={() => router.back()} />
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', flex: 1 }}>{data?.title ?? 'Chat'}</Text>
        <IconButton icon="delete-outline" iconColor="#fff" onPress={() => void onDeleteChat()} />
      </View>
      {error ? <HelperText type="error" visible>{error}</HelperText> : null}

      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.md, gap: 8 }}>
        {messages.length === 0 ? (
          <Text style={{ color: colors.muted, textAlign: 'center', marginTop: spacing.xl }}>No messages yet. Say hello 👋</Text>
        ) : (
          messages.map((m) => (
            <View key={m._id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              {!m.mine ? <Text style={{ color: colors.muted, fontSize: 11, marginLeft: 8, marginBottom: 1 }}>{m.senderName}</Text> : null}
              <View
                style={{
                  backgroundColor: m.mine ? colors.primary : colors.surface,
                  borderRadius: 16,
                  borderBottomRightRadius: m.mine ? 4 : 16,
                  borderBottomLeftRadius: m.mine ? 16 : 4,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
              >
                <Text style={{ color: m.mine ? '#fff' : colors.charcoal }}>{m.text}</Text>
                <Text style={{ color: m.mine ? 'rgba(255,255,255,0.7)' : colors.muted, fontSize: 10, alignSelf: 'flex-end', marginTop: 2 }}>{fmtTime(m.createdAt)}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message"
          mode="outlined"
          dense
          style={{ flex: 1, backgroundColor: colors.surface }}
          onSubmitEditing={() => void onSend()}
          returnKeyType="send"
        />
        <Pressable
          onPress={() => void onSend()}
          disabled={!text.trim()}
          style={{ backgroundColor: text.trim() ? colors.primary : colors.border, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}
        >
          <IconButton icon="send" iconColor="#fff" size={20} style={{ margin: 0 }} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
