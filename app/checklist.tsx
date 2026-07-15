import { useMemo, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Button, Chip, IconButton, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import { resolveMediaUrl } from '../lib/api-client';
import { colors, spacing, radius, type } from '../lib/theme';
import { AppCard, SectionHeader } from '../components/AppCard';
import { errorMessage } from '../lib/format';
import { useVenueAuth } from '../lib/useVenueAuth';

type ChecklistItem = {
  _id: string;
  title: string;
  requiresPhoto: boolean;
  sortOrder: number;
  completionId: string | null;
  status: 'pending' | 'done';
  completedByName: string | null;
  completedAt: number | null;
  hasPhoto: boolean;
  photoUrl: string | null;
};

type ChecklistResponse = { date: string; kind: string; items: ChecklistItem[] };

export default function ChecklistScreen() {
  const { venue, isReady, canManage } = useVenueAuth();
  const [kind, setKind] = useState<'opening' | 'closing'>('opening');
  const [newTitle, setNewTitle] = useState('');
  const [newRequiresPhoto, setNewRequiresPhoto] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checklistQuery = useQuery(api.operations.getChecklist, isReady && venue?.id ? { kind } : 'skip') as ChecklistResponse | null | undefined;
  const items = useMemo(() => (checklistQuery?.items ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder), [checklistQuery]);

  const addItem = useMutation(api.operations.addChecklistItem);
  const removeItem = useMutation(api.operations.removeChecklistItem);
  const completeItem = useMutation(api.operations.completeChecklistItem);

  const onAddItem = async () => {
    if (!newTitle.trim()) return;
    setError(null);
    try {
      await addItem({ kind, title: newTitle.trim(), requiresPhoto: newRequiresPhoto });
      setNewTitle('');
      setNewRequiresPhoto(false);
    } catch (e) {
      setError(errorMessage(e, 'Could not add task.'));
    }
  };

  const onRemoveItem = async (id: string) => {
    try {
      await removeItem(id);
    } catch (e) {
      setError(errorMessage(e, 'Could not remove task.'));
    }
  };

  const onCompletePlain = async (item: ChecklistItem) => {
    if (!item.completionId) return;
    setBusyItemId(item._id);
    setError(null);
    try {
      await completeItem({ completionId: item.completionId });
    } catch (e) {
      setError(errorMessage(e, 'Could not complete task.'));
    } finally {
      setBusyItemId(null);
    }
  };

  const onCompleteWithPhoto = async (item: ChecklistItem) => {
    if (!item.completionId) return;
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== 'granted') {
        setError('Camera permission is required for photo proof.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 });
      if (result.canceled || !result.assets[0]?.base64) return;
      setBusyItemId(item._id);
      await completeItem({
        completionId: item.completionId,
        photoBase64: result.assets[0].base64,
        photoMimeType: result.assets[0].mimeType || 'image/jpeg',
      });
    } catch (e) {
      setError(errorMessage(e, 'Could not upload photo.'));
    } finally {
      setBusyItemId(null);
    }
  };

  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton icon="arrow-left" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.title, color: colors.charcoal }}>Task checklist</Text>
          <Text style={{ color: colors.muted }}>Opening and closing tasks, with photo proof where it matters.</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Chip selected={kind === 'opening'} onPress={() => setKind('opening')}>Opening</Chip>
        <Chip selected={kind === 'closing'} onPress={() => setKind('closing')}>Closing</Chip>
      </View>

      <Text style={{ color: colors.muted }}>{doneCount}/{items.length} done today</Text>

      {items.length === 0 ? (
        <Text style={{ color: colors.muted }}>No {kind} tasks yet{canManage ? ' — add one below.' : '.'}</Text>
      ) : (
        items.map((item) => (
          <AppCard key={item._id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', textDecorationLine: item.status === 'done' ? 'line-through' : 'none' }}>{item.title}</Text>
                  {item.requiresPhoto ? <Text style={{ color: colors.secondary, fontSize: 12 }}>📷 Photo required</Text> : null}
                  {item.status === 'done' ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      Done by {item.completedByName}{item.completedAt ? ` · ${new Date(item.completedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
                    </Text>
                  ) : null}
                </View>
                {canManage ? (
                  <IconButton icon="delete-outline" size={18} onPress={() => void onRemoveItem(item._id)} accessibilityLabel="Remove task" />
                ) : null}
              </View>

              {item.hasPhoto && item.photoUrl ? (
                <Image
                  source={{ uri: resolveMediaUrl(item.photoUrl) }}
                  style={{ width: '100%', height: 160, borderRadius: radius.sharp, backgroundColor: colors.background, marginTop: spacing.sm }}
                  resizeMode="cover"
                />
              ) : null}

              {item.status !== 'done' ? (
                item.requiresPhoto ? (
                  <Button mode="contained" buttonColor={colors.primary} icon="camera" loading={busyItemId === item._id} onPress={() => void onCompleteWithPhoto(item)} style={{ marginTop: spacing.sm }}>
                    Take photo & complete
                  </Button>
                ) : (
                  <Button mode="contained" buttonColor={colors.primary} loading={busyItemId === item._id} onPress={() => void onCompletePlain(item)} style={{ marginTop: spacing.sm }}>
                    Mark done
                  </Button>
                )
              ) : null}
          </AppCard>
        ))
      )}

      {canManage ? (
        <AppCard>
            <SectionHeader title={`Add a ${kind} task`} />
            <View style={{ gap: spacing.sm }}>
            <PaperTextInput placeholder="Task title" value={newTitle} onChangeText={setNewTitle} mode="outlined" style={{ backgroundColor: colors.surface }} />
            <Chip selected={newRequiresPhoto} onPress={() => setNewRequiresPhoto((v) => !v)} icon="camera">
              Require photo proof
            </Chip>
            <Button mode="outlined" textColor={colors.primary} disabled={!newTitle.trim()} onPress={() => void onAddItem()}>
              Add task
            </Button>
            </View>
        </AppCard>
      ) : null}

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </ScrollView>
  );
}
