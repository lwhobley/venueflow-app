import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { router } from 'expo-router';

const sectionFilters = ['all', 'main', 'patio', 'bar', 'vip'] as const;
const statusColors: Record<string, string> = {
  available: '#2E6B4A',
  seated: '#2F4C8F',
  dirty: '#B58A22',
  reserved: '#7043A3',
  held: '#6B6B73',
  out_of_service: '#A23D3D',
};
const statusLabels: Record<string, string> = {
  available: 'Available',
  seated: 'Seated',
  dirty: 'Dirty',
  reserved: 'Reserved',
  held: 'Held',
  out_of_service: 'Out of service',
};

type AssignmentRow = {
  assignmentId: string;
  holdType: 'reserved' | 'held' | 'seated';
  sourceType: 'reservation' | 'waitlist';
  guestName: string;
  partySize: number;
  source: string;
  tags: string[];
  notes: string | null;
  status: string;
  startsAt: number;
  endsAt: number;
};

type SeatLabelStyle = 'number' | 'letter' | 'none';

type FloorTableRow = {
  table: {
    _id: string;
    label: string;
    shape: 'round' | 'square' | 'rect' | 'booth';
    seats: number;
    seatLabelStyle?: SeatLabelStyle | null;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    section: 'main' | 'patio' | 'bar' | 'vip';
    minSpend: number;
    isReservable: boolean;
  };
  state: {
    status: keyof typeof statusColors;
    partySize: number | null;
    notes: string | null;
    mergeGroupId?: string | null;
  } | null;
  activeAssignments: AssignmentRow[];
  nextAssignment: AssignmentRow | null;
};

type FloorChair = { _id: string; x: number; y: number; rotation: number; label: string | null };

type FloorData = {
  floorPlan: { name: string };
  tables: FloorTableRow[];
  chairs?: FloorChair[];
};

function seatText(style: SeatLabelStyle, i: number): string {
  if (style === 'none') return '';
  if (style === 'letter') return String.fromCharCode(65 + (i % 26));
  return String(i + 1);
}

function chairPositions(shape: string, w: number, h: number, seats: number): { x: number; y: number }[] {
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
  const top = Math.ceil(seats / 2);
  const bottom = seats - top;
  for (let i = 0; i < top; i++) out.push({ x: ((i + 1) * w) / (top + 1), y: -9 });
  for (let i = 0; i < bottom; i++) out.push({ x: ((i + 1) * w) / (bottom + 1), y: h + 9 });
  return out;
}

type ReservationQueueItem = {
  id: string;
  guestName: string;
  partySize: number;
  reservationTime: number;
  durationMinutes: number;
  source: string;
  tags: string[];
  specialRequests: string | null;
  status: string;
  externalId: string | null;
};

type WaitlistItem = {
  id: string;
  guestName: string;
  partySize: number;
  requestedAt: number;
  source: string;
  status: string;
  notes: string | null;
};

type StatCard = { label: string; value: number | string };

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours > 0 ? `${hours}h ${remaining}m` : `${remaining}m`;
}

export default function FloorScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const user = useAuthStore((state: AuthState) => state.user);
  const [section, setSection] = useState<(typeof sectionFilters)[number]>('all');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const floor = useQuery(api.floorBinding.getActiveFloorPlan, venue?.id ? { venueId: venue.id } : 'skip') as FloorData | null | undefined;
  const stats = useQuery(api.floor.getFloorStats, venue?.id ? { venueId: venue.id } : 'skip');
  const unassignedReservations = useQuery(api.floorBinding.getUnassignedReservations, venue?.id ? { venueId: venue.id, withinMinutes: 120 } : 'skip') as ReservationQueueItem[] | null | undefined;
  const openWaitlist = useQuery(api.floorBinding.getOpenWaitlist, venue?.id ? { venueId: venue.id } : 'skip') as WaitlistItem[] | null | undefined;

  const seedFloor = useMutation(api.seed.seedDemoFloorPlan);
  const releaseAssignment = useMutation(api.floorBinding.releaseAssignment);
  const markDirty = useMutation(api.tables.markDirty);
  const markClean = useMutation(api.tables.markClean);
  const mergeTablesForParty = useMutation(api.tables.mergeTablesForParty);
  const splitMergedTables = useMutation(api.tables.splitMergedTables);

  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSel, setMergeSel] = useState<string[]>([]);
  const [mergeParty, setMergeParty] = useState(6);

  const canEdit = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const activeFloor = floor ?? null;
  const reservationQueue = unassignedReservations ?? [];
  const waitlistQueue = openWaitlist ?? [];

  const mergeableTables = useMemo(
    () => (activeFloor?.tables ?? []).filter((t: FloorTableRow) => !t.state || t.state.status === 'available' || t.state.status === 'dirty'),
    [activeFloor],
  );
  const mergeGroups = useMemo(() => {
    const groups = new Map<string, FloorTableRow[]>();
    for (const t of activeFloor?.tables ?? []) {
      const g = t.state?.mergeGroupId;
      if (!g) continue;
      const list = groups.get(g) ?? [];
      list.push(t);
      groups.set(g, list);
    }
    return Array.from(groups.entries());
  }, [activeFloor]);

  const toggleMerge = (id: string) => setMergeSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const doMerge = async () => {
    if (!venue?.id || mergeSel.length < 2) return;
    await mergeTablesForParty({ venueId: venue.id, tableIds: mergeSel as Id<'tables'>[], partySize: mergeParty });
    setMergeSel([]);
    setMergeOpen(false);
  };

  const filteredTables = useMemo(() => {
    if (!activeFloor) return [];
    return activeFloor.tables.filter((item: FloorTableRow) => section === 'all' || item.table.section === section);
  }, [activeFloor, section]);

  const selected = filteredTables.find((item: FloorTableRow) => item.table._id === selectedTableId) ?? filteredTables[0] ?? null;
  const selectedState = selected?.state ?? null;
  const selectedAssignments = selected?.activeAssignments ?? [];
  const selectedNextAssignment = selected?.nextAssignment ?? null;
  const needsAssignmentCount = reservationQueue.length;

  const onSeed = async () => {
    if (!venue?.id) return;
    await seedFloor({ venueId: venue.id });
  };

  const onRelease = async (assignmentId: string) => {
    if (!venue?.id) return;
    await releaseAssignment({
      venueId: venue.id,
      assignmentId: assignmentId as Id<'tableAssignments'>,
      reason: 'Released from floor screen',
      actorRole: user?.role ?? 'staff',
    });
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>
          Floor Plan
        </Text>
        <Text style={{ color: colors.muted }}>
          Live tables for {venue?.name ?? 'your venue'}.
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {([
          { label: 'Occupied', value: stats?.occupiedCount ?? 0 },
          { label: 'Avg turn', value: `${stats?.avgTurnTimeMinutes ?? 0}m` },
          { label: 'Longest seated', value: `${stats?.longestSeatedDurationMinutes ?? 0}m` },
          { label: 'Waitlist', value: stats?.waitlistSize ?? 0 },
        ] as StatCard[]).map((item) => (
          <Card key={item.label} style={{ backgroundColor: colors.surface, flexGrow: 1, minWidth: '46%' }}>
            <Card.Content style={{ gap: 4 }}>
              <Text style={{ color: colors.muted }}>{item.label}</Text>
              <Text variant="headlineSmall">{String(item.value)}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 180 }}>
              <Text variant="titleMedium">Needs assignment</Text>
              <Text style={{ color: colors.muted }}>{needsAssignmentCount} reservations need a table</Text>
            </View>
            <Button
              mode="contained"
              buttonColor={colors.primary}
              style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
              onPress={() => router.push('/reservations')}
            >
              Open reservations
            </Button>
          </View>
          <Text style={{ color: colors.muted }}>
            Use the dedicated reservations screen to assign queue items to tables.
          </Text>
        </Card.Content>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {sectionFilters.map((filter) => (
          <Chip key={filter} selected={section === filter} onPress={() => setSection(filter)}>
            {filter === 'all' ? 'All sections' : filter}
          </Chip>
        ))}
      </View>

      {!activeFloor ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium">No active floor plan yet</Text>
            <Text style={{ color: colors.muted }}>Build your own in the editor, or seed a sample to get started.</Text>
            {canEdit ? (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Button mode="contained" buttonColor={colors.primary} icon="pencil" onPress={() => router.push('/floor/editor')}>
                  Build floor plan
                </Button>
                <Button mode="outlined" textColor={colors.primary} onPress={() => void onSeed()}>
                  Seed sample
                </Button>
              </View>
            ) : null}
          </Card.Content>
        </Card>
      ) : (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="titleMedium">{activeFloor.floorPlan.name}</Text>
              {canEdit ? (
                <Button compact mode="outlined" textColor={colors.primary} icon="pencil" onPress={() => router.push('/floor/editor')}>
                  Edit
                </Button>
              ) : null}
            </View>
            <View
              style={{
                height: 560,
                borderRadius: 24,
                backgroundColor: '#18120E',
                borderWidth: 1,
                borderColor: '#2C241D',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {filteredTables.map(({ table, state, activeAssignments, nextAssignment }: FloorTableRow) => {
                const status = state?.status ?? 'available';
                const isSelected = selected?.table._id === table._id;
                const currentAssignment = activeAssignments?.[0] ?? null;
                return (
                  <Pressable
                    key={table._id}
                    onPress={() => setSelectedTableId(table._id)}
                    style={{
                      position: 'absolute',
                      left: table.x,
                      top: table.y,
                      width: table.width,
                      height: table.height,
                      transform: [{ rotate: `${table.rotation}deg` }],
                      borderRadius: table.shape === 'round' ? 999 : table.shape === 'booth' ? 18 : 14,
                      borderWidth: isSelected ? 3 : 2,
                      borderColor: isSelected ? colors.cream : statusColors[status] ?? colors.primary,
                      backgroundColor: `${statusColors[status] ?? colors.primary}20`,
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 8,
                    }}
                  >
                    {chairPositions(table.shape, table.width, table.height, table.seats).map((c, i) => {
                      const lbl = seatText((table.seatLabelStyle ?? 'number') as SeatLabelStyle, i);
                      const sz = lbl ? 16 : 10;
                      return (
                        <View
                          key={i}
                          pointerEvents="none"
                          style={{
                            position: 'absolute',
                            left: c.x - sz / 2,
                            top: c.y - sz / 2,
                            width: sz,
                            height: sz,
                            borderRadius: sz / 2,
                            backgroundColor: '#cbd2e0',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {lbl ? <Text style={{ fontSize: 9, fontWeight: '700', color: '#2a2f42' }}>{lbl}</Text> : null}
                        </View>
                      );
                    })}
                    <Text style={{ color: colors.cream, fontWeight: '700' }}>{table.label}</Text>
                    <Text style={{ color: colors.cream, fontSize: 12 }}>{table.seats} seats</Text>
                    {currentAssignment ? (
                      <View style={{ marginTop: 4, alignItems: 'center' }}>
                        <Text style={{ color: colors.cream, fontSize: 11, fontWeight: '700' }}>{currentAssignment.guestName}</Text>
                        <Text style={{ color: colors.cream, fontSize: 10 }}>{currentAssignment.partySize}p · {formatTime(currentAssignment.startsAt)}</Text>
                      </View>
                    ) : nextAssignment ? (
                      <Text style={{ color: colors.cream, fontSize: 10, marginTop: 4 }}>Next · {nextAssignment.guestName}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
              {(activeFloor.chairs ?? []).map((chair: FloorChair) => (
                <View
                  key={chair._id}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: chair.x,
                    top: chair.y,
                    width: 30,
                    height: 30,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ rotate: `${chair.rotation}deg` }],
                  }}
                >
                  <View style={{ width: '78%', height: '78%', borderRadius: 6, backgroundColor: '#9aa3b8' }} />
                  <View style={{ position: 'absolute', top: 0, width: '78%', height: '26%', borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: '#6b7488' }} />
                  {chair.label ? (
                    <View style={{ position: 'absolute', bottom: -13, width: 70, alignItems: 'center', left: 15 - 35 }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: '#cbd2e0' }} numberOfLines={1}>{chair.label}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </Card.Content>
        </Card>
      )}

      {canEdit && activeFloor ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>Merge tables</Text>
                <Text style={{ color: colors.muted }}>Combine available tables for larger parties, then split them when the party leaves.</Text>
              </View>
              <Button mode={mergeOpen ? 'contained-tonal' : 'outlined'} onPress={() => setMergeOpen((value) => !value)}>
                {mergeOpen ? 'Close' : 'Merge'}
              </Button>
            </View>

            {mergeGroups.length > 0 ? (
              <View style={{ gap: 8 }}>
                {mergeGroups.map(([groupId, tables]) => (
                  <View key={groupId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 6 }}>
                    <Text style={{ flex: 1, color: colors.muted }}>
                      {tables.map((table) => table.table.label).join(' + ')}
                    </Text>
                    <Button compact mode="outlined" onPress={() => venue?.id && void splitMergedTables({ venueId: venue.id, mergeGroupId: groupId })}>
                      Split
                    </Button>
                  </View>
                ))}
              </View>
            ) : null}

            {mergeOpen ? (
              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={{ color: colors.muted, flex: 1 }}>Party size</Text>
                  <Button compact mode="outlined" onPress={() => setMergeParty((value) => Math.max(2, value - 1))}>-</Button>
                  <Chip compact>{mergeParty}</Chip>
                  <Button compact mode="outlined" onPress={() => setMergeParty((value) => Math.min(50, value + 1))}>+</Button>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {mergeableTables.map((item) => {
                    const selectedForMerge = mergeSel.includes(item.table._id);
                    return (
                      <Chip
                        key={item.table._id}
                        selected={selectedForMerge}
                        onPress={() => toggleMerge(item.table._id)}
                        style={{ backgroundColor: selectedForMerge ? colors.primary : colors.background }}
                        textStyle={{ color: selectedForMerge ? '#fff' : colors.charcoal }}
                      >
                        {item.table.label}
                      </Chip>
                    );
                  })}
                </View>
                {mergeableTables.length === 0 ? <Text style={{ color: colors.muted }}>No available tables to merge right now.</Text> : null}
                <Button mode="contained" buttonColor={colors.primary} disabled={mergeSel.length < 2} onPress={() => void doMerge()}>
                  Merge selected
                </Button>
              </View>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}

      {selected ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text variant="titleMedium">{selected.table.label}</Text>
                <Text style={{ color: colors.muted }}>{selected.table.section === 'vip' ? 'VIP' : selected.table.section.charAt(0).toUpperCase() + selected.table.section.slice(1)} · {selected.table.seats} seats</Text>
              </View>
              <Chip selected style={{ backgroundColor: `${statusColors[selectedState?.status ?? 'available']}22` }}>
                {statusLabels[selectedState?.status ?? 'available']}
              </Chip>
            </View>
            <Text style={{ color: colors.muted }}>
              Party size {selectedState?.partySize ?? 0} · {selectedState?.notes ?? 'No notes'}
            </Text>

            {selectedAssignments.length > 0 ? (
              <View style={{ gap: 8 }}>
                {selectedAssignments.map((assignment: AssignmentRow) => (
                  <Card key={assignment.assignmentId} style={{ backgroundColor: '#201812' }}>
                    <Card.Content style={{ gap: 6 }}>
                      <Text style={{ color: colors.cream, fontWeight: '700' }}>{assignment.guestName}</Text>
                      <Text style={{ color: colors.cream, fontSize: 12 }}>
                        {assignment.source} · {formatTime(assignment.startsAt)} - {formatTime(assignment.endsAt)}
                      </Text>
                      <Text style={{ color: colors.cream, fontSize: 12 }}>Party of {assignment.partySize}</Text>
                      {assignment.notes ? <Text style={{ color: colors.cream, fontSize: 12 }}>{assignment.notes}</Text> : null}
                      {assignment.tags.length > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {assignment.tags.map((tag) => (
                            <Chip key={tag} compact style={{ backgroundColor: colors.cream }} textStyle={{ color: colors.charcoal }}>
                              {tag}
                            </Chip>
                          ))}
                        </View>
                      ) : null}
                      {canEdit ? (
                        <Button mode="text" textColor={colors.primary} onPress={() => void onRelease(assignment.assignmentId)}>
                          Release
                        </Button>
                      ) : null}
                    </Card.Content>
                  </Card>
                ))}
              </View>
            ) : selectedNextAssignment ? (
              <Text style={{ color: colors.muted }}>Next up: {selectedNextAssignment.guestName} · {formatTime(selectedNextAssignment.startsAt)}</Text>
            ) : null}

            {canEdit ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button mode="outlined" onPress={() => void markDirty({ tableId: selected.table._id as Id<'tables'> })}>
                  Mark dirty
                </Button>
                <Button mode="outlined" onPress={() => void markClean({ tableId: selected.table._id as Id<'tables'> })}>
                  Mark clean
                </Button>
              </View>
            ) : (
              <Text style={{ color: colors.muted }}>
                Staff can view tables, but only admins and managers can change table state.
              </Text>
            )}
          </Card.Content>
        </Card>
      ) : null}

      {canEdit && waitlistQueue.length > 0 ? null : null}
    </ScrollView>
  );
}
