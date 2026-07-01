import { useCallback, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useAction, useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { errorMessage } from '../../lib/format';
import { ManagerGate } from '../../components/ManagerGate';
import {
  money,
  type VelocityRow,
  type ShrinkageData,
  type PurchaseOrderData,
  type CostHistoryEntry,
  type AgingReport,
} from '../../lib/bar-inventory-types';
import {
  VelocityCard,
  ShrinkageCard,
  PurchaseOrderCard,
  AgingCard,
  MovementTimeline,
} from '../../components/bar-stock/InventoryCards';
import { InlineMessage } from '../../components/InlineMessage';

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

type BarStock = {
  items: BarItem[];
  lowStockCount: number;
  totalValueCents: number;
};

type ParsedItem = Omit<BarItem, '_id' | 'area' | 'unitCostCents' | 'supplier' | 'notes'> & {
  area?: string;
  unitCostCents?: number;
  supplier?: string;
  notes?: string;
};

type MovementType = 'count' | 'received' | 'waste' | 'transfer';

export default function BarStockScreen() {
  const { venue, isReady, canManage, profileLoading } = useVenueAuth();
  const stock = useQuery(api.barInventory.getBarStock, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as BarStock | null | undefined;
  const velocity = useQuery(api.barInventory.getUsageVelocity, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as VelocityRow[] | null | undefined;
  const upsertBarItem = useMutation(api.barInventory.upsertBarItem);
  const recordMovement = useMutation(api.barInventory.recordBarStockMovement);
  const importParsed = useMutation(api.barInventory.importParsedBarItems);
  const parseInput = useAction(api.barInventory.parseBarInventoryInput);
  const updateCost = useMutation(api.barInventory.updateItemCost);
  const lookupSku = useAction(api.barInventory.lookupBySku);
  const sendPoEmail = useMutation(api.barInventory.sendPurchaseOrderEmail);
  const sendDigest = useMutation(api.barInventory.sendInventoryDigest);
  const addItemRow = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm };
  const addItemWideField = { flexGrow: 1, flexShrink: 1, flexBasis: 140, minWidth: 136, backgroundColor: colors.surface };
  const addItemNumberField = { flexGrow: 1, flexShrink: 1, flexBasis: 120, minWidth: 112, backgroundColor: colors.surface };

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
  const [historyItemId, setHistoryItemId] = useState<string | null>(null);
  const [countMode, setCountMode] = useState(false);
  const [countIndex, setCountIndex] = useState(0);
  const [countValue, setCountValue] = useState('');
  const [showStockCsv, setShowStockCsv] = useState(false);
  const [showMovementCsv, setShowMovementCsv] = useState(false);
  const [showShrinkage, setShowShrinkage] = useState(false);
  const [showPurchaseOrder, setShowPurchaseOrder] = useState(false);
  const [showPurchaseOrderCsv, setShowPurchaseOrderCsv] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scannedItem, setScannedItem] = useState<BarItem | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [costHistoryItemId, setCostHistoryItemId] = useState<string | null>(null);
  const [editCostItemId, setEditCostItemId] = useState<string | null>(null);
  const [editCostValue, setEditCostValue] = useState('');
  const [showAgingReport, setShowAgingReport] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const stockCsv = useQuery(api.barInventory.exportStockCsv, isReady && canManage && showStockCsv ? {} : 'skip') as string | null | undefined;
  const movementCsv = useQuery(api.barInventory.exportMovementsCsv, isReady && canManage && showMovementCsv ? {} : 'skip') as string | null | undefined;
  const shrinkageData = useQuery(api.barInventory.getShrinkageReport, isReady && canManage && showShrinkage ? {} : 'skip') as ShrinkageData | null | undefined;
  const purchaseOrder = useQuery(api.barInventory.getPurchaseOrder, isReady && canManage && showPurchaseOrder ? {} : 'skip') as PurchaseOrderData | null | undefined;
  const purchaseOrderCsv = useQuery(api.barInventory.exportPurchaseOrderCsv, isReady && canManage && showPurchaseOrderCsv ? {} : 'skip') as string | null | undefined;
  const costHistory = useQuery(api.barInventory.getCostHistory, isReady && canManage && costHistoryItemId ? { itemId: costHistoryItemId } : 'skip') as { itemName: string; currentCostCents: number | null; entries: CostHistoryEntry[] } | null | undefined;
  const agingReport = useQuery(api.barInventory.getAgingReport, isReady && canManage && showAgingReport ? {} : 'skip') as AgingReport | null | undefined;

  const items = useMemo(() => (stock?.items ?? []) as BarItem[], [stock]);
  const lowItems = items.filter((item) => item.onHand <= item.parLevel);

  // Group items by area for count workflow
  const countItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const aArea = a.area ?? 'zzz';
      const bArea = b.area ?? 'zzz';
      if (aArea !== bArea) return aArea.localeCompare(bArea);
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [items]);

  const saveManualItem = async () => {
    if (!venue?.id) return;
    setBusy(true);
    setMessage(null);
    try {
      await upsertBarItem({
        venueId: venue.id, name, category, area: area.trim() || undefined, unit,
        parLevel: Number(parLevel || 0), onHand: Number(onHand || 0),
        unitCostCents: unitCost ? Math.round(Number(unitCost) * 100) : undefined,
        supplier: supplier.trim() || undefined, notes: notes.trim() || undefined,
      });
      setName(''); setParLevel('0'); setOnHand('0'); setUnitCost(''); setSupplier(''); setNotes('');
      setMessage('Bar stock item saved.');
    } catch (e) {
      setMessage(errorMessage(e, 'Could not save item.'));
    } finally { setBusy(false); }
  };

  const parseWithAi = async (image?: { base64: string; mimeType?: string }) => {
    if (!venue?.id) return;
    setBusy(true); setMessage(null);
    try {
      const result = await parseInput({ venueId: venue.id, text: parseText.trim() || undefined, imageBase64: image?.base64, imageMimeType: image?.mimeType });
      setParsedItems(result.items as ParsedItem[]);
      setParseNotes(result.notes || null);
      setMessage(`Parsed ${result.items.length} item${result.items.length === 1 ? '' : 's'}.`);
    } catch (e) { setMessage(errorMessage(e, 'Could not parse inventory input.')); }
    finally { setBusy(false); }
  };

  const pickCsv = async () => {
    setBusy(true); setMessage(null);
    try {
      const doc = await DocumentPicker.getDocumentAsync({ type: ['text/*', 'text/csv', 'application/csv'], copyToCacheDirectory: true });
      if (doc.canceled || !doc.assets[0]?.uri) return;
      const text = await FileSystem.readAsStringAsync(doc.assets[0].uri);
      setParseText(text);
      setMessage(`Loaded ${doc.assets[0].name ?? 'upload'} for parsing.`);
    } catch (e) { setMessage(errorMessage(e, 'Could not load CSV.')); }
    finally { setBusy(false); }
  };

  const pickPhoto = async () => {
    setBusy(true); setMessage(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') { setMessage('Photo permission is required to parse an invoice image.'); return; }
      const image = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.8 });
      if (image.canceled || !image.assets[0]?.base64) return;
      await parseWithAi({ base64: image.assets[0].base64, mimeType: image.assets[0].mimeType });
    } catch (e) { setMessage(errorMessage(e, 'Could not load photo.')); }
    finally { setBusy(false); }
  };

  const importItems = async () => {
    if (!venue?.id || parsedItems.length === 0) return;
    setBusy(true);
    try {
      const result = await importParsed({ venueId: venue.id, items: parsedItems });
      setParsedItems([]); setParseText('');
      setMessage(`Imported ${result.imported} bar stock item${result.imported === 1 ? '' : 's'}.`);
    } catch (e) { setMessage(errorMessage(e, 'Could not import parsed items.')); }
    finally { setBusy(false); }
  };

  const recordInventoryMovement = async (itemId: Id<'barInventoryItems'>, movementType: MovementType, quantity: number) => {
    if (!venue?.id) { setMessage('No venue assigned to your account yet.'); return; }
    setMessage(null);
    try { await recordMovement({ venueId: venue.id, itemId, movementType, quantity }); }
    catch (e) { setMessage(errorMessage(e, 'Could not update stock count.')); }
  };

  const submitCount = useCallback(async () => {
    if (!venue?.id || countIndex >= countItems.length) return;
    const item = countItems[countIndex];
    const qty = Number(countValue);
    if (isNaN(qty) || qty < 0) { setMessage('Enter a valid count.'); return; }
    try {
      await recordMovement({ venueId: venue.id, itemId: item._id, movementType: 'count', quantity: qty });
      if (countIndex + 1 < countItems.length) {
        setCountIndex(countIndex + 1);
        setCountValue(String(countItems[countIndex + 1].onHand));
      } else {
        setCountMode(false);
        setCountIndex(0);
        setMessage(`Count complete — ${countItems.length} items counted.`);
      }
    } catch (e) { setMessage(errorMessage(e, 'Could not record count.')); }
  }, [venue?.id, countIndex, countItems, countValue, recordMovement]);

  const openScanner = async () => {
    setScanMsg(null); setScannedItem(null);
    if (Platform.OS === 'web') { setScanMsg('Barcode scanning is not available on web.'); return; }
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) { setScanMsg('Camera permission is required to scan barcodes.'); return; }
    }
    setShowScanner(true);
  };

  const onBarcodeScanned = useCallback(async ({ data }: { data: string }) => {
    if (scanBusy || !data) return;
    setScanBusy(true); setScanMsg(null);
    try {
      const item = await lookupSku({ sku: data });
      setScannedItem(item as BarItem);
      setShowScanner(false);
    } catch {
      setScanMsg(`No item found with barcode: ${data}`);
      setShowScanner(false);
    } finally { setScanBusy(false); }
  }, [scanBusy, lookupSku]);

  const saveCostUpdate = async (itemId: string) => {
    const cents = Math.round(Number(editCostValue) * 100);
    if (isNaN(cents) || cents < 0) { setMessage('Enter a valid price.'); return; }
    try {
      await updateCost({ itemId, unitCostCents: cents });
      setEditCostItemId(null); setEditCostValue('');
      setMessage('Cost updated.');
    } catch (e) { setMessage(errorMessage(e, 'Could not update cost.')); }
  };

  // Barcode scanner overlay
  if (showScanner && Platform.OS !== 'web') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
        <View style={{ position: 'absolute', top: 60, left: 20, right: 20, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 }}>
            Point at a barcode or QR code
          </Text>
        </View>
        <View style={{ position: 'absolute', bottom: 60, left: 20, right: 20 }}>
          {scanMsg ? <Text style={{ color: '#f88', textAlign: 'center', marginBottom: 12 }}>{scanMsg}</Text> : null}
          <Button mode="contained" buttonColor="#333" onPress={() => setShowScanner(false)}>Cancel</Button>
        </View>
      </View>
    );
  }

  // Count workflow overlay
  if (countMode && countItems.length > 0) {
    const current = countItems[countIndex];
    const prevArea = countIndex > 0 ? countItems[countIndex - 1].area : null;
    const isNewArea = current.area !== prevArea;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Inventory Count</Text>
          <Button compact mode="outlined" textColor={colors.danger} onPress={() => { setCountMode(false); setCountIndex(0); }}>Exit</Button>
        </View>
        <Text style={{ color: colors.muted }}>Item {countIndex + 1} of {countItems.length}</Text>
        <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${Math.round(((countIndex + 1) / countItems.length) * 100)}%`, backgroundColor: colors.primary, borderRadius: 2 }} />
        </View>
        {isNewArea && (
          <Card style={{ backgroundColor: accents[1].bg, borderRadius: 12 }}>
            <Card.Content style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <MaterialCommunityIcons name="map-marker" size={18} color={accents[1].fg} />
              <Text style={{ color: accents[1].fg, fontWeight: '700' }}>Area: {current.area ?? 'Unassigned'}</Text>
            </Card.Content>
          </Card>
        )}
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleLarge" style={{ fontWeight: '800' }}>{current.name}</Text>
            <Text style={{ color: colors.muted }}>{current.category} · {current.unit} · par {current.parLevel}</Text>
            <Text style={{ color: colors.muted }}>Current on-hand: {current.onHand}</Text>
            <TextInput
              label="Actual count"
              value={countValue}
              onChangeText={setCountValue}
              keyboardType="numeric"
              mode="outlined"
              style={{ backgroundColor: colors.surface }}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {countIndex > 0 && (
                <Button compact mode="outlined" textColor={colors.muted} onPress={() => { setCountIndex(countIndex - 1); setCountValue(String(countItems[countIndex - 1].onHand)); }}>Back</Button>
              )}
              <Button compact mode="outlined" textColor={colors.muted} onPress={() => {
                if (countIndex + 1 < countItems.length) { setCountIndex(countIndex + 1); setCountValue(String(countItems[countIndex + 1].onHand)); }
                else { setCountMode(false); setCountIndex(0); setMessage('Count finished (last item skipped).'); }
              }}>Skip</Button>
              <Button mode="contained" buttonColor={colors.primary} onPress={() => void submitCount()} style={{ flex: 1 }}>
                {countIndex + 1 < countItems.length ? 'Save & next' : 'Save & finish'}
              </Button>
            </View>
          </Card.Content>
        </Card>
        <InlineMessage message={message} />
      </ScrollView>
    );
  }

  return (
    <ManagerGate canManage={canManage} profileLoading={profileLoading} feature="Bar Stock">
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

      {/* Count workflow + Export buttons */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button
          mode="contained"
          buttonColor={colors.primary}
          icon="clipboard-check"
          disabled={items.length === 0}
          onPress={() => { setCountMode(true); setCountIndex(0); setCountValue(String(countItems[0]?.onHand ?? 0)); setMessage(null); }}
        >
          Start count
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} icon="barcode-scan" onPress={() => void openScanner()}>
          Scan barcode
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowShrinkage((v) => !v)}>
          {showShrinkage ? 'Hide shrinkage' : 'Shrinkage report'}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowPurchaseOrder((v) => !v)}>
          {showPurchaseOrder ? 'Hide order' : 'Purchase order'}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowStockCsv((v) => !v)}>
          {showStockCsv ? 'Hide stock CSV' : 'Export stock'}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowMovementCsv((v) => !v)}>
          {showMovementCsv ? 'Hide log CSV' : 'Export movement log'}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowAgingReport((v) => !v)}>
          {showAgingReport ? 'Hide aging' : 'Aging report'}
        </Button>
        <Button compact mode="outlined" textColor={colors.primary} icon="email-send-outline" onPress={async () => {
          setBusy(true); setMessage(null);
          try {
            const r = await sendDigest({});
            setMessage(r.sent ? `Digest emailed — ${r.belowParCount} below par, $${(r.shrinkageCents / 100).toFixed(2)} shrinkage.` : 'Digest not sent.');
          } catch (e) { setMessage(errorMessage(e, 'Could not send digest.')); }
          finally { setBusy(false); }
        }}>
          Email digest
        </Button>
      </View>

      {/* Scanned item result */}
      {scannedItem && (
        <Card style={{ backgroundColor: accents[0].bg, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="titleMedium" style={{ color: accents[0].fg, fontWeight: '700' }}>Scanned: {scannedItem.name}</Text>
              <Button compact mode="text" textColor={accents[0].fg} onPress={() => setScannedItem(null)}>✕</Button>
            </View>
            <Text style={{ color: colors.muted }}>{scannedItem.category} · {scannedItem.area ?? 'unassigned'} · {money(scannedItem.unitCostCents)} / {scannedItem.unit}</Text>
            <Text style={{ color: colors.charcoal }}>On hand: {scannedItem.onHand} · Par: {scannedItem.parLevel}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Button compact mode="contained" buttonColor={colors.success} onPress={() => { void recordInventoryMovement(scannedItem._id, 'received', 1); }}>+1 received</Button>
              <Button compact mode="contained" buttonColor={colors.danger} onPress={() => { void recordInventoryMovement(scannedItem._id, 'waste', -1); }}>-1 waste</Button>
              <Button compact mode="outlined" textColor={colors.muted} onPress={() => setScannedItem(null)}>Dismiss</Button>
            </View>
          </Card.Content>
        </Card>
      )}
      {scanMsg && !showScanner && <Text style={{ color: colors.danger }}>{scanMsg}</Text>}

      {/* Shrinkage / variance report */}
      {showShrinkage && <ShrinkageCard data={shrinkageData} />}

      {/* Purchase order */}
      {showPurchaseOrder && (
        <PurchaseOrderCard
          purchaseOrder={purchaseOrder}
          csv={purchaseOrderCsv}
          showCsv={showPurchaseOrderCsv}
          busy={busy}
          onToggleCsv={() => setShowPurchaseOrderCsv((v) => !v)}
          onEmail={async () => {
            setBusy(true); setMessage(null);
            try {
              const r = await sendPoEmail({});
              setMessage(r.sent ? `PO emailed to managers — ${r.itemCount} items.` : r.reason ?? 'Not sent.');
            } catch (e) { setMessage(errorMessage(e, 'Could not send PO email.')); }
            finally { setBusy(false); }
          }}
        />
      )}

      {/* Aging report */}
      {showAgingReport && <AgingCard report={agingReport} />}

      {showStockCsv && (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Stock snapshot CSV</Text>
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {stockCsv ?? 'Loading export...'}
            </Text>
          </Card.Content>
        </Card>
      )}

      {showMovementCsv && (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Movement log CSV (14 days)</Text>
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {movementCsv ?? 'Loading export...'}
            </Text>
          </Card.Content>
        </Card>
      )}

      {/* Usage velocity */}
      <VelocityCard velocity={velocity} />

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
          <InlineMessage message={message} />
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
          <View style={addItemRow}>
            <TextInput label="Area" value={area} onChangeText={setArea} mode="outlined" style={addItemWideField} />
            <TextInput label="Unit" value={unit} onChangeText={setUnit} mode="outlined" style={addItemWideField} />
          </View>
          <View style={addItemRow}>
            <TextInput label="Par" value={parLevel} onChangeText={setParLevel} keyboardType="numeric" mode="outlined" style={addItemNumberField} />
            <TextInput label="On hand" value={onHand} onChangeText={setOnHand} keyboardType="numeric" mode="outlined" style={addItemNumberField} />
            <TextInput label="Unit $" value={unitCost} onChangeText={setUnitCost} keyboardType="numeric" mode="outlined" style={addItemNumberField} />
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
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => void recordInventoryMovement(item._id, 'count', item.onHand)}>Count</Button>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => void recordInventoryMovement(item._id, 'received', 1)}>+1</Button>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => void recordInventoryMovement(item._id, 'waste', -1)}>-1</Button>
                  <Button compact mode="outlined" textColor={colors.muted} onPress={() => setHistoryItemId(historyItemId === item._id ? null : item._id)}>
                    {historyItemId === item._id ? 'Hide history' : 'History'}
                  </Button>
                  <Button compact mode="outlined" textColor={colors.muted} onPress={() => {
                    if (costHistoryItemId === item._id) { setCostHistoryItemId(null); return; }
                    setCostHistoryItemId(item._id);
                  }}>
                    {costHistoryItemId === item._id ? 'Hide price' : 'Price history'}
                  </Button>
                  <Button compact mode="outlined" textColor={colors.muted} onPress={() => {
                    if (editCostItemId === item._id) { setEditCostItemId(null); return; }
                    setEditCostItemId(item._id);
                    setEditCostValue(item.unitCostCents != null ? (item.unitCostCents / 100).toFixed(2) : '');
                  }}>
                    Update cost
                  </Button>
                </View>
                {editCostItemId === item._id && (
                  <View style={{ flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs }}>
                    <TextInput
                      label="New unit cost ($)"
                      value={editCostValue}
                      onChangeText={setEditCostValue}
                      keyboardType="numeric"
                      mode="outlined"
                      dense
                      style={{ flex: 1, backgroundColor: colors.surface }}
                    />
                    <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void saveCostUpdate(item._id)}>Save</Button>
                    <Button compact mode="text" textColor={colors.muted} onPress={() => setEditCostItemId(null)}>Cancel</Button>
                  </View>
                )}
                {historyItemId === item._id && venue?.id && (
                  <View style={{ paddingLeft: spacing.sm, paddingTop: spacing.xs }}>
                    <MovementTimeline itemId={item._id} />
                  </View>
                )}
                {costHistoryItemId === item._id && (
                  <View style={{ paddingLeft: spacing.sm, paddingTop: spacing.xs, gap: 4 }}>
                    {!costHistory ? (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Loading price history...</Text>
                    ) : costHistory.entries.length === 0 ? (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>No price changes recorded yet. Current: {money(costHistory.currentCostCents)}</Text>
                    ) : (
                      costHistory.entries.map((entry) => (
                        <View key={entry._id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                          <View>
                            <Text style={{ fontSize: 12 }}>
                              {money(entry.oldCostCents)} → <Text style={{ fontWeight: '700', color: entry.newCostCents > entry.oldCostCents ? colors.danger : colors.success }}>{money(entry.newCostCents)}</Text>
                            </Text>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>{entry.changedBy}</Text>
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>
                            {new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </View>
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
    </ManagerGate>
  );
}
