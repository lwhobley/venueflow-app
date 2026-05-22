import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import type { Role } from '../../lib/types';

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

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Add or update staff</Text>
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