import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

type FloorTableState = {
  status: 'available' | 'seated' | 'dirty' | 'reserved' | 'held' | 'out_of_service';
  partySize: number | null;
  notes: string | null;
} | null;

type FloorTableRow = {
  table: {
    _id: string;
    label: string;
    shape: 'round' | 'square' | 'rect' | 'booth';
    seats: number;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    section: 'main' | 'patio' | 'bar' | 'vip';
    minSpend: number;
    isReservable: boolean;
  };
  state: FloorTableState;
};

type FloorData = {
  floorPlan: { name: string; width: number; height: number };
  tables: FloorTableRow[];
};

type DraftTable = FloorTableRow['table'] & { state: FloorTableState };

type EditorGestureState = {
  dx: number;
  dy: number;
};

type DraggableTableProps = {
  table: DraftTable;
  selected: boolean;
  onSelect: () => void;
  onMove: (nextX: number, nextY: number) => void;
};

const sectionColors: Record<FloorTableRow['table']['section'], string> = {
  main: '#C9A961',
  patio: '#8C6A4F',
  bar: '#A1643A',
  vip: '#C74B6C',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snap(value: number, grid = 8) {
  return Math.round(value / grid) * grid;
}

function DraggableTable({ table, selected, onSelect, onMove }: DraggableTableProps) {
  const position = useRef(new Animated.ValueXY({ x: table.x, y: table.y })).current;
  const startPosition = useRef({ x: table.x, y: table.y });

  useEffect(() => {
    position.setValue({ x: table.x, y: table.y });
  }, [position, table.x, table.y]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_: unknown, gesture: EditorGestureState) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => {
          startPosition.current = { x: table.x, y: table.y };
          onSelect();
        },
        onPanResponderMove: (_: unknown, gesture: EditorGestureState) => {
          const nextX = snap(clamp(startPosition.current.x + gesture.dx, 0, 1440 - table.width));
          const nextY = snap(clamp(startPosition.current.y + gesture.dy, 0, 960 - table.height));
          position.setValue({ x: nextX, y: nextY });
        },
        onPanResponderRelease: (_: unknown, gesture: EditorGestureState) => {
          const nextX = snap(clamp(startPosition.current.x + gesture.dx, 0, 1440 - table.width));
          const nextY = snap(clamp(startPosition.current.y + gesture.dy, 0, 960 - table.height));
          position.setValue({ x: nextX, y: nextY });
          onMove(nextX, nextY);
        },
      }),
    [onMove, onSelect, position, table.height, table.width, table.x, table.y],
  );

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: table.width,
        height: table.height,
        borderRadius: table.shape === 'round' ? 999 : table.shape === 'booth' ? 18 : 14,
        borderWidth: selected ? 3 : 2,
        borderColor: selected ? colors.cream : sectionColors[table.section],
        backgroundColor: `${sectionColors[table.section]}22`,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
        transform: [{ rotate: `${table.rotation}deg` }],
      }}
    >
      <Text style={{ color: colors.cream, fontWeight: '700' }}>{table.label}</Text>
      <Text style={{ color: colors.cream, fontSize: 12 }}>{table.seats} seats</Text>
    </Animated.View>
  );
}

export default function FloorEditorScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const user = useAuthStore((state: AuthState) => state.user);
  const floor = useQuery(api.floor.getActiveFloorPlan, venue?.id ? { venueId: venue.id } : 'skip') as FloorData | null | undefined;
  const stats = useQuery(api.floor.getFloorStats, venue?.id ? { venueId: venue.id } : 'skip');
  const saveFloorPlan = useMutation(api.floor.saveFloorPlan);
  const seedFloor = useMutation(api.seed.seedDemoFloorPlan);
  const [draftTables, setDraftTables] = useState<DraftTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const canEdit = user?.role === 'admin' || user?.role === 'owner';

  useEffect(() => {
    if (!floor) return;
    setDraftTables(floor.tables.map(({ table, state }) => ({ ...table, state })));
    setSelectedTableId((current: string | null) => current ?? floor.tables[0]?.table._id ?? null);
  }, [floor]);

  const selectedTable = useMemo(
    () => draftTables.find((item: DraftTable) => item._id === selectedTableId) ?? draftTables[0] ?? null,
    [draftTables, selectedTableId],
  );

  const onSeed = async () => {
    if (!venue?.id) return;
    await seedFloor({ venueId: venue.id });
  };

  const onPublish = async () => {
    if (!venue?.id) return;
    if (!floor) {
      await onSeed();
      return;
    }
    await saveFloorPlan({
      venueId: venue.id,
      name: floor.floorPlan.name,
      width: floor.floorPlan.width,
      height: floor.floorPlan.height,
      backgroundImageUrl: null,
      tables: draftTables.map((table: DraftTable) => ({
        label: table.label,
        shape: table.shape,
        seats: table.seats,
        x: table.x,
        y: table.y,
        width: table.width,
        height: table.height,
        rotation: table.rotation,
        section: table.section,
        minSpend: table.minSpend,
        isReservable: table.isReservable,
      })),
    });
  };

  const updateTablePosition = (tableId: string, nextX: number, nextY: number) => {
    setDraftTables((current: DraftTable[]) => current.map((table: DraftTable) => (table._id === tableId ? { ...table, x: nextX, y: nextY } : table)));
    setSelectedTableId(tableId);
  };

  const activeFloor = floor ?? null;

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontFamily: 'serif' }}>
          Floor Editor
        </Text>
        <Text style={{ color: colors.muted }}>
          Drag tables on the canvas, then save and publish the new floor plan.
        </Text>
      </View>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Status</Text>
          <Text>{activeFloor ? `Editing ${activeFloor.floorPlan.name}` : 'No active floor plan yet.'}</Text>
          <Text style={{ color: colors.muted }}>
            Occupied {stats?.occupiedCount ?? 0} · Waitlist {stats?.waitlistSize ?? 0}
          </Text>
          {canEdit ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button mode="contained" onPress={() => void onPublish()}>
                Save & Publish
              </Button>
              <Button mode="outlined" onPress={() => void onSeed()}>
                Seed sample floor
              </Button>
            </View>
          ) : null}
        </Card.Content>
      </Card>

      {activeFloor ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium">Drag canvas</Text>
            <Text style={{ color: colors.muted }}>
              Move tables around the floor layout. Positions snap to an 8px grid.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View
                  style={{
                    width: Math.max(activeFloor.floorPlan.width, 420),
                    height: Math.max(activeFloor.floorPlan.height, 300),
                    borderRadius: 24,
                    backgroundColor: '#18120E',
                    borderWidth: 1,
                    borderColor: '#2C241D',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {draftTables.map((table: DraftTable) => (
                    <View key={table._id} style={{ position: 'absolute', left: 0, top: 0 }}>
                      <DraggableTable
                        table={table}
                        selected={selectedTable?._id === table._id}
                        onSelect={() => setSelectedTableId(table._id)}
                        onMove={(nextX, nextY) => updateTablePosition(table._id, nextX, nextY)}
                      />
                    </View>
                  ))}
                </View>
              </ScrollView>
            </ScrollView>
          </Card.Content>
        </Card>
      ) : null}

      {selectedTable ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium">{selectedTable.label}</Text>
            <Text style={{ color: colors.muted }}>
              {selectedTable.section.toUpperCase()} · {selectedTable.shape} · {selectedTable.seats} seats
            </Text>
            <Text style={{ color: colors.muted }}>
              Position {selectedTable.x}, {selectedTable.y} · {selectedTable.minSpend > 0 ? `$${selectedTable.minSpend} min spend` : 'No minimum spend'}
            </Text>
            <Chip selected>{selectedTable.state?.status ?? 'available'}</Chip>
          </Card.Content>
        </Card>
      ) : null}
    </ScrollView>
  );
}