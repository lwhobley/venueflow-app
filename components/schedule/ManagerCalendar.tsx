import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseTime(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

type ManagerShift = {
  _id: Id<'scheduleShifts'>;
  dayIndex: number;
  startTime: string;
  endTime: string;
  jobTitle: string;
  station: string;
  status: 'scheduled' | 'open' | 'covered';
  profileId: Id<'profiles'> | null;
  memberName: string | null;
  conflict: boolean;
};

type Staff = { _id: Id<'profiles'>; fullName: string; role: string; jobTitle: string; weeklyHours: number; overtime: boolean };
type Template = { _id: Id<'scheduleTemplates'>; name: string; shiftCount: number };

export function ManagerCalendar({ venueId }: { venueId: Id<'venues'> }) {
  const data = useQuery(api.scheduling.getManagerSchedule, { venueId });
  const templates = useQuery(api.scheduling.listScheduleTemplates, { venueId });
  const createShift = useMutation(api.scheduling.createShift);
  const assignShift = useMutation(api.scheduling.assignShift);
  const unassignShift = useMutation(api.scheduling.unassignShift);
  const deleteShift = useMutation(api.scheduling.deleteShift);
  const publishSchedule = useMutation(api.scheduling.publishSchedule);
  const saveTemplate = useMutation(api.scheduling.saveScheduleTemplate);
  const applyTemplate = useMutation(api.scheduling.applyScheduleTemplate);
  const deleteTemplate = useMutation(api.scheduling.deleteScheduleTemplate);
  const copyDayShifts = useMutation(api.scheduling.copyDayShifts);
  const clearWeek = useMutation(api.scheduling.clearWeek);
  const setLaborBudget = useMutation(api.scheduling.setLaborBudget);

  const [pickedStaff, setPickedStaff] = useState<Id<'profiles'> | null>(null);
  const [day, setDay] = useState(1);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [jobTitle, setJobTitle] = useState('Server');
  const [station, setStation] = useState('Floor');
  const [templateName, setTemplateName] = useState('');
  const [copyFrom, setCopyFrom] = useState(1);
  const [budgetInput, setBudgetInput] = useState('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const templateList = useMemo(() => (templates ?? []) as Template[], [templates]);
  const laborBudget = data?.laborBudgetHours ?? null;
  const totalHours = data?.totalScheduledHours ?? 0;
  const overBudget = laborBudget != null && totalHours > laborBudget;

  const flash = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 2500);
  };

  const shifts = useMemo(() => (data?.shifts ?? []) as ManagerShift[], [data]);
  const staff = useMemo(() => (data?.staff ?? []) as Staff[], [data]);
  const pickedName = staff.find((s) => s._id === pickedStaff)?.fullName ?? null;

  // Shift pool grouped by position (jobTitle) so managers can assign by role.
  const staffByPosition = useMemo(() => {
    const groups = new Map<string, Staff[]>();
    for (const s of staff) {
      const key = s.jobTitle?.trim() || 'Unassigned';
      const list = groups.get(key) ?? [];
      list.push(s);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .map(([position, members]) => ({ position, members: members.sort((a, b) => a.fullName.localeCompare(b.fullName)) }))
      .sort((a, b) => a.position.localeCompare(b.position));
  }, [staff]);

  const onCreate = async () => {
    const s = parseTime(start);
    const e = parseTime(end);
    if (s === null || e === null || e <= s) return;
    await createShift({
      venueId,
      dayIndex: day,
      startMinutes: s,
      endMinutes: e,
      jobTitle: jobTitle.trim() || 'Staff',
      station: station.trim() || 'Floor',
      profileId: pickedStaff ?? undefined,
    });
  };

  const onAssign = async (shiftId: Id<'scheduleShifts'>) => {
    if (!pickedStaff) return;
    await assignShift({ venueId, shiftId, profileId: pickedStaff });
  };

  if (data === undefined) {
    return <Text style={{ color: colors.muted }}>Loading schedule…</Text>;
  }

  return (
    <View style={{ gap: spacing.md }}>
      {/* Schedule actions */}
      <Card style={{ backgroundColor: overBudget ? '#FDE7E9' : accents[0].bg, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ fontWeight: '700', color: overBudget ? colors.danger : accents[0].fg }}>
              {totalHours}h scheduled{laborBudget != null ? ` / ${laborBudget}h budget` : ''}
            </Text>
            {overBudget ? <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠ Over budget</Text> : null}
          </View>
          <Button mode="contained" buttonColor={colors.primary} icon="bell-ring" onPress={async () => { const r = await publishSchedule({ venueId }); flash(`Published — notified ${r.notified} staff.`); }}>
            Publish & notify staff
          </Button>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <TextInput label="Weekly labor budget (h)" value={budgetInput} onChangeText={setBudgetInput} keyboardType="number-pad" mode="outlined" dense style={{ flex: 1, backgroundColor: colors.surface }} />
            <Button mode="outlined" textColor={colors.primary} onPress={async () => { await setLaborBudget({ venueId, weeklyLaborBudgetHours: budgetInput.trim() ? Number(budgetInput) : null }); setBudgetInput(''); flash('Labor budget saved.'); }}>Set</Button>
          </View>
          {actionMsg ? <Text style={{ color: accents[2].fg }}>{actionMsg}</Text> : null}
        </Card.Content>
      </Card>

      {/* Templates & quick copy */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Templates & copy</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="Save current week as…" value={templateName} onChangeText={setTemplateName} mode="outlined" dense style={{ flex: 1, backgroundColor: colors.surface }} />
            <Button mode="outlined" textColor={colors.primary} onPress={async () => { if (!templateName.trim()) return; await saveTemplate({ venueId, name: templateName.trim() }); setTemplateName(''); flash('Template saved.'); }}>Save</Button>
          </View>
          {templateList.length > 0 ? (
            <View style={{ gap: 6 }}>
              {templateList.map((t) => (
                <View key={t._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1 }}>{t.name} · {t.shiftCount} shifts</Text>
                  <Button compact mode="text" textColor={colors.primary} onPress={async () => { const r = await applyTemplate({ venueId, templateId: t._id, replace: true }); flash(`Applied ${r.added} shifts.`); }}>Apply</Button>
                  <Button compact mode="text" textColor={colors.danger} onPress={() => void deleteTemplate({ venueId, templateId: t._id })}>✕</Button>
                </View>
              ))}
            </View>
          ) : <Text style={{ color: colors.muted }}>No templates yet.</Text>}
          <Text style={{ color: colors.muted }}>Copy a day to the rest of the week</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {dayLabels.map((label, i) => (
                <Chip key={label} selected={copyFrom === i} onPress={() => setCopyFrom(i)} style={{ backgroundColor: copyFrom === i ? accents[3].bg : colors.cream }} textStyle={{ color: copyFrom === i ? accents[3].fg : colors.charcoal }}>{label}</Chip>
              ))}
            </View>
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Button compact mode="outlined" textColor={colors.primary} onPress={async () => { const to = [0,1,2,3,4,5,6].filter((d) => d !== copyFrom); const r = await copyDayShifts({ venueId, fromDay: copyFrom, toDays: to }); flash(`Copied ${r.added} shifts.`); }}>Copy {dayLabels[copyFrom]} → all days</Button>
            <Button compact mode="text" textColor={colors.danger} onPress={async () => { const r = await clearWeek({ venueId }); flash(`Cleared ${r.removed} shifts.`); }}>Clear week</Button>
          </View>
        </Card.Content>
      </Card>

      {/* Staff picker (tap to pick up) */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Shift pool</Text>
          <Text style={{ color: colors.muted }}>
            {pickedName ? `Picked: ${pickedName}. Tap a shift's "Assign here".` : 'Staff grouped by position. Tap a teammate to pick them up, then tap a shift to assign.'}
          </Text>
          {staff.length === 0 ? (
            <Text style={{ color: colors.muted }}>No staff yet. Add team members from the Staff tab.</Text>
          ) : (
            staffByPosition.map((group, gi) => {
              const accent = accents[gi % accents.length];
              return (
                <View key={group.position} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontWeight: '700', color: accent.fg }}>{group.position}</Text>
                    <Chip compact style={{ backgroundColor: accent.bg }} textStyle={{ color: accent.fg }}>{group.members.length}</Chip>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {group.members.map((s) => (
                      <Chip
                        key={s._id}
                        selected={pickedStaff === s._id}
                        onPress={() => setPickedStaff(pickedStaff === s._id ? null : s._id)}
                        style={{ backgroundColor: pickedStaff === s._id ? accent.fg : s.overtime ? '#FDE7E9' : colors.cream }}
                        textStyle={{ color: pickedStaff === s._id ? '#fff' : s.overtime ? colors.danger : colors.charcoal }}
                      >
                        {s.fullName} · {s.weeklyHours}h{s.overtime ? ' ⚠ OT' : ''}
                      </Chip>
                    ))}
                  </View>
                </View>
              );
            })
          )}
        </Card.Content>
      </Card>

      {/* Add shift */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Add a shift</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {dayLabels.map((label, i) => (
                <Chip key={label} selected={day === i} onPress={() => setDay(i)} style={{ backgroundColor: day === i ? accents[3].bg : colors.cream }} textStyle={{ color: day === i ? accents[3].fg : colors.charcoal }}>
                  {label}
                </Chip>
              ))}
            </View>
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="Start (HH:MM)" value={start} onChangeText={setStart} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
            <TextInput label="End (HH:MM)" value={end} onChangeText={setEnd} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="Role" value={jobTitle} onChangeText={setJobTitle} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
            <TextInput label="Station" value={station} onChangeText={setStation} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
          </View>
          <Button mode="contained" buttonColor={colors.primary} onPress={() => void onCreate()}>
            {pickedName ? `Add shift for ${pickedName}` : 'Add open shift'}
          </Button>
        </Card.Content>
      </Card>

      {/* Week grid */}
      {dayLabels.map((label, dayIndex) => {
        const dayShifts = shifts.filter((s) => s.dayIndex === dayIndex);
        return (
          <Card key={label} style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>{label}</Text>
                <Chip compact>{dayShifts.length} shift{dayShifts.length === 1 ? '' : 's'}</Chip>
              </View>
              {dayShifts.length === 0 ? (
                <Text style={{ color: colors.muted }}>No shifts.</Text>
              ) : (
                dayShifts.map((shift) => {
                  const bg = shift.conflict ? '#FDE7E9' : shift.status === 'open' ? accents[4].bg : colors.cream;
                  const border = shift.conflict ? colors.danger : 'transparent';
                  return (
                    <View key={shift._id} style={{ padding: 12, borderRadius: 12, backgroundColor: bg, borderWidth: shift.conflict ? 1.5 : 0, borderColor: border, gap: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontWeight: '700' }}>{shift.startTime} – {shift.endTime}</Text>
                        {shift.conflict ? <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠ Conflict</Text> : null}
                      </View>
                      <Text>{shift.jobTitle} · {shift.station}</Text>
                      <Text style={{ color: shift.memberName ? colors.charcoal : colors.danger }}>
                        {shift.memberName ?? 'Open — needs coverage'}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                        {pickedStaff ? (
                          <Button compact mode="contained" buttonColor={accents[0].fg} onPress={() => void onAssign(shift._id)}>
                            Assign here
                          </Button>
                        ) : null}
                        {shift.profileId ? (
                          <Button compact mode="outlined" textColor={colors.primary} onPress={() => void unassignShift({ venueId, shiftId: shift._id })}>
                            Unassign
                          </Button>
                        ) : null}
                        <Button compact mode="text" textColor={colors.danger} onPress={() => void deleteShift({ venueId, shiftId: shift._id })}>
                          Delete
                        </Button>
                      </View>
                    </View>
                  );
                })
              )}
            </Card.Content>
          </Card>
        );
      })}
    </View>
  );
}
