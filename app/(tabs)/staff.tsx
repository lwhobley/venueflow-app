import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import type { Role } from '../../lib/types';

type VenueRole = { _id: string; name: string };
type AccessRole = 'manager' | 'server' | 'staff';

type StaffMember = {
  _id: string;
  fullName: string;
  email: string;
  role: Exclude<Role, 'host'>;
  jobTitle: string;
  venueId: string | null;
};

type VenueOption = {
  _id: string;
  name: string;
};

const roleOptions: Exclude<Role, 'host'>[] = ['staff', 'server', 'manager', 'admin', 'owner'];

export default function StaffScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const canManage = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [jobTitle, setJobTitle] = useState('Team Member');
  const [transferVenueId, setTransferVenueId] = useState<string | null>(null);

  const staffQuery = useQuery(api.app.listVenueStaff, venue?.id && canManage ? { venueId: venue.id } : 'skip');
  const venueQuery = useQuery(api.app.listVenues, canManage ? {} : 'skip');
  const staff = useMemo(() => (staffQuery ?? []) as StaffMember[], [staffQuery]);
  const venues = useMemo(() => (venueQuery ?? []) as VenueOption[], [venueQuery]);
  const upsertStaff = useMutation(api.app.upsertVenueStaff);
  const deactivateStaff = useMutation(api.app.deactivateVenueStaff);
  const transferStaff = useMutation(api.app.transferVenueStaff);

  // Custom roles + PIN invite
  const rolesQuery = useQuery(api.staffAuth.listVenueRoles, venue?.id && canManage ? { venueId: venue.id } : 'skip');
  const customRoles = useMemo(() => (rolesQuery ?? []) as VenueRole[], [rolesQuery]);
  const ensureVenueCode = useMutation(api.staffAuth.ensureVenueCode);
  const addVenueRole = useMutation(api.staffAuth.addVenueRole);
  const removeVenueRole = useMutation(api.staffAuth.removeVenueRole);
  const inviteStaff = useMutation(api.staffAuth.inviteStaff);

  const [venueCode, setVenueCode] = useState<string | null>(null);
  const [newRole, setNewRole] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteAccess, setInviteAccess] = useState<AccessRole>('staff');
  const [invitePosition, setInvitePosition] = useState('');
  const [invitePin, setInvitePin] = useState('');
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  useEffect(() => {
    if (venue?.id && canManage) void ensureVenueCode({ venueId: venue.id }).then(setVenueCode).catch(() => {});
  }, [venue?.id, canManage, ensureVenueCode]);

  const onAddRole = async () => {
    if (!venue?.id || !newRole.trim()) return;
    try {
      await addVenueRole({ venueId: venue.id, name: newRole.trim() });
      setNewRole('');
    } catch {
      // ignore (duplicate)
    }
  };

  const onInvite = async () => {
    setInviteMsg(null);
    setInviteErr(null);
    if (!venue?.id) return;
    if (!inviteName.trim()) {
      setInviteErr('Enter a name.');
      return;
    }
    if (!/^\d{4}$/.test(invitePin)) {
      setInviteErr('PIN must be exactly 4 digits.');
      return;
    }
    try {
      await inviteStaff({
        venueId: venue.id,
        fullName: inviteName.trim(),
        accessRole: inviteAccess,
        jobTitle: invitePosition.trim() || 'Team Member',
        pin: invitePin,
      });
      setInviteMsg(`${inviteName.trim()} invited. They sign in with code ${venueCode ?? ''} + PIN ${invitePin}.`);
      setInviteName('');
      setInvitePin('');
      setInvitePosition('');
    } catch (e) {
      setInviteErr(e instanceof Error ? e.message : 'Could not invite.');
    }
  };

  const selectedStaff = staff.find((member: StaffMember) => member._id === selectedStaffId) ?? null;
  const selectedVenue = venues.find((item: VenueOption) => item._id === transferVenueId) ?? null;

  const fillFromStaff = (member: StaffMember) => {
    setSelectedStaffId(member._id);
    setFullName(member.fullName);
    setEmail(member.email);
    setRole(member.role);
    setJobTitle(member.jobTitle);
    setTransferVenueId(member.venueId ?? venue?.id ?? null);
  };

  const clearForm = () => {
    setSelectedStaffId(null);
    setFullName('');
    setEmail('');
    setRole('staff');
    setJobTitle('Team Member');
    setTransferVenueId(null);
  };

  const onSubmit = async () => {
    if (!venue?.id || !canManage) return;
    await upsertStaff({
      venueId: venue.id,
      fullName,
      email,
      role,
      jobTitle,
    });
    clearForm();
  };

  const onDeactivate = async (member: StaffMember) => {
    if (!canManage) return;
    await deactivateStaff({ staffId: member._id as Id<'profiles'> });
    if (selectedStaffId === member._id) clearForm();
  };

  const onTransfer = async (member: StaffMember) => {
    if (!canManage || !transferVenueId) return;
    await transferStaff({ staffId: member._id as Id<'profiles'>, targetVenueId: transferVenueId });
    if (selectedStaffId === member._id) clearForm();
  };

  if (!canManage) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center' }}>
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: 8 }}>
            <Text variant="headlineSmall">Staff Management</Text>
            <Text style={{ color: colors.muted }}>Only admins and managers can manage staff roles and venue assignments.</Text>
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

      {/* Venue join code */}
      <Card style={{ backgroundColor: accents[0].bg, borderRadius: 16 }}>
        <Card.Content style={{ gap: 4 }}>
          <Text style={{ color: colors.muted }}>Venue code for staff PIN login</Text>
          <Text style={{ color: accents[0].fg, fontSize: 30, fontWeight: '800', letterSpacing: 3 }}>{venueCode ?? '— — — —'}</Text>
          <Text style={{ color: colors.muted }}>Share this code with staff. They pick their name and enter their PIN to sign in.</Text>
        </Card.Content>
      </Card>

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
                <Chip key={r._id} onClose={() => venue?.id && void removeVenueRole({ venueId: venue.id, roleId: r._id as Id<'venueRoles'> })}>
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

      {/* Invite staff with PIN */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Invite staff (PIN login)</Text>
          <PaperTextInput placeholder="Full name" value={inviteName} onChangeText={setInviteName} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <Text style={{ color: colors.muted }}>Access level</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['staff', 'server', 'manager'] as AccessRole[]).map((r) => (
              <Chip key={r} selected={inviteAccess === r} onPress={() => setInviteAccess(r)}>{r}</Chip>
            ))}
          </View>
          <Text style={{ color: colors.muted }}>Position</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {customRoles.map((r) => (
              <Chip key={r._id} selected={invitePosition === r.name} onPress={() => setInvitePosition(r.name)}>{r.name}</Chip>
            ))}
          </View>
          <PaperTextInput placeholder="Position (or pick above)" value={invitePosition} onChangeText={setInvitePosition} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <PaperTextInput placeholder="4-digit PIN" value={invitePin} onChangeText={(t) => setInvitePin(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} mode="outlined" style={{ backgroundColor: colors.surface }} />
          {inviteErr ? <Text style={{ color: colors.danger }}>{inviteErr}</Text> : null}
          {inviteMsg ? <Text style={{ color: accents[2].fg }}>{inviteMsg}</Text> : null}
          <Button mode="contained" buttonColor={colors.primary} icon="account-plus" onPress={() => void onInvite()}>Invite staff</Button>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Add or update staff (email)</Text>
          <Text style={{ color: colors.muted }}>
            Staff members are scoped to this venue and can be assigned admin, owner, manager, server, or staff roles.
          </Text>
          <PaperTextInput placeholder="Full name" value={fullName} onChangeText={setFullName} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <PaperTextInput placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" mode="outlined" style={{ backgroundColor: colors.surface }} />
          <PaperTextInput placeholder="Job title" value={jobTitle} onChangeText={setJobTitle} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {roleOptions.map((item) => (
              <Chip key={item} selected={role === item} onPress={() => setRole(item)}>
                {item}
              </Chip>
            ))}
          </View>
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
            <Text variant="titleMedium">Deactivate or transfer selected staff</Text>
            <Text style={{ color: colors.muted }}>
              Deactivate removes venue access. Transfer moves the staff member to another venue.
            </Text>
            <Text style={{ fontWeight: '700' }}>{selectedStaff.fullName}</Text>
            <Text style={{ color: colors.muted }}>{selectedStaff.email}</Text>
            <PaperTextInput
              placeholder="Target venue"
              value={selectedVenue?.name ?? ''}
              editable={false}
              mode="outlined"
              style={{ backgroundColor: colors.surface }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {venues.map((item: VenueOption) => (
                <Chip key={item._id} selected={transferVenueId === item._id} onPress={() => setTransferVenueId(item._id)}>
                  {item.name}
                </Chip>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button mode="contained" buttonColor={colors.primary} onPress={() => void onDeactivate(selectedStaff)}>
                Deactivate
              </Button>
              <Button mode="outlined" onPress={() => void onTransfer(selectedStaff)} disabled={!transferVenueId || transferVenueId === selectedStaff.venueId}>
                Transfer
              </Button>
            </View>
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Venue staff</Text>
          {staff.length === 0 ? (
            <Text style={{ color: colors.muted }}>No staff added yet.</Text>
          ) : (
            staff.map((member: StaffMember) => (
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
                    <Button mode="outlined" onPress={() => fillFromStaff(member)}>
                      Edit
                    </Button>
                    <Button mode="outlined" onPress={() => void onDeactivate(member)}>
                      Deactivate
                    </Button>
                    <Button mode="outlined" onPress={() => { setSelectedStaffId(member._id); setTransferVenueId(venue?.id ?? null); }}>
                      Transfer
                    </Button>
                    {selectedStaffId === member._id ? (
                      <Button mode="text" textColor={colors.primary} onPress={clearForm}>
                        Deselect
                      </Button>
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