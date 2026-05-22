import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput } from 'react-native-paper';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

const categories = ['spirit', 'wine', 'beer', 'mixer', 'garnish', 'supply', 'other'] as const;
type Category = (typeof categories)[number];

type BarItem = {
  _id: Id<'barInventoryItems'>;
  name: string;
  category: Category;
  area: string | null;
  unit: string;
  parLevel: number;
  onHand: number;
  unitCostCents: number | null;
  supplier: string | null;
  notes: string | null;
};

type ParsedItem = Omit<BarItem, '_id' | 'area' | 'unitCostCents' | 'supplier' | 'notes'> & {
  area?: string;
  unitCostCents?: number;
  supplier?: string;
  notes?: string;
};

function money(cents: number | null | undefined) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

export default function BarStockScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const user = useAuthStore((state: AuthState) => state.user);
  const canManage = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const stock = useQuery(api.barInventory.getBarStock, canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const upsertBarItem = useMutation(api.barInventory.upsertBarItem);
  const recordMovement = useMutation(api.barInventory.recordBarStockMovement);
  const importParsed = useMutation(api.barInventory.importParsedBarItems);
  const parseInput = useAction(api.barInventory.parseBarInventoryInput);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('spirit');
  const [area, setArea] = useState('');
  const [unit, setUnit] = useState('bottle');
  const [parLevel, setParLevel] = useState('0');
  const [onHand, setOnHand] = useState('0');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [parseText, setParseText] = useState('');
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [parseNotes, setParseNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const items = useMemo(() => (stock?.items ?? []) as BarItem[], [stock]);
  const lowItems = items.filter((item) => item.onHand <= item.parLevel);

  const saveManualItem = async () => {
    if (!venue?.id) return;
    setBusy(true);
    setMessage(null);
    try {
      await upsertBarItem({
        venueId: venue.id,
        name,
        category,
        area: area.trim() || undefined,
        unit,
        parLevel: Number(parLevel || 0),
        onHand: Number(onHand || 0),
        unitCostCents: unitCost ? Math.round(Number(unitCost) * 100) : undefined,
        supplier: supplier.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setName('');
      setParLevel('0');
      setOnHand('0');
      setUnitCost('');
      setSupplier('');
      setNotes('');
      setMessage('Bar stock item saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save item.');
    } finally {
      setBusy(false);
    }
  };

  const parseWithAi = async (image?: { base64: string; mimeType?: string }) => {
    if (!venue?.id) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await parseInput({
        venueId: venue.id,
        text: parseText.trim() || undefined,
        imageBase64: image?.base64,
        imageMimeType: image?.mimeType,
      });
      setParsedItems(result.items as ParsedItem[]);
      setParseNotes(result.notes || null);
      setMessage(`Parsed ${result.items.length} item${result.items.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not parse inventory input.');
    } finally {
      setBusy(false);
    }
  };

  const pickCsv = async () => {
    const doc = await DocumentPicker.getDocumentAsync({ type: ['text/*', 'text/csv', 'application/csv'], copyToCacheDirectory: true });
    if (doc.canceled || !doc.assets[0]?.uri) return;
    const text = await FileSystem.readAsStringAsync(doc.assets[0].uri);
    setParseText(text);
    setMessage(`Loaded ${doc.assets[0].name ?? 'upload'} for parsing.`);
  };

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      setMessage('Photo permission is required to parse an invoice image.');
      return;
    }
    const image = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.8,
    });
    if (image.canceled || !image.assets[0]?.base64) return;
    await parseWithAi({ base64: image.assets[0].base64, mimeType: image.assets[0].mimeType });
  };

  const importItems = async () => {
    if (!venue?.id || parsedItems.length === 0) return;
    setBusy(true);
    try {
      const result = await importParsed({ venueId: venue.id, items: parsedItems });
      setParsedItems([]);
      setParseText('');
      setMessage(`Imported ${result.imported} bar stock item${result.imported === 1 ? '' : 's'}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not import parsed items.');
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Bar Stock is available to managers and admins.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Bar Stock</Text>
        <Text style={{ color: colors.muted }}>Count bottles, parse invoices, and keep reorder lists tight.</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {[
          { label: 'Items', value: String(items.length), a: accents[0] },
          { label: 'Below par', value: String(stock?.lowStockCount ?? 0), a: accents[4] },
          { label: 'Value on hand', value: money(stock?.totalValueCents ?? 0), a: accents[2] },
        ].map((metric) => (
          <Card key={metric.label} style={{ backgroundColor: metric.a.bg, width: '31%', flexGrow: 1, borderRadius: 16 }}>
            <Card.Content>
              <Text style={{ color: metric.a.fg, fontSize: 22, fontWeight: '800' }}>{metric.value}</Text>
              <Text style={{ color: colors.muted }}>{metric.label}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>AI import</Text>
          <TextInput label="Paste list, invoice text, or CSV rows" value={parseText} onChangeText={setParseText} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void parseWithAi()}>Parse text</Button>
            <Button mode="outlined" textColor={colors.primary} disabled={busy} onPress={() => void pickCsv()}>Upload CSV</Button>
            <Button mode="outlined" textColor={colors.primary} disabled={busy} onPress={() => void pickPhoto()}>Photo invoice</Button>
          </View>
          {parseNotes ? <Text style={{ color: colors.muted }}>{parseNotes}</Text> : null}
          {parsedItems.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={{ fontWeight: '700' }}>Review parsed items</Text>
              {parsedItems.slice(0, 8).map((item, index) => (
                <View key={`${item.name}-${index}`} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                  <Text style={{ fontWeight: '700' }}>{item.name}</Text>
                  <Text style={{ color: colors.muted }}>{item.category} · {item.onHand ?? 0} {item.unit} · par {item.parLevel ?? 0}</Text>
                </View>
              ))}
              <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void importItems()}>Import parsed items</Button>
            </View>
          ) : null}
          {message ? <Text style={{ color: message.includes('Could') || message.includes('required') ? colors.danger : colors.muted }}>{message}</Text> : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Add item</Text>
          <TextInput label="Name" value={name} onChangeText={setName} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {categories.map((item) => (
              <Chip key={item} selected={category === item} onPress={() => setCategory(item)}>{item}</Chip>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="Area" value={area} onChangeText={setArea} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
            <TextInput label="Unit" value={unit} onChangeText={setUnit} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="Par" value={parLevel} onChangeText={setParLevel} keyboardType="numeric" mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
            <TextInput label="On hand" value={onHand} onChangeText={setOnHand} keyboardType="numeric" mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
            <TextInput label="Unit $" value={unitCost} onChangeText={setUnitCost} keyboardType="numeric" mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
          </View>
          <TextInput label="Supplier" value={supplier} onChangeText={setSupplier} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <TextInput label="Notes" value={notes} onChangeText={setNotes} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <Button mode="contained" buttonColor={colors.primary} loading={busy} onPress={() => void saveManualItem()}>Save item</Button>
        </Card.Content>
      </Card>

      {lowItems.length > 0 ? (
        <Card style={{ backgroundColor: accents[4].bg, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ color: accents[4].fg, fontWeight: '700' }}>Reorder list</Text>
            {lowItems.slice(0, 8).map((item) => (
              <Text key={item._id} style={{ color: colors.charcoal }}>{item.name}: {item.onHand} {item.unit} on hand, par {item.parLevel}</Text>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Stock list</Text>
          {items.length === 0 ? (
            <Text style={{ color: colors.muted }}>No bar stock yet.</Text>
          ) : (
            items.map((item) => (
              <View key={item._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>{item.name}</Text>
                    <Text style={{ color: colors.muted }}>{item.category} · {item.area ?? 'unassigned'} · {money(item.unitCostCents)} / {item.unit}</Text>
                  </View>
                  <Chip compact style={{ backgroundColor: item.onHand <= item.parLevel ? accents[4].bg : accents[2].bg }}>
                    {item.onHand} / {item.parLevel}
                  </Chip>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => void recordMovement({ venueId: venue!.id, itemId: item._id, movementType: 'count', quantity: item.onHand })}>Count</Button>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => void recordMovement({ venueId: venue!.id, itemId: item._id, movementType: 'received', quantity: 1 })}>+1</Button>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => void recordMovement({ venueId: venue!.id, itemId: item._id, movementType: 'waste', quantity: -1 })}>-1</Button>
                </View>
              </View>
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
