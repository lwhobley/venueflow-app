import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Chip, IconButton, Text, TextInput } from 'react-native-paper';
import { router } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageVenue } from '../../lib/permissions';

type Shape = 'round' | 'square' | 'rect' | 'booth';
type Section = 'main' | 'patio' | 'bar' | 'vip';
type SeatLabelStyle = 'number' | 'letter' | 'none';

type DraftTable = {
  key: string;
  label: string;
  shape: Shape;
  seats: number;
  seatLabelStyle: SeatLabelStyle;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  section: Section;
  minSpend: number;
  isReservable: boolean;
};

function seatText(style: SeatLabelStyle, i: number): string {
  if (style === 'none') return '';
  if (style === 'letter') return String.fromCharCode(65 + (i % 26));
  return String(i + 1);
}

type DraftChair = {
  key: string;
  x: number;
  y: number;
  rotation: number;
  label: string;
};

const CHAIR_SIZE = 30;

const sectionColors: Record<Section, string> = {
  main: '#6D5DF6',
  patio: '#16A34A',
  bar: '#F59E0B',
  vip: '#EC4899',
};
const sections: Section[] = ['main', 'patio', 'bar', 'vip'];

const shapeDefaults: Record<Shape, { width: number; height: number; seats: number; label: string }> = {
  round: { width: 90, height: 90, seats: 4, label: 'Round' },
  square: { width: 90, height: 90, seats: 4, label: 'Square' },
  rect: { width: 150, height: 80, seats: 6, label: 'Table' },
  booth: { width: 130, height: 90, seats: 4, label: 'Booth' },
};

const MIN_SIZE = 50;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const snap = (v: number, grid = 10) => Math.round(v / grid) * grid;

// Chair (seat) positions around a table in table-local coordinates.
function chairPositions(shape: Shape, w: number, h: number, seats: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (seats <= 0) return out;
  if (shape === 'round') {
    const r = Math.max(w, h) / 2 + 9;
    for (let i = 0; i < seats; i++) {
      const a = (2 * Math.PI * i) / seats - Math.PI / 2;
      out.push({ x: w / 2 + r * Math.cos(a), y: h / 2 + r * Math.sin(a) });
    }
    return out;
  }
  // Rect/square/booth: split between top and bottom edges, overflow to sides.
  const top = Math.ceil(seats / 2);
  const bottom = seats - top;
  for (let i = 0; i < top; i++) out.push({ x: ((i + 1) * w) / (top + 1), y: -9 });
  for (let i = 0; i < bottom; i++) out.push({ x: ((i + 1) * w) / (bottom + 1), y: h + 9 });
  return out;
}

function TableNode({
  table,
  scale,
  selected,
  venueW,
  venueH,
  onSelect,
  onMove,
  onResize,
}: {
  table: DraftTable;
  scale: number;
  selected: boolean;
  venueW: number;
  venueH: number;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
}) {
  const pos = useRef(new Animated.ValueXY({ x: table.x, y: table.y })).current;
  const size = useRef(new Animated.ValueXY({ x: table.width, y: table.height })).current;
  const start = useRef({ x: table.x, y: table.y, w: table.width, h: table.height });

  useEffect(() => {
    pos.setValue({ x: table.x, y: table.y });
    size.setValue({ x: table.width, y: table.height });
  }, [pos, size, table.x, table.y, table.width, table.height]);

  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          start.current = { x: table.x, y: table.y, w: table.width, h: table.height };
          onSelect();
        },
        onPanResponderMove: (_e, g) => {
          pos.setValue({
            x: clamp(start.current.x + g.dx / scale, 0, venueW - table.width),
            y: clamp(start.current.y + g.dy / scale, 0, venueH - table.height),
          });
        },
        onPanResponderRelease: (_e, g) => {
          const nx = snap(clamp(start.current.x + g.dx / scale, 0, venueW - table.width));
          const ny = snap(clamp(start.current.y + g.dy / scale, 0, venueH - table.height));
          pos.setValue({ x: nx, y: ny });
          onMove(nx, ny);
        },
      }),
    [onMove, onSelect, pos, scale, table.height, table.width, table.x, table.y, venueH, venueW],
  );

  const resize = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = { x: table.x, y: table.y, w: table.width, h: table.height };
          onSelect();
        },
        onPanResponderMove: (_e, g) => {
          size.setValue({
            x: clamp(start.current.w + g.dx / scale, MIN_SIZE, venueW - table.x),
            y: clamp(start.current.h + g.dy / scale, MIN_SIZE, venueH - table.y),
          });
        },
        onPanResponderRelease: (_e, g) => {
          const nw = snap(clamp(start.current.w + g.dx / scale, MIN_SIZE, venueW - table.x));
          const nh = snap(clamp(start.current.h + g.dy / scale, MIN_SIZE, venueH - table.y));
          size.setValue({ x: nw, y: nh });
          onResize(nw, nh);
        },
      }),
    [onResize, onSelect, size, scale, table.height, table.width, table.x, table.y, venueH, venueW],
  );

  const color = sectionColors[table.section];
  const chairs = chairPositions(table.shape, table.width, table.height, table.seats);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: Animated.multiply(pos.x, scale),
        top: Animated.multiply(pos.y, scale),
        width: Animated.multiply(size.x, scale),
        height: Animated.multiply(size.y, scale),
      }}
    >
      {/* Attached seat chairs (appendages — move/rotate with the table) */}
      {chairs.map((c, i) => {
        const label = seatText(table.seatLabelStyle, i);
        const sz = label ? 16 : 10;
        return (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: c.x * scale - sz / 2,
              top: c.y * scale - sz / 2,
              width: sz,
              height: sz,
              borderRadius: sz / 2,
              backgroundColor: '#cbd2e0',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {label ? <Text style={{ fontSize: 9, fontWeight: '700', color: '#2a2f42' }}>{label}</Text> : null}
          </View>
        );
      })}
      <Animated.View
        {...drag.panHandlers}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: table.shape === 'round' ? 999 : table.shape === 'booth' ? 16 : 8,
          borderWidth: selected ? 3 : 2,
          borderColor: selected ? '#fff' : color,
          backgroundColor: `${color}33`,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: `${table.rotation}deg` }],
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{table.label}</Text>
        <Text style={{ color: '#fff', fontSize: 10 }}>{table.seats} seats</Text>
      </Animated.View>
      {selected ? (
        <View
          {...resize.panHandlers}
          style={{
            position: 'absolute',
            right: -10,
            bottom: -10,
            width: 22,
            height: 22,
            borderRadius: 6,
            backgroundColor: '#fff',
            borderWidth: 2,
            borderColor: color,
          }}
        />
      ) : null}
    </Animated.View>
  );
}

function ChairNode({
  chair,
  scale,
  selected,
  venueW,
  venueH,
  onSelect,
  onMove,
}: {
  chair: DraftChair;
  scale: number;
  selected: boolean;
  venueW: number;
  venueH: number;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const pos = useRef(new Animated.ValueXY({ x: chair.x, y: chair.y })).current;
  const start = useRef({ x: chair.x, y: chair.y });

  useEffect(() => {
    pos.setValue({ x: chair.x, y: chair.y });
  }, [pos, chair.x, chair.y]);

  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          start.current = { x: chair.x, y: chair.y };
          onSelect();
        },
        onPanResponderMove: (_e, g) => {
          pos.setValue({
            x: clamp(start.current.x + g.dx / scale, 0, venueW - CHAIR_SIZE),
            y: clamp(start.current.y + g.dy / scale, 0, venueH - CHAIR_SIZE),
          });
        },
        onPanResponderRelease: (_e, g) => {
          const nx = snap(clamp(start.current.x + g.dx / scale, 0, venueW - CHAIR_SIZE), 5);
          const ny = snap(clamp(start.current.y + g.dy / scale, 0, venueH - CHAIR_SIZE), 5);
          pos.setValue({ x: nx, y: ny });
          onMove(nx, ny);
        },
      }),
    [onMove, onSelect, pos, scale, chair.x, chair.y, venueH, venueW],
  );

  return (
    <Animated.View
      {...drag.panHandlers}
      style={{
        position: 'absolute',
        left: Animated.multiply(pos.x, scale),
        top: Animated.multiply(pos.y, scale),
        width: CHAIR_SIZE * scale,
        height: CHAIR_SIZE * scale,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ rotate: `${chair.rotation}deg` }],
      }}
    >
      {/* simple chair glyph: seat + backrest */}
      <View
        style={{
          width: '78%',
          height: '78%',
          borderRadius: 6,
          backgroundColor: selected ? '#fff' : '#9aa3b8',
          borderWidth: selected ? 2 : 0,
          borderColor: '#fff',
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          width: '78%',
          height: '26%',
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
          backgroundColor: selected ? '#fff' : '#6b7488',
        }}
      />
      {chair.label ? (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: -14 * scale, width: 80, alignItems: 'center', left: (CHAIR_SIZE * scale) / 2 - 40 }}>
          <Text style={{ fontSize: 9, fontWeight: '700', color: '#cbd2e0' }} numberOfLines={1}>{chair.label}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

export default function FloorEditorScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady, user } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const floor = useQuery(api.floor.getActiveFloorPlan, isReady && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const saveFloorPlan = useMutation(api.floor.saveFloorPlan);
  const clearActiveFloorPlan = useMutation(api.floor.clearActiveFloorPlan);

  const canEdit = canManageVenue(me?.profile.role ?? user?.role, me?.profile.allAccess ?? user?.all_access);

  const [tables, setTables] = useState<DraftTable[]>([]);
  const [chairs, setChairs] = useState<DraftChair[]>([]);
  const [venueW, setVenueW] = useState(1000);
  const [venueH, setVenueH] = useState(700);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedChairKey, setSelectedChairKey] = useState<string | null>(null);
  const [name, setName] = useState('Main Floor');
  const [saved, setSaved] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const counter = useRef(0);
  const chairCounter = useRef(0);

  useEffect(() => {
    if (!floor) return;
    setName(floor.floorPlan.name ?? 'Main Floor');
    setVenueW(Math.max(400, floor.floorPlan.width || 1000));
    setVenueH(Math.max(300, floor.floorPlan.height || 700));
    setTables(
      (floor.tables ?? []).map((t: any, i: number) => ({
        key: `t${i}`,
        label: t.table.label,
        shape: t.table.shape,
        seats: t.table.seats,
        seatLabelStyle: (t.table.seatLabelStyle ?? 'number') as SeatLabelStyle,
        x: t.table.x,
        y: t.table.y,
        width: t.table.width,
        height: t.table.height,
        rotation: t.table.rotation,
        section: t.table.section,
        minSpend: t.table.minSpend,
        isReservable: t.table.isReservable,
      })),
    );
    setChairs(
      (floor.chairs ?? []).map((c: any, i: number) => ({
        key: `c${i}`,
        x: c.x,
        y: c.y,
        rotation: c.rotation,
        label: c.label ?? '',
      })),
    );
  }, [floor]);

  const selected = useMemo(() => tables.find((t) => t.key === selectedKey) ?? null, [tables, selectedKey]);
  const selectedChair = useMemo(() => chairs.find((c) => c.key === selectedChairKey) ?? null, [chairs, selectedChairKey]);

  const selectTable = (key: string) => {
    setSelectedKey(key);
    setSelectedChairKey(null);
  };
  const selectChair = (key: string) => {
    setSelectedChairKey(key);
    setSelectedKey(null);
  };
  const clearSelection = () => {
    setSelectedKey(null);
    setSelectedChairKey(null);
  };

  const updateChair = (key: string, patch: Partial<DraftChair>) =>
    setChairs((cur) => cur.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const addChair = () => {
    const key = `newc_${chairCounter.current++}_${Date.now()}`;
    setChairs((cur) => [
      ...cur,
      { key, x: snap(clamp(venueW / 2 - CHAIR_SIZE / 2, 0, venueW - CHAIR_SIZE), 5), y: snap(clamp(venueH / 2 - CHAIR_SIZE / 2, 0, venueH - CHAIR_SIZE), 5), rotation: 0, label: '' },
    ]);
    selectChair(key);
  };

  const deleteSelectedChair = () => {
    if (!selectedChair) return;
    setChairs((cur) => cur.filter((c) => c.key !== selectedChair.key));
    setSelectedChairKey(null);
  };

  const screenW = Dimensions.get('window').width;
  const canvasW = Math.min(screenW - spacing.lg * 2, 720);
  const scale = canvasW / venueW;
  const canvasH = venueH * scale;

  const update = (key: string, patch: Partial<DraftTable>) =>
    setTables((cur) => cur.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const addTable = (shape: Shape) => {
    const d = shapeDefaults[shape];
    const key = `new_${counter.current++}_${Date.now()}`;
    const count = tables.length + 1;
    setTables((cur) => [
      ...cur,
      {
        key,
        label: `${d.label} ${count}`,
        shape,
        seats: d.seats,
        seatLabelStyle: 'number',
        x: snap(clamp(venueW / 2 - d.width / 2, 0, venueW - d.width)),
        y: snap(clamp(venueH / 2 - d.height / 2, 0, venueH - d.height)),
        width: d.width,
        height: d.height,
        rotation: 0,
        section: 'main',
        minSpend: 0,
        isReservable: true,
      },
    ]);
    selectTable(key);
  };

  const deleteSelected = () => {
    if (!selected) return;
    setTables((cur) => cur.filter((t) => t.key !== selected.key));
    setSelectedKey(null);
  };

  const onPublish = async () => {
    if (!venue?.id) return;
    await saveFloorPlan({
      venueId: venue.id,
      name: name.trim() || 'Main Floor',
      width: venueW,
      height: venueH,
      backgroundImageUrl: null,
      tables: tables.map((t) => ({
        label: t.label,
        shape: t.shape,
        seats: t.seats,
        seatLabelStyle: t.seatLabelStyle,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        section: t.section,
        minSpend: t.minSpend,
        isReservable: t.isReservable,
      })),
      chairs: chairs.map((c) => ({ x: c.x, y: c.y, rotation: c.rotation, label: c.label || undefined })),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const onClearFloorPlan = async () => {
    if (!venue?.id) return;
    setTables([]);
    setChairs([]);
    setSelectedKey(null);
    setSelectedChairKey(null);
    setClearMessage(null);
    const result = await clearActiveFloorPlan({ venueId: venue.id });
    setClearMessage(`Cleared ${result.deletedTables} table${result.deletedTables === 1 ? '' : 's'} and ${result.deletedChairs} chair${result.deletedChairs === 1 ? '' : 's'}.`);
    setTimeout(() => setClearMessage(null), 3000);
  };

  if (!canEdit) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Only managers and admins can edit the floor plan.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton icon="arrow-left" onPress={() => router.back()} />
        <View>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Floor editor</Text>
          <Text style={{ color: colors.muted }}>Drag to move · drag the corner to resize · tap to select.</Text>
        </View>
      </View>

      {/* Add shapes */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Add to floor</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button mode="contained-tonal" icon="circle-outline" onPress={() => addTable('round')}>Circle</Button>
            <Button mode="contained-tonal" icon="square-outline" onPress={() => addTable('square')}>Square</Button>
            <Button mode="contained-tonal" icon="rectangle-outline" onPress={() => addTable('rect')}>Rectangle</Button>
            <Button mode="contained-tonal" icon="sofa-outline" onPress={() => addTable('booth')}>Booth</Button>
            <Button mode="contained-tonal" icon="seat-outline" onPress={addChair}>Chair</Button>
            <Button mode="outlined" textColor={colors.danger} icon="delete-sweep-outline" onPress={() => void onClearFloorPlan()}>Clear floor plan</Button>
          </View>
          {clearMessage ? <Text style={{ color: colors.muted }}>{clearMessage}</Text> : null}
        </Card.Content>
      </Card>

      {/* Venue size */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Venue size</Text>
          <Text style={{ color: colors.muted }}>Resize the room rectangle to fit your venue.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ width: 56 }}>Width</Text>
            <IconButton icon="minus" mode="outlined" size={16} onPress={() => setVenueW((w) => Math.max(400, w - 100))} />
            <Text style={{ minWidth: 48, textAlign: 'center' }}>{venueW}</Text>
            <IconButton icon="plus" mode="outlined" size={16} onPress={() => setVenueW((w) => Math.min(2400, w + 100))} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ width: 56 }}>Height</Text>
            <IconButton icon="minus" mode="outlined" size={16} onPress={() => setVenueH((h) => Math.max(300, h - 100))} />
            <Text style={{ minWidth: 48, textAlign: 'center' }}>{venueH}</Text>
            <IconButton icon="plus" mode="outlined" size={16} onPress={() => setVenueH((h) => Math.min(2000, h + 100))} />
          </View>
        </Card.Content>
      </Card>

      {/* Service-area legend */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Service areas</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {sections.map((s) => (
              <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: sectionColors[s] }} />
                <Text style={{ textTransform: 'capitalize' }}>{s}</Text>
              </View>
            ))}
          </View>
        </Card.Content>
      </Card>

      {/* Canvas */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View
            style={{
              width: canvasW,
              height: canvasH,
              alignSelf: 'center',
              borderRadius: 16,
              backgroundColor: '#11141f',
              borderWidth: 2,
              borderColor: '#2a2f42',
              overflow: 'hidden',
            }}
          >
            <Pressable style={{ width: '100%', height: '100%' }} onPress={clearSelection}>
              {tables.map((t) => (
                <TableNode
                  key={t.key}
                  table={t}
                  scale={scale}
                  selected={selected?.key === t.key}
                  venueW={venueW}
                  venueH={venueH}
                  onSelect={() => selectTable(t.key)}
                  onMove={(x, y) => update(t.key, { x, y })}
                  onResize={(w, h) => update(t.key, { width: w, height: h })}
                />
              ))}
              {chairs.map((c) => (
                <ChairNode
                  key={c.key}
                  chair={c}
                  scale={scale}
                  selected={selectedChair?.key === c.key}
                  venueW={venueW}
                  venueH={venueH}
                  onSelect={() => selectChair(c.key)}
                  onMove={(x, y) => updateChair(c.key, { x, y })}
                />
              ))}
            </Pressable>
          </View>
          {tables.length === 0 && chairs.length === 0 ? (
            <Text style={{ color: colors.muted, textAlign: 'center' }}>Add a table or chair above to start building your floor.</Text>
          ) : null}
        </Card.Content>
      </Card>

      {/* Selected table inspector */}
      {selected ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>{selected.label}</Text>
              <Button compact mode="text" textColor={colors.danger} icon="delete" onPress={deleteSelected}>Delete</Button>
            </View>

            <TextInput label="Label" value={selected.label} onChangeText={(v) => update(selected.key, { label: v })} mode="outlined" style={{ backgroundColor: colors.surface }} />

            <Text style={{ color: colors.muted }}>Shape</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['round', 'square', 'rect', 'booth'] as Shape[]).map((sh) => (
                <Chip key={sh} selected={selected.shape === sh} onPress={() => update(selected.key, { shape: sh })}>
                  {sh === 'round' ? 'Circle' : sh === 'rect' ? 'Rectangle' : sh.charAt(0).toUpperCase() + sh.slice(1)}
                </Chip>
              ))}
            </View>

            <Text style={{ color: colors.muted }}>Service area</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {sections.map((s) => (
                <Chip
                  key={s}
                  selected={selected.section === s}
                  onPress={() => update(selected.key, { section: s })}
                  style={{ backgroundColor: selected.section === s ? sectionColors[s] : colors.cream }}
                  textStyle={{ color: selected.section === s ? '#fff' : colors.charcoal }}
                >
                  {s}
                </Chip>
              ))}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ width: 64 }}>Seats</Text>
              <IconButton icon="minus" mode="outlined" size={16} onPress={() => update(selected.key, { seats: Math.max(0, selected.seats - 1) })} />
              <Text style={{ minWidth: 28, textAlign: 'center' }}>{selected.seats}</Text>
              <IconButton icon="plus" mode="outlined" size={16} onPress={() => update(selected.key, { seats: Math.min(20, selected.seats + 1) })} />
            </View>

            <Text style={{ color: colors.muted }}>Seat labels</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['number', 'letter', 'none'] as SeatLabelStyle[]).map((st) => (
                <Chip key={st} selected={selected.seatLabelStyle === st} onPress={() => update(selected.key, { seatLabelStyle: st })}>
                  {st === 'number' ? '1, 2, 3' : st === 'letter' ? 'A, B, C' : 'Hidden'}
                </Chip>
              ))}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ width: 64 }}>Rotate</Text>
              <IconButton icon="rotate-left" mode="outlined" size={16} onPress={() => update(selected.key, { rotation: (selected.rotation - 15 + 360) % 360 })} />
              <Text style={{ minWidth: 40, textAlign: 'center' }}>{selected.rotation}°</Text>
              <IconButton icon="rotate-right" mode="outlined" size={16} onPress={() => update(selected.key, { rotation: (selected.rotation + 15) % 360 })} />
            </View>

            <Chip
              icon={selected.isReservable ? 'check' : 'close'}
              selected={selected.isReservable}
              onPress={() => update(selected.key, { isReservable: !selected.isReservable })}
              style={{ alignSelf: 'flex-start' }}
            >
              {selected.isReservable ? 'Reservable' : 'Not reservable'}
            </Chip>
          </Card.Content>
        </Card>
      ) : null}

      {selectedChair ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>Chair{selectedChair.label ? ` · ${selectedChair.label}` : ''}</Text>
              <Button compact mode="text" textColor={colors.danger} icon="delete" onPress={deleteSelectedChair}>Delete</Button>
            </View>
            <TextInput label="Label (e.g. Bar 1)" value={selectedChair.label} onChangeText={(v) => updateChair(selectedChair.key, { label: v })} mode="outlined" style={{ backgroundColor: colors.surface }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ width: 64 }}>Rotate</Text>
              <IconButton icon="rotate-left" mode="outlined" size={16} onPress={() => updateChair(selectedChair.key, { rotation: (selectedChair.rotation - 15 + 360) % 360 })} />
              <Text style={{ minWidth: 40, textAlign: 'center' }}>{selectedChair.rotation}°</Text>
              <IconButton icon="rotate-right" mode="outlined" size={16} onPress={() => updateChair(selectedChair.key, { rotation: (selectedChair.rotation + 15) % 360 })} />
            </View>
            <Text style={{ color: colors.muted }}>Drag the chair on the canvas to position it.</Text>
          </Card.Content>
        </Card>
      ) : null}

      <Button mode="contained" buttonColor={colors.primary} icon="content-save" onPress={() => void onPublish()}>
        Save & publish floor plan
      </Button>
      {saved ? <Text style={{ color: accents[2].fg, textAlign: 'center' }}>Saved ✓</Text> : null}
    </ScrollView>
  );
}
