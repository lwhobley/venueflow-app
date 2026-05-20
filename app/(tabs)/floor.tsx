import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
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
  startsAt: number;
  endsAt: number;
};

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
  state: {
    status: keyof typeof statusColors;
    partySize: number | null;
    notes: string | null;
  } | null;
  activeAssignments: AssignmentRow[];
  nextAssignment: AssignmentRow | null;
};

type FloorData = {
  floorPlan: { name: string };
  tables: FloorTableRow[];
};

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

  const canEdit = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager' || user?.role === 'host';
  const activeFloor = floor ?? null;
  const reservationQueue = unassignedReservations ?? [];
  const waitlistQueue = openWaitlist ?? [];

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
      assignmentId: assignmentId as never,
      reason: 'Released from floor screen',
      actorRole: user?.role ?? 'staff',
    });
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontFamily: 'serif' }}>
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <View>
              <Text variant="titleMedium">Needs assignment</Text>
              <Text style={{ color: colors.muted }}>{needsAssignmentCount} reservations need a table</Text>
            </View>
            <Button mode="contained" buttonColor={colors.primary} onPress={() => router.push('/reservations')}>
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
            <Text style={{ color: colors.muted }}>Seed the sample floor plan to get started.</Text>
            {canEdit ? (
              <Button mode="contained" buttonColor={colors.primary} onPress={() => void onSeed()}>
                Seed sample floor
              </Button>
            ) : null}
          </Card.Content>
        </Card>
      ) : (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium">{activeFloor.floorPlan.name}</Text>
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
                    <Text style={{ color: colors.cream, fontWeight: '700' }}>{table.label}</Text>
                    <Text style={{ color: colors.cream, fontSize: 12 }}>{table.seats} seats</Text>
                    {currentAssignment ? (
                      <View style={{ marginTop: 4, alignItems: 'center' }}>
                        <Text style={{ color: colors.cream, fontSize: 11, fontWeight: '700' }}>{currentAssignment.guestName}</Text>
                        <Text style={{ color: colors.cream, fontSize: 10 }}>{formatTime(currentAssignment.startsAt)}</Text>
                      </View>
                    ) : nextAssignment ? (
                      <Text style={{ color: colors.cream, fontSize: 10, marginTop: 4 }}>Next · {nextAssignment.guestName}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </Card.Content>
        </Card>
      )}

      {selected ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text variant="titleMedium">{selected.table.label}</Text>
                <Text style={{ color: colors.muted }}>{selected.table.section.toUpperCase()} · {selected.table.seats} seats</Text>
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
                <Button mode="outlined" onPress={() => void markDirty({ tableId: selected.table._id })}>
                  Mark dirty
                </Button>
                <Button mode="outlined" onPress={() => void markClean({ tableId: selected.table._id })}>
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