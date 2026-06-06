import { useMemo, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { Button, Card, Chip, Menu, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { useMutation as useRQMutation, useQuery as useRQQuery, useQueryClient } from '@tanstack/react-query';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { useApiClient } from '../../lib/api-client';
import type { Role } from '../../lib/types';

type VenueRole = { _id: string; name: string };
type AccessRole = 'manager' | 'staff';

const ACCESS_LEVELS: Array<{ value: 'admin' | 'manager' | 'staff'; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'staff', label: 'Staff' },
];
const LINK_ACCESS_LEVELS: Array<{ value: AccessRole; label: string }> = [
  { value: 'manager', label: 'Manager' },
  { value: 'staff', label: 'Staff' },
];

const JOB_ROLES = [
  'Manager', 'Asst Manager', 'Supervisor', 'Server', 'Bartender', 'Host',
  'Chef', 'Cook', 'Dishwasher', 'Cleaner', 'Busser', 'Barback', 'Temp', 'Contractor',
];

function Dropdown({
  label,
  value,
  placeholder,
  options,
  onSelect,
  style,
}: {
  label?: string;
  value: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
  style?: object;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={style}>
      {label ? <Text style={{ color: colors.muted, marginBottom: 4 }}>{label}</Text> : null}
      <Menu
        visible={open}
        onDismiss={() => setOpen(false)}
        anchor={
          <Button
            mode="outlined"
            textColor={colors.charcoal}
            onPress={() => setOpen(true)}
            contentStyle={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}
            icon={() => <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 18 }}>▾</Text>}
            style={{ borderColor: colors.border, justifyContent: 'flex-start' }}
          >
            {current?.label ?? value ?? placeholder ?? 'Select…'}
          </Button>
        }
        contentStyle={{ maxHeight: 280 }}
      >
        <ScrollView style={{ maxHeight: 280 }}>
          {options.map((opt) => (
            <Menu.Item
              key={opt.value}
              title={opt.label}
              onPress={() => {
                onSelect(opt.value);
                setOpen(false);
              }}
            />
          ))}
        </ScrollView>
      </Menu>
    </View>
  );
}

type StaffMember = {
  _id: string;
  fullName: string;
  email: string;
  role: Exclude<Role, 'host'>;
  jobTitle: string;
  venueId: string | null;
};

export default function StaffScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady, canManage } = useAuthenticatedSession();
  const request = useApiClient();
  const queryClient = useQueryClient();
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [jobTitle, setJobTitle] = useState('Team Member');

  // Staff list — REST
  const { data: staffData, isError: staffQueryError } = useRQQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => (await request('GET', '/v1/staff')) as StaffMember[],
    enabled: isReady && canManage,
  });
  const staff = staffData ?? [];

  const upsertStaffMutation = useRQMutation({
    mutationFn: (body: { email: string; fullName: string; role: string; jobTitle: string }) =>
      request('POST', '/v1/staff', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });

  const deactivateStaffMutation = useRQMutation({
    mutationFn: (id: string) => request('DELETE', `/v1/staff/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });

  // Custom roles + invite links — still on Convex (no NestJS endpoints yet)
  const rolesQuery = useQuery(
    api.staffAuth.listVenueRoles,
    isReady && venue?.id && canManage ? { venueId: venue.id } : 'skip',
  );
  const customRoles = useMemo(() => (rolesQuery ?? []) as VenueRole[], [rolesQuery]);
  const jobRoleOptions = useMemo(() => {
    const seen = new Set(JOB_ROLES.map((r) => r.toLowerCase()));
    const merged = [...JOB_ROLES];
    for (const r of customRoles) {
      if (!seen.has(r.name.toLowerCase())) {
        merged.push(r.name);
        seen.add(r.name.toLowerCase());
      }
    }
    return merged.map((name) => ({ value: name, label: name }));
  }, [customRoles]);
  const addVenueRole = useMutation(api.staffAuth.addVenueRole);
  const removeVenueRole = useMutation(api.staffAuth.removeVenueRole);
  const createInvite = useMutation(api.invites.createInvite);

  const [inviteLinkRole, setInviteLinkRole] = useState<'manager' | 'staff'>('staff');
  const [inviteLinkPosition, setInviteLinkPosition] = useState('');
  const [inviteLinkMsg, setInviteLinkMsg] = useState<string | null>(null);
  const [inviteLinkErr, setInviteLinkErr] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [newRole, setNewRole] = useState('');

  const onGenerateInviteLink = async () => {
    if (!venue?.id) return;
    setInviteLinkErr(null);
    setInviteLinkMsg(null);
    setGeneratingLink(true);
    try {
      const { inviteUrl } = await createInvite({
        venueId: venue.id,
        role: inviteLinkRole,
        jobTitle: inviteLinkPosition.trim() || 'Team Member',
      });
      await Share.share({ message: `Join ${venue.name} on Venue Wrangler: ${inviteUrl}` });
      setInviteLinkMsg('Invite link generated and ready to share. It expires in 7 days.');
    } catch (e) {
      setInviteLinkErr(e instanceof Error ? e.message : 'Could not generate link.');
    } finally {
      setGeneratingLink(false);
    }
  };

  const onAddRole = async () => {
    if (!venue?.id || !newRole.trim()) return;
    try {
      await addVenueRole({ venueId: venue.id, name: newRole.trim() });
      setNewRole('');
    } catch {
      // ignore duplicate
    }
  };

  const selectedStaff = staff.find((member) => member._id === selectedStaffId) ?? null;

  const fillFromStaff = (member: StaffMember) => {
    setSelectedStaffId(member._id);
    setFullName(member.fullName);
    setEmail(member.email);
    setRole(member.role);
    setJobTitle(member.jobTitle);
  };

  const clearForm = () => {
    setSelectedStaffId(null);
    setFullName('');
    setEmail('');
    setRole('staff');
    setJobTitle('Team Member');
  };

  const onSubmit = async () => {
    if (!canManage) return;
    await upsertStaffMutation.mutateAsync({ fullName, email, role, jobTitle });
    clearForm();
  };

  const onDeactivate = async (member: StaffMember) => {
    if (!canManage) return;
    await deactivateStaffMutation.mutateAsync(member._id);
    if (selectedStaffId === member._id) clearForm();
  };

  if (!canManage) {
    const isLoadError = isReady && staffQueryError;
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center' }}>
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: 8 }}>
            <Text variant="headlineSmall">Staff Management</Text>
            <Text style={{ color: colors.muted }}>
              {isLoadError
                ? 'Could not load your permissions. Check your connection and try again.'
                : 'Only admins and managers can manage staff roles and access.'}
            </Text>
          </Card.Content>
        </Card>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>
          Staff Management
        </Text>
        <Text style={{ color: colors.muted }}>
          Add staff to {venue?.name ?? 'your venue'} and assign roles.
        </Text>
        <Text style={{ color: colors.muted }}>
          Staff are scoped to this venue and can be promoted or updated without leaving the workspace.
        </Text>
      </View>

      {/* Roles / positions */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Roles & positions</Text>
          <Text style={{ color: colors.muted }}>Add the positions used at your venue (e.g. Bartender, Sommelier, Line Cook).</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {customRoles.length === 0 ? (
              <Text style={{ color: colors.muted }}>No custom roles yet.</Text>
            ) : (
              customRoles.map((r) => (
                <Chip
                  key={r._id}
                  onClose={() => venue?.id && void removeVenueRole({ venueId: venue.id, roleId: r._id as Id<'venueRoles'> })}
                >
                  {r.name}
                </Chip>
              ))
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PaperTextInput placeholder="New role name" value={newRole} onChangeText={setNewRole} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
            <Button mode="contained" buttonColor={colors.primary} onPress={() => void onAddRole()}>Add role</Button>
          </View>
        </Card.Content>
      </Card>

      {/* Invite staff via link */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Invite staff via link</Text>
          <Text style={{ color: colors.muted }}>Generate a 7-day invite link. Staff tap it, create an account or sign in, and are automatically added to {venue?.name ?? 'your venue'}.</Text>
          <Dropdown
            label="Access level"
            value={inviteLinkRole}
            options={LINK_ACCESS_LEVELS}
            onSelect={(v) => setInviteLinkRole(v as 'manager' | 'staff')}
          />
          <Dropdown
            label="Role / position"
            value={inviteLinkPosition}
            placeholder="Select a role"
            options={jobRoleOptions}
            onSelect={setInviteLinkPosition}
          />
          {inviteLinkErr ? <Text style={{ color: colors.danger }}>{inviteLinkErr}</Text> : null}
          {inviteLinkMsg ? <Text style={{ color: accents[2].fg }}>{inviteLinkMsg}</Text> : null}
          <Button mode="contained" buttonColor={colors.primary} icon="link-variant" loading={generatingLink} onPress={() => void onGenerateInviteLink()}>
            Generate & share invite link
          </Button>
        </Card.Content>
      </Card>

      {/* Add / edit staff by email */}
      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Add staff by email</Text>
          <Text style={{ color: colors.muted }}>
            Add a teammate's email to your roster and assign their role. They sign in with their own email and password — once added, they gain access to {venue?.name ?? 'your venue'}.
          </Text>
          <PaperTextInput placeholder="Full name" value={fullName} onChangeText={setFullName} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <PaperTextInput placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" mode="outlined" style={{ backgroundColor: colors.surface }} />
          <Dropdown
            label="Access level"
            value={role}
            options={ACCESS_LEVELS}
            onSelect={(v) => setRole(v as Role)}
          />
          <Dropdown
            label="Role"
            value={jobTitle}
            placeholder="Select a role"
            options={jobRoleOptions}
            onSelect={setJobTitle}
          />
          <Button mode="contained" buttonColor={colors.primary} onPress={() => void onSubmit()}>
            {selectedStaff ? 'Update staff member' : 'Add staff member'}
          </Button>
          {selectedStaff ? (
            <Button mode="text" textColor={colors.primary} onPress={clearForm}>
              Clear selection
            </Button>
          ) : null}
        </Card.Content>
      </Card>

      {selectedStaff ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium">Deactivate selected staff</Text>
            <Text style={{ color: colors.muted }}>Deactivate removes this staff member's access to the venue.</Text>
            <Text style={{ fontWeight: '700' }}>{selectedStaff.fullName}</Text>
            <Text style={{ color: colors.muted }}>{selectedStaff.email}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button mode="contained" buttonColor={colors.primary} onPress={() => void onDeactivate(selectedStaff)}>
                Deactivate
              </Button>
            </View>
          </Card.Content>
        </Card>
      ) : null}

      {/* Venue staff list */}
      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Venue staff</Text>
          {staff.length === 0 ? (
            <Text style={{ color: colors.muted }}>No staff added yet.</Text>
          ) : (
            staff.map((member) => (
              <Card key={member._id} style={{ backgroundColor: member._id === selectedStaffId ? '#F6E8E4' : colors.cream }}>
                <Card.Content style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700' }}>{member.fullName}</Text>
                      <Text style={{ color: colors.muted }}>{member.email}</Text>
                    </View>
                    <Chip compact>{member.role}</Chip>
                  </View>
                  <Text style={{ color: colors.muted }}>{member.jobTitle}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Button mode="outlined" onPress={() => fillFromStaff(member)}>Edit</Button>
                    <Button mode="outlined" onPress={() => void onDeactivate(member)}>Deactivate</Button>
                    {selectedStaffId === member._id ? (
                      <Button mode="text" textColor={colors.primary} onPress={clearForm}>Deselect</Button>
                    ) : null}
                  </View>
                </Card.Content>
              </Card>
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
