import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View, Image } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, HelperText, IconButton, Text, TextInput, Dialog, Portal, Card, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { resolveMediaUrl } from '../../lib/api-client';
import type { Id } from '../../lib/ids';
import { colors, spacing, accents } from '../../lib/theme';
import { useAuthenticatedSession } from '../../lib/auth-readiness';

function fmtTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function isValidId(id: string): id is Id<'conversations'> {
  return /^[a-zA-Z0-9_-]+$/.test(id) && id.length >= 10;
}

function parseShiftCard(text: string) {
  const match = text.match(/^\[Shift:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\]$/);
  if (!match) return null;
  return {
    jobTitle: match[1],
    dayLabel: match[2],
    timeRange: match[3],
    shiftId: match[4],
  };
}

function parseSwapCard(text: string) {
  const match = text.match(/^\[Swap:\s*(.*?)\s*\|\s*(.*?)\s*\]$/);
  if (!match) return null;
  return {
    description: match[1],
    swapId: match[2],
  };
}

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { isReady } = useAuthenticatedSession();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const conversationId: Id<'conversations'> | null = rawId && isValidId(rawId) ? rawId as Id<'conversations'> : null;
  
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const data = useQuery(api.chat.getMessages, isReady && conversationId ? { conversationId } : 'skip');
  const myScheduleData = useQuery(api.scheduling.getMySchedule, isReady ? {} : 'skip');

  const sendMessage = useMutation(api.chat.sendMessage);
  const deleteConversation = useMutation(api.chat.deleteConversation);
  const toggleReaction = useMutation(api.chat.toggleReaction);
  const editMessage = useMutation(api.chat.editMessage);
  const uploadImage = useMutation(api.chat.uploadImage);
  const claimOpenShift = useMutation(api.scheduling.claimOpenShift);
  const respondToShiftSwap = useMutation(api.scheduling.respondToShiftSwap);

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  
  // Dialog States
  const [reactMsgId, setReactMsgId] = useState<string | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const messages = (data?.messages ?? []) as any[];
  const readReceipts = (data?.readReceipts ?? []) as any[];

  const mineShifts = myScheduleData?.mine ?? [];
  const openShifts = myScheduleData?.open ?? [];

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  // Auto-dismiss the toast 3s after it's set. Runs once per toast value rather
  // than spawning a new timer on every render.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const onSend = async () => {
    const t = text.trim();
    if (!t || !conversationId) return;
    setText('');
    await sendMessage({ conversationId, text: t });
  };

  const onReact = async (messageId: string, emoji: string) => {
    await toggleReaction({ messageId, emoji });
  };

  const onUpdateChecklist = async (messageId: string, newText: string) => {
    await editMessage({ messageId, text: newText });
  };

  const onClaimShift = async (shiftId: string) => {
    try {
      await claimOpenShift({ shiftId });
      setToast('Shift claimed successfully!');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Claim failed.');
    }
  };

  const onRespondSwap = async (swapId: string, accept: boolean) => {
    try {
      await respondToShiftSwap({ swapId, accept });
      setToast(accept ? 'Swap accepted!' : 'Swap declined.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Action failed.');
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      base64: true,
    });

    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64 || !conversationId) return;

    setError(null);
    try {
      const { imageUrl } = await uploadImage({
        dataBase64: asset.base64,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      await sendMessage({ conversationId, text: 'Shared a photo', imageUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload photo.');
    }
  };

  const shareShift = async (shift: any, isOpen: boolean) => {
    if (!conversationId) return;
    const formatted = `[Shift: ${shift.jobTitle} | ${shift.dayLabel} | ${shift.startTime} - ${shift.endTime} | ${shift._id}]`;
    await sendMessage({ conversationId, text: formatted });
    setShowShareDialog(false);
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

  const renderChecklist = (messageId: string, msgText: string, mine: boolean) => {
    const lines = msgText.split('\n');
    return (
      <View style={{ gap: 4, marginTop: 4 }}>
        {lines.map((line, idx) => {
          const isUnchecked = line.startsWith('[ ]');
          const isChecked = line.startsWith('[x]');
          if (!isUnchecked && !isChecked) {
            return <Text key={idx} style={{ color: mine ? '#fff' : colors.charcoal }}>{line}</Text>;
          }
          const label = line.slice(3).trim();
          return (
            <Pressable
              key={idx}
              onPress={() => {
                const newLines = [...lines];
                newLines[idx] = isUnchecked ? `[x] ${label}` : `[ ] ${label}`;
                void onUpdateChecklist(messageId, newLines.join('\n'));
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}
            >
              <MaterialCommunityIcons
                name={isChecked ? 'checkbox-marked-outline' : 'checkbox-blank-outline'}
                size={18}
                color={mine ? '#fff' : colors.primary}
              />
              <Text style={{ color: mine ? '#fff' : colors.charcoal, textDecorationLine: isChecked ? 'line-through' : 'none' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderReactions = (m: any) => {
    const rx = m.reactions || {};
    const emojis = Object.keys(rx);
    if (emojis.length === 0) return null;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, alignSelf: m.mine ? 'flex-end' : 'flex-start' }}>
        {emojis.map((emoji) => {
          const uids = rx[emoji] || [];
          const count = uids.length;
          if (count === 0) return null;
          const didIReact = uids.includes(me?.profile?.id);
          return (
            <Pressable
              key={emoji}
              onPress={() => void onReact(m.id, emoji)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: didIReact ? '#E1FBF3' : colors.surface,
                borderWidth: 1,
                borderColor: didIReact ? colors.success : colors.border,
                borderRadius: 12,
                paddingHorizontal: 6,
                paddingVertical: 2,
                gap: 2,
              }}
            >
              <Text style={{ fontSize: 12 }}>{emoji}</Text>
              <Text style={{ fontSize: 10, color: didIReact ? colors.success : colors.muted, fontWeight: '700' }}>{count}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <Portal.Host>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, paddingTop: 8, paddingBottom: 12, paddingHorizontal: 4 }}>
          <IconButton icon="arrow-left" iconColor="#fff" onPress={() => router.back()} />
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', flex: 1 }}>{data?.title ?? 'Chat'}</Text>
          <IconButton icon="delete-outline" iconColor="#fff" onPress={() => void onDeleteChat()} />
        </View>
        {error ? <HelperText type="error" visible>{error}</HelperText> : null}

        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.md, gap: 12 }}>
          {messages.length === 0 ? (
            <Text style={{ color: colors.muted, textAlign: 'center', marginTop: spacing.xl }}>No messages yet. Say hello 👋</Text>
          ) : (
            messages.map((m) => {
              const shift = parseShiftCard(m.text);
              const swap = parseSwapCard(m.text);
              const hasChecklist = m.text.includes('[ ]') || m.text.includes('[x]');

              return (
                <View key={m._id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 4 }}>
                  {!m.mine ? <Text style={{ color: colors.muted, fontSize: 11, marginLeft: 8, marginBottom: 1 }}>{m.senderName}</Text> : null}
                  
                  <Pressable onLongPress={() => setReactMsgId(m.id)}>
                    <View
                      style={{
                        backgroundColor: m.mine ? colors.primary : colors.surface,
                        borderRadius: 16,
                        borderBottomRightRadius: m.mine ? 4 : 16,
                        borderBottomLeftRadius: m.mine ? 16 : 4,
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      {/* Render Image Attachment */}
                      {m.imageUrl ? (
                        <Image source={{ uri: resolveMediaUrl(m.imageUrl) }} style={{ width: 220, height: 150, borderRadius: 12, marginBottom: 6 }} resizeMode="cover" />
                      ) : null}

                      {/* Render Content */}
                      {shift ? (
                        <Card style={{ backgroundColor: accents[4].bg, width: 220, marginVertical: 4 }}>
                          <Card.Content style={{ padding: spacing.sm, gap: 4 }}>
                            <Text style={{ color: accents[4].fg, fontWeight: '800', fontSize: 12 }}>OPEN SHIFT CARD</Text>
                            <Text style={{ fontWeight: '700', fontSize: 13 }}>{shift.jobTitle}</Text>
                            <Text style={{ fontSize: 11, color: colors.charcoal }}>{shift.dayLabel} · {shift.timeRange}</Text>
                            <Button mode="contained" compact buttonColor={colors.primary} labelStyle={{ fontSize: 11 }} style={{ marginTop: 4 }} onPress={() => void onClaimShift(shift.shiftId)}>
                              Claim Shift
                            </Button>
                          </Card.Content>
                        </Card>
                      ) : swap ? (
                        <Card style={{ backgroundColor: accents[0].bg, width: 220, marginVertical: 4 }}>
                          <Card.Content style={{ padding: spacing.sm, gap: 4 }}>
                            <Text style={{ color: accents[0].fg, fontWeight: '800', fontSize: 12 }}>SWAP PROPOSAL</Text>
                            <Text style={{ fontSize: 12 }}>{swap.description}</Text>
                            <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                              <Button mode="contained" compact buttonColor={colors.primary} labelStyle={{ fontSize: 10 }} style={{ flex: 1 }} onPress={() => void onRespondSwap(swap.swapId, true)}>
                                Accept
                              </Button>
                              <Button mode="outlined" compact textColor={colors.danger} labelStyle={{ fontSize: 10 }} style={{ flex: 1 }} onPress={() => void onRespondSwap(swap.swapId, false)}>
                                Deny
                              </Button>
                            </View>
                          </Card.Content>
                        </Card>
                      ) : hasChecklist ? (
                        renderChecklist(m.id, m.text, m.mine)
                      ) : (
                        <Text style={{ color: m.mine ? '#fff' : colors.charcoal }}>{m.text}</Text>
                      )}

                      <Text style={{ color: m.mine ? 'rgba(255,255,255,0.7)' : colors.muted, fontSize: 10, alignSelf: 'flex-end', marginTop: 4 }}>{fmtTime(m.createdAt)}</Text>
                    </View>
                  </Pressable>
                  
                  {/* Reactions list */}
                  {renderReactions(m)}
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Read Receipts Display */}
        {readReceipts.length > 0 ? (
          <View style={{ paddingHorizontal: spacing.md, paddingVertical: 4, backgroundColor: colors.background }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>
              ✓ Read by {readReceipts.map((r) => r.name.split(' ')[0]).join(', ')}
            </Text>
          </View>
        ) : null}

        {/* Action input bar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: 6, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
          <IconButton icon="calendar-plus" iconColor={colors.primary} size={22} style={{ margin: 0 }} onPress={() => setShowShareDialog(true)} accessibilityLabel="Share Shift" />
          <IconButton icon="camera" iconColor={colors.primary} size={22} style={{ margin: 0 }} onPress={() => void pickImage()} accessibilityLabel="Add Photo" />
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
            style={{ backgroundColor: text.trim() ? colors.primary : colors.border, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
          >
            <IconButton icon="send" iconColor="#fff" size={18} style={{ margin: 0 }} />
          </Pressable>
        </View>

        {/* Portals & Dialogs */}
        <Portal>
          {/* Reaction Dialog */}
          <Dialog visible={Boolean(reactMsgId)} onDismiss={() => setReactMsgId(null)} style={{ backgroundColor: colors.surface }}>
            <Dialog.Title style={{ fontSize: 16 }}>React to Message</Dialog.Title>
            <Dialog.Content style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12 }}>
              {['👍', '❤️', '😮', '😂', '👏'].map((emoji) => (
                <IconButton
                  key={emoji}
                  icon={() => <Text style={{ fontSize: 28 }}>{emoji}</Text>}
                  onPress={() => {
                    if (reactMsgId) void onReact(reactMsgId, emoji);
                    setReactMsgId(null);
                  }}
                />
              ))}
            </Dialog.Content>
          </Dialog>

          {/* Share Shift Dialog */}
          <Dialog visible={showShareDialog} onDismiss={() => setShowShareDialog(false)} style={{ backgroundColor: colors.surface }}>
            <Dialog.Title style={{ fontSize: 16 }}>Share Shift in Chat</Dialog.Title>
            <Dialog.ScrollArea style={{ maxHeight: 300, paddingHorizontal: 0 }}>
              <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md }}>
                <Text style={{ fontWeight: '700', marginVertical: 6 }}>My Scheduled Shifts</Text>
                {mineShifts.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>No shifts scheduled.</Text>
                ) : (
                  mineShifts.map((s: any) => (
                    <ListCard key={s._id} title={s.jobTitle} subtitle={`${s.dayLabel} · ${s.startTime} - ${s.endTime}`} onPress={() => shareShift(s, false)} />
                  ))
                )}
                
                <Text style={{ fontWeight: '700', marginVertical: 6, marginTop: 12 }}>Available Open Shifts</Text>
                {openShifts.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>No open shifts.</Text>
                ) : (
                  openShifts.map((s: any) => (
                    <ListCard key={s._id} title={s.jobTitle} subtitle={`${s.dayLabel} · ${s.startTime} - ${s.endTime}`} onPress={() => shareShift(s, true)} />
                  ))
                )}
              </ScrollView>
            </Dialog.ScrollArea>
            <Dialog.Actions>
              <Button onPress={() => setShowShareDialog(false)}>Cancel</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>

        {/* Toast snackbar simulated message */}
        {toast ? (
          <Portal>
            <View style={{ position: 'absolute', bottom: 70, left: 20, right: 20, backgroundColor: '#E1FBF3', borderColor: colors.success, borderWidth: 1, padding: 10, borderRadius: 8, zIndex: 9999 }}>
              <Text style={{ color: colors.success, fontWeight: '700', textAlign: 'center' }}>{toast}</Text>
            </View>
          </Portal>
        ) : null}
      </KeyboardAvoidingView>
    </Portal.Host>
  );
}

function ListCard({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <View>
        <Text style={{ fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="send" size={16} color={colors.primary} />
    </Pressable>
  );
}
