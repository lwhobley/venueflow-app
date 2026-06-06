import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Divider, IconButton, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import type { Id } from '../lib/ids';
import { accents, colors, spacing } from '../lib/theme';
import { useIsDesktop } from '../lib/responsive';

type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'negotiating' | 'won' | 'lost' | 'unqualified' | 'on_hold';
type WorkspaceView = 'dashboard' | 'pipeline' | 'contacts' | 'events' | 'contracts';

type LeadRow = {
  _id: Id<'crmLeads'>;
  fullName: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  status: LeadStatus;
  tags: string[];
  assignedToName?: string | null;
  estimatedValueCents?: number;
  lastActivityAt?: number;
  createdAt: number;
  updatedAt: number;
};

type BeoRow = {
  _id: Id<'crmBeos'>;
  leadId?: Id<'crmLeads'>;
  leadName?: string | null;
  eventName: string;
  eventDate?: number;
  eventType?: string;
  guestCount?: number;
  venueSpace?: string;
  fbMinimumCents?: number;
  depositCents?: number;
  status: string;
  updatedAt: number;
};

type ContractRow = {
  _id: Id<'crmContracts'>;
  leadId?: Id<'crmLeads'>;
  leadName?: string | null;
  contractNumber: string;
  eventName?: string;
  eventDate?: number;
  guestCount?: number;
  venueSpace?: string;
  fbMinimumCents?: number;
  status: string;
  updatedAt: number;
};

type LeadDetail = {
  lead: LeadRow;
  notes: Array<{ _id: Id<'crmNotes'>; text: string; authorName: string; createdAt: number }>;
  beos: BeoRow[];
  contracts: ContractRow[];
  activityLog: Array<{ _id: Id<'crmActivityLog'>; kind: string; detail?: string; createdAt: number }>;
};

const statusColumns: Array<{ status: LeadStatus; label: string; accent: (typeof accents)[number] }> = [
  { status: 'new', label: 'New', accent: accents[2] },
  { status: 'contacted', label: 'Contacted', accent: accents[4] },
  { status: 'qualified', label: 'Qualified', accent: accents[0] },
  { status: 'proposal_sent', label: 'Proposal', accent: accents[1] },
  { status: 'negotiating', label: 'Negotiating', accent: accents[3] },
  { status: 'won', label: 'Won', accent: accents[0] },
];

const lostStatuses: LeadStatus[] = ['lost', 'unqualified', 'on_hold'];

function money(cents?: number) {
  return `$${((cents ?? 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function dateText(value?: number) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'TBD';
}

function dateInputValue(value: string) {
  const time = Date.parse(`${value}T12:00:00`);
  return Number.isFinite(time) ? time : undefined;
}

function splitTags(value: string) {
  return Array.from(new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
}

function parseDollars(value: string) {
  const amount = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : undefined;
}

function errMsg(err: unknown) {
  return err instanceof Error ? err.message : 'Unknown error';
}

export function CrmSalesWorkspace({ venueId, enabled }: { venueId: Id<'venues'> | undefined; enabled: boolean }) {
  const isDesktop = useIsDesktop();
  const [view, setView] = useState<WorkspaceView>('dashboard');
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<Id<'crmLeads'> | null>(null);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [leadName, setLeadName] = useState('');
  const [leadCompany, setLeadCompany] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadSource, setLeadSource] = useState('Website');
  const [leadValue, setLeadValue] = useState('');
  const [leadTags, setLeadTags] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventType, setEventType] = useState('Private dining');
  const [eventGuests, setEventGuests] = useState('');
  const [eventSpace, setEventSpace] = useState('');
  const [eventMinimum, setEventMinimum] = useState('');
  const [eventDeposit, setEventDeposit] = useState('');
  const [noteText, setNoteText] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const leads = useQuery(api.crm.listLeads, enabled && venueId ? { venueId, search: leadSearch || undefined } : 'skip') as LeadRow[] | undefined;
  const beos = useQuery(api.crm.listBeos, enabled && venueId ? { venueId } : 'skip') as BeoRow[] | undefined;
  const contracts = useQuery(api.crm.listContracts, enabled && venueId ? { venueId } : 'skip') as ContractRow[] | undefined;
  const detail = useQuery(api.crm.getLead, enabled && venueId && selectedLeadId ? { venueId, leadId: selectedLeadId } : 'skip') as LeadDetail | null | undefined;
  const saveLead = useMutation(api.crm.saveLead);
  const saveBeo = useMutation(api.crm.saveBeo);
  const saveContract = useMutation(api.crm.saveContract);
  const convertBeoToContract = useMutation(api.crm.convertBeoToContract);
  const addNote = useMutation(api.crm.addNote);

  const selectedLead = detail?.lead ?? leads?.find((lead) => lead._id === selectedLeadId) ?? null;
  const openLeads = useMemo(() => (leads ?? []).filter((lead) => !lostStatuses.includes(lead.status) && lead.status !== 'won'), [leads]);
  const stats = useMemo(() => {
    const rows = leads ?? [];
    const events = beos ?? [];
    const docs = contracts ?? [];
    return {
      pipelineCents: openLeads.reduce((sum, lead) => sum + (lead.estimatedValueCents ?? 0), 0),
      wonCents: rows.filter((lead) => lead.status === 'won').reduce((sum, lead) => sum + (lead.estimatedValueCents ?? 0), 0),
      openCount: openLeads.length,
      proposalCount: rows.filter((lead) => lead.status === 'proposal_sent' || lead.status === 'negotiating').length,
      eventCount: events.length,
      contractCount: docs.length,
    };
  }, [beos, contracts, leads, openLeads]);

  const saveNewLead = async () => {
    if (!venueId || !leadName.trim()) {
      setMessage('Lead name is required.');
      return;
    }
    try {
      const leadId = await saveLead({
        venueId,
        fullName: leadName.trim(),
        company: leadCompany.trim() || undefined,
        email: leadEmail.trim() || undefined,
        phone: leadPhone.trim() || undefined,
        source: leadSource.trim() || undefined,
        status: 'new',
        tags: splitTags(leadTags),
        estimatedValueCents: parseDollars(leadValue),
        marketingOptIn: true,
      });
      setSelectedLeadId(leadId);
      setShowLeadForm(false);
      setLeadName('');
      setLeadCompany('');
      setLeadEmail('');
      setLeadPhone('');
      setLeadValue('');
      setLeadTags('');
      setMessage('Lead created.');
    } catch (err) {
      setMessage(`Failed to create lead: ${errMsg(err)}`);
    }
  };

  const updateLeadStatus = async (leadId: Id<'crmLeads'>, status: LeadStatus) => {
    if (!venueId) return;
    const target = leads?.find((l) => l._id === leadId) ?? (detail?.lead?._id === leadId ? detail.lead : null);
    if (!target) return;
    try {
      await saveLead({ venueId, leadId, fullName: target.fullName, status });
      setMessage(`Moved to ${status.replace('_', ' ')}.`);
    } catch (err) {
      setMessage(`Failed to update lead: ${errMsg(err)}`);
    }
  };

  const createEventDoc = async () => {
    if (!venueId || !eventName.trim()) {
      setMessage('Event name is required.');
      return;
    }
    try {
      const beoId = await saveBeo({
        venueId,
        leadId: selectedLead?._id,
        eventName: eventName.trim(),
        eventDate: dateInputValue(eventDate),
        eventType: eventType.trim() || undefined,
        guestCount: Number(eventGuests) || undefined,
        venueSpace: eventSpace.trim() || undefined,
        fbMinimumCents: parseDollars(eventMinimum),
        depositCents: parseDollars(eventDeposit),
        status: 'draft',
      });
      setShowEventForm(false);
      setEventName('');
      setEventDate('');
      setEventGuests('');
      setEventSpace('');
      setEventMinimum('');
      setEventDeposit('');
      setMessage('BEO draft created.');
      return beoId;
    } catch (err) {
      setMessage(`Failed to create BEO: ${errMsg(err)}`);
    }
  };

  const createContractFromLead = async () => {
    if (!venueId || !selectedLead) return;
    const depositCents = parseDollars(eventDeposit);
    try {
      await saveContract({
        venueId,
        leadId: selectedLead._id,
        eventName: eventName.trim() || `${selectedLead.company ?? selectedLead.fullName} event`,
        eventDate: dateInputValue(eventDate),
        guestCount: Number(eventGuests) || undefined,
        venueSpace: eventSpace.trim() || undefined,
        fbMinimumCents: parseDollars(eventMinimum) ?? selectedLead.estimatedValueCents,
        paymentSchedule: depositCents ? [{ amountCents: depositCents, dueDate: Date.now(), type: 'deposit' as const }] : undefined,
        cancellationPolicy: 'Deposit is non-refundable after the booking deadline. Final balance is due before event start.',
        forceMajeure: true,
        liabilityWaiver: true,
        status: 'draft',
      });
      setEventName('');
      setEventDate('');
      setEventGuests('');
      setEventSpace('');
      setEventMinimum('');
      setEventDeposit('');
      setMessage('Contract draft created.');
    } catch (err) {
      setMessage(`Failed to create contract: ${errMsg(err)}`);
    }
  };

  const saveNote = async () => {
    if (!venueId || !selectedLead || !noteText.trim()) return;
    try {
      await addNote({ venueId, leadId: selectedLead._id, text: noteText.trim() });
      setNoteText('');
      setMessage('Note added.');
    } catch (err) {
      setMessage(`Failed to save note: ${errMsg(err)}`);
    }
  };

  if (!enabled || !venueId) return null;

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 8 }}>
      <Card.Content style={{ gap: spacing.md }}>
        <View style={{ flexDirection: isDesktop ? 'row' : 'column', justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text variant="headlineSmall" style={{ color: colors.primary, fontWeight: '800' }}>CRM workspace</Text>
            <Text style={{ color: colors.muted }}>Pipeline, contacts, event documents, contracts, and follow-up activity in one place.</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Button compact mode="outlined" icon="calendar-plus" textColor={colors.primary} onPress={() => setShowEventForm((value) => !value)}>
              BEO
            </Button>
            <Button compact mode="contained" icon="account-plus" buttonColor={colors.primary} onPress={() => setShowLeadForm((value) => !value)}>
              Lead
            </Button>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SegmentedButtons
            value={view}
            onValueChange={(value) => setView(value as WorkspaceView)}
            buttons={[
              { value: 'dashboard', label: 'Dashboard' },
              { value: 'pipeline', label: 'Pipeline' },
              { value: 'contacts', label: 'Contacts' },
              { value: 'events', label: 'Events' },
              { value: 'contracts', label: 'Contracts' },
            ]}
            style={{ minWidth: 680 }}
          />
        </ScrollView>

        {message ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: 8, backgroundColor: accents[2].bg }}>
            <Text style={{ color: accents[2].fg, flex: 1, fontWeight: '700' }}>{message}</Text>
            <IconButton icon="close" size={16} onPress={() => setMessage(null)} style={{ margin: 0 }} />
          </View>
        ) : null}

        {showLeadForm ? (
          <View style={{ gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
            <Text variant="titleSmall" style={{ fontWeight: '800' }}>Create lead</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Name" value={leadName} onChangeText={setLeadName} mode="outlined" style={{ flex: 1, minWidth: 170, backgroundColor: colors.surface }} />
              <TextInput label="Company" value={leadCompany} onChangeText={setLeadCompany} mode="outlined" style={{ flex: 1, minWidth: 170, backgroundColor: colors.surface }} />
              <TextInput label="Deal value" value={leadValue} onChangeText={setLeadValue} mode="outlined" keyboardType="numeric" style={{ width: 140, backgroundColor: colors.surface }} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Email" value={leadEmail} onChangeText={setLeadEmail} mode="outlined" autoCapitalize="none" style={{ flex: 1, minWidth: 170, backgroundColor: colors.surface }} />
              <TextInput label="Phone" value={leadPhone} onChangeText={setLeadPhone} mode="outlined" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
              <TextInput label="Source" value={leadSource} onChangeText={setLeadSource} mode="outlined" style={{ flex: 1, minWidth: 130, backgroundColor: colors.surface }} />
            </View>
            <TextInput label="Tags" value={leadTags} onChangeText={setLeadTags} mode="outlined" style={{ backgroundColor: colors.surface }} />
            <Button mode="contained" buttonColor={colors.primary} onPress={() => void saveNewLead()}>Save lead</Button>
          </View>
        ) : null}

        {showEventForm ? (
          <View style={{ gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
            <Text variant="titleSmall" style={{ fontWeight: '800' }}>Create event document</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Event name" value={eventName} onChangeText={setEventName} mode="outlined" style={{ flex: 1, minWidth: 190, backgroundColor: colors.surface }} />
              <TextInput label="Date (YYYY-MM-DD)" value={eventDate} onChangeText={setEventDate} mode="outlined" style={{ width: 165, backgroundColor: colors.surface }} />
              <TextInput label="Guest count" value={eventGuests} onChangeText={setEventGuests} mode="outlined" keyboardType="numeric" style={{ width: 130, backgroundColor: colors.surface }} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <TextInput label="Type" value={eventType} onChangeText={setEventType} mode="outlined" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
              <TextInput label="Space" value={eventSpace} onChangeText={setEventSpace} mode="outlined" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
              <TextInput label="F&B minimum" value={eventMinimum} onChangeText={setEventMinimum} mode="outlined" keyboardType="numeric" style={{ width: 150, backgroundColor: colors.surface }} />
              <TextInput label="Deposit" value={eventDeposit} onChangeText={setEventDeposit} mode="outlined" keyboardType="numeric" style={{ width: 130, backgroundColor: colors.surface }} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' }}>
              <Button mode="outlined" textColor={colors.primary} onPress={() => void createEventDoc()}>Save BEO</Button>
              <Button mode="contained" buttonColor={colors.primary} disabled={!selectedLead} onPress={() => void createContractFromLead()}>Contract</Button>
            </View>
          </View>
        ) : null}

        {view === 'dashboard' ? (
          <DashboardView stats={stats} leads={leads} beos={beos} contracts={contracts} onSelectLead={setSelectedLeadId} onView={setView} />
        ) : null}

        {view === 'pipeline' ? (
          <PipelineView leads={leads} selectedLeadId={selectedLead?._id ?? null} onSelectLead={setSelectedLeadId} onMove={(leadId, status) => void updateLeadStatus(leadId, status)} />
        ) : null}

        {view === 'contacts' ? (
          <ContactsView leads={leads} search={leadSearch} onSearch={setLeadSearch} onSelectLead={setSelectedLeadId} />
        ) : null}

        {view === 'events' ? (
          <EventsView beos={beos} onConvert={async (beoId) => {
            if (!venueId) return;
            try {
              await convertBeoToContract({ venueId, beoId });
              setMessage('Converted BEO to contract.');
            } catch (err) {
              setMessage(`Failed to convert: ${errMsg(err)}`);
            }
          }} />
        ) : null}

        {view === 'contracts' ? (
          <ContractsView contracts={contracts} />
        ) : null}

        <Divider />

        <LeadDetailPanel
          lead={selectedLead}
          detail={detail}
          noteText={noteText}
          onNoteText={setNoteText}
          onSaveNote={() => void saveNote()}
          onMove={(status) => { if (selectedLead) void updateLeadStatus(selectedLead._id, status); }}
        />
      </Card.Content>
    </Card>
  );
}

function DashboardView({
  stats,
  leads,
  beos,
  contracts,
  onSelectLead,
  onView,
}: {
  stats: { pipelineCents: number; wonCents: number; openCount: number; proposalCount: number; eventCount: number; contractCount: number };
  leads: LeadRow[] | undefined;
  beos: BeoRow[] | undefined;
  contracts: ContractRow[] | undefined;
  onSelectLead: (id: Id<'crmLeads'>) => void;
  onView: (view: WorkspaceView) => void;
}) {
  const hotLeads = [...(leads ?? [])].sort((a, b) => (b.estimatedValueCents ?? 0) - (a.estimatedValueCents ?? 0)).slice(0, 5);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <StatTile label="Pipeline" value={money(stats.pipelineCents)} accent={accents[0]} />
        <StatTile label="Open deals" value={String(stats.openCount)} accent={accents[2]} />
        <StatTile label="Proposals" value={String(stats.proposalCount)} accent={accents[1]} />
        <StatTile label="Won revenue" value={money(stats.wonCents)} accent={accents[4]} />
        <StatTile label="BEOs" value={String(stats.eventCount)} accent={accents[3]} />
        <StatTile label="Contracts" value={String(stats.contractCount)} accent={accents[5]} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        <View style={{ flexGrow: 1, flexBasis: 320, gap: spacing.sm }}>
          <SectionHeader title="Priority deals" action="Pipeline" onPress={() => onView('pipeline')} />
          {hotLeads.length === 0 ? <EmptyLine text="No lead pipeline yet." /> : hotLeads.map((lead) => <LeadListRow key={lead._id} lead={lead} onPress={() => onSelectLead(lead._id)} />)}
        </View>
        <View style={{ flexGrow: 1, flexBasis: 320, gap: spacing.sm }}>
          <SectionHeader title="Recent documents" action="Docs" onPress={() => onView('events')} />
          {(beos ?? []).slice(0, 3).map((beo) => <DocRow key={beo._id} title={beo.eventName} subtitle={`${beo.leadName ?? 'Unlinked'} - ${dateText(beo.eventDate)}`} status={beo.status} />)}
          {(contracts ?? []).slice(0, 3).map((contract) => <DocRow key={contract._id} title={contract.eventName ?? contract.contractNumber} subtitle={`${contract.leadName ?? 'Unlinked'} - ${contract.contractNumber}`} status={contract.status} />)}
          {!(beos?.length || contracts?.length) ? <EmptyLine text="No BEOs or contracts yet." /> : null}
        </View>
      </View>
    </View>
  );
}

function PipelineView({
  leads,
  selectedLeadId,
  onSelectLead,
  onMove,
}: {
  leads: LeadRow[] | undefined;
  selectedLeadId: Id<'crmLeads'> | null;
  onSelectLead: (id: Id<'crmLeads'>) => void;
  onMove: (leadId: Id<'crmLeads'>, status: LeadStatus) => void;
}) {
  const selectedLead = (leads ?? []).find((lead) => lead._id === selectedLeadId) ?? null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.xs }}>
        {statusColumns.map((column) => {
          const rows = (leads ?? []).filter((lead) => lead.status === column.status);
          const total = rows.reduce((sum, lead) => sum + (lead.estimatedValueCents ?? 0), 0);
          const canMoveSelectedHere = selectedLead != null && selectedLead.status !== column.status;
          return (
            <View key={column.status} style={{ width: 245, gap: spacing.sm, padding: spacing.sm, borderRadius: 8, backgroundColor: column.accent.bg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: column.accent.fg, fontWeight: '800' }}>{column.label}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{rows.length} deals - {money(total)}</Text>
                </View>
                {canMoveSelectedHere ? (
                  <Button compact mode="text" textColor={colors.primary} onPress={() => onMove(selectedLead._id, column.status)}>Move here</Button>
                ) : null}
              </View>
              {rows.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>No deals in this stage.</Text> : rows.map((lead) => (
                <View key={lead._id} style={{ padding: spacing.sm, borderRadius: 8, backgroundColor: colors.surface, borderWidth: selectedLeadId === lead._id ? 1 : 0, borderColor: column.accent.fg }}>
                  <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{lead.fullName}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{lead.company ?? lead.source ?? 'No company'} - {money(lead.estimatedValueCents)}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', marginTop: spacing.xs }}>
                    <Button compact mode="text" textColor={colors.primary} onPress={() => onSelectLead(lead._id)}>{selectedLeadId === lead._id ? 'Selected' : 'Select'}</Button>
                  </View>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ContactsView({ leads, search, onSearch, onSelectLead }: { leads: LeadRow[] | undefined; search: string; onSearch: (value: string) => void; onSelectLead: (id: Id<'crmLeads'>) => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <TextInput label="Search contacts and deals" value={search} onChangeText={onSearch} mode="outlined" style={{ backgroundColor: colors.surface }} />
      {(leads ?? []).length === 0 ? <EmptyLine text="No matching CRM contacts." /> : (leads ?? []).map((lead) => (
        <LeadListRow key={lead._id} lead={lead} onPress={() => onSelectLead(lead._id)} />
      ))}
    </View>
  );
}

function EventsView({ beos, onConvert }: { beos: BeoRow[] | undefined; onConvert: (beoId: Id<'crmBeos'>) => Promise<void> }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {(beos ?? []).length === 0 ? <EmptyLine text="No BEO drafts yet." /> : (beos ?? []).map((beo) => (
        <View key={beo._id} style={{ padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8, gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colors.charcoal }}>{beo.eventName}</Text>
              <Text style={{ color: colors.muted }}>{beo.leadName ?? 'Unlinked'} - {dateText(beo.eventDate)} - {beo.guestCount ?? 'TBD'} guests</Text>
            </View>
            <Chip compact>{beo.status}</Chip>
          </View>
          <Text style={{ color: colors.muted }}>Space {beo.venueSpace ?? 'TBD'} - Minimum {money(beo.fbMinimumCents)} - Deposit {money(beo.depositCents)}</Text>
          <Button compact mode="outlined" icon="file-sign" textColor={colors.primary} onPress={() => void onConvert(beo._id)}>Convert to contract</Button>
        </View>
      ))}
    </View>
  );
}

function ContractsView({ contracts }: { contracts: ContractRow[] | undefined }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {(contracts ?? []).length === 0 ? <EmptyLine text="No contracts yet." /> : (contracts ?? []).map((contract) => (
        <DocRow
          key={contract._id}
          title={contract.eventName ?? contract.contractNumber}
          subtitle={`${contract.leadName ?? 'Unlinked'} - ${dateText(contract.eventDate)} - ${contract.guestCount ?? 'TBD'} guests - ${money(contract.fbMinimumCents)}`}
          status={contract.status}
        />
      ))}
    </View>
  );
}

function LeadDetailPanel({
  lead,
  detail,
  noteText,
  onNoteText,
  onSaveNote,
  onMove,
}: {
  lead: LeadRow | null;
  detail: LeadDetail | null | undefined;
  noteText: string;
  onNoteText: (value: string) => void;
  onSaveNote: () => void;
  onMove: (status: LeadStatus) => void;
}) {
  if (!lead) return <EmptyLine text="Select a deal to open the CRM record." />;
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text variant="titleLarge" style={{ color: colors.primary, fontWeight: '800' }}>{lead.fullName}</Text>
          <Text style={{ color: colors.muted }}>{lead.company ?? 'No company'} - {lead.email ?? lead.phone ?? 'No contact'} - {money(lead.estimatedValueCents)}</Text>
        </View>
        <Chip>{lead.status.replace('_', ' ').toUpperCase()}</Chip>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {statusColumns.map((column) => (
            <Button key={column.status} compact mode={lead.status === column.status ? 'contained' : 'outlined'} buttonColor={lead.status === column.status ? colors.primary : undefined} textColor={lead.status === column.status ? colors.surface : colors.primary} onPress={() => onMove(column.status)}>
              {column.label}
            </Button>
          ))}
          <Button compact mode="outlined" textColor={colors.danger} onPress={() => onMove('lost')}>Lost</Button>
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        <View style={{ flexGrow: 1, flexBasis: 300, gap: spacing.sm }}>
          <Text variant="titleSmall" style={{ fontWeight: '800' }}>Activity</Text>
          <TextInput label="Log note or next step" value={noteText} onChangeText={onNoteText} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
          <Button mode="contained" buttonColor={colors.primary} disabled={!noteText.trim()} onPress={onSaveNote}>Add note</Button>
          {detail === undefined ? <Text style={{ color: colors.muted }}>Loading activity...</Text> : null}
          {(detail?.notes ?? []).slice(0, 4).map((note) => (
            <View key={note._id} style={{ padding: spacing.sm, borderRadius: 8, backgroundColor: colors.background }}>
              <Text style={{ color: colors.charcoal }}>{note.text}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{note.authorName} - {dateText(note.createdAt)}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexGrow: 1, flexBasis: 300, gap: spacing.sm }}>
          <Text variant="titleSmall" style={{ fontWeight: '800' }}>Timeline</Text>
          {(detail?.activityLog ?? []).slice(0, 6).map((item) => (
            <View key={item._id} style={{ paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontWeight: '700', color: colors.charcoal }}>{item.kind.replaceAll('_', ' ')}</Text>
              <Text style={{ color: colors.muted }}>{dateText(item.createdAt)} - {item.detail ?? 'No detail'}</Text>
            </View>
          ))}
          {(detail?.beos?.length || detail?.contracts?.length) ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={{ fontWeight: '800' }}>Documents</Text>
              {(detail?.beos ?? []).slice(0, 3).map((beo) => <Text key={beo._id} style={{ color: colors.muted }}>BEO - {beo.eventName} - {beo.status}</Text>)}
              {(detail?.contracts ?? []).slice(0, 3).map((contract) => <Text key={contract._id} style={{ color: colors.muted }}>Contract - {contract.contractNumber} - {contract.status}</Text>)}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent: (typeof accents)[number] }) {
  return (
    <View style={{ minWidth: 145, flexGrow: 1, padding: spacing.md, borderRadius: 8, backgroundColor: accent.bg }}>
      <Text style={{ color: accent.fg, fontWeight: '800', fontSize: 22 }}>{value}</Text>
      <Text style={{ color: colors.muted }}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title, action, onPress }: { title: string; action: string; onPress: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text variant="titleSmall" style={{ fontWeight: '800' }}>{title}</Text>
      <Button compact mode="text" textColor={colors.primary} onPress={onPress}>{action}</Button>
    </View>
  );
}

function LeadListRow({ lead, onPress }: { lead: LeadRow; onPress: () => void }) {
  return (
    <View style={{ padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8, gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{lead.fullName}</Text>
          <Text style={{ color: colors.muted }}>{lead.company ?? lead.source ?? 'No company'} - {lead.email ?? lead.phone ?? 'No contact'}</Text>
        </View>
        <Text style={{ color: colors.primary, fontWeight: '800' }}>{money(lead.estimatedValueCents)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 }}>
          <Chip compact>{lead.status.replace('_', ' ')}</Chip>
          {lead.tags.slice(0, 3).map((tag) => <Chip compact key={tag}>{tag}</Chip>)}
        </View>
        <Button compact mode="text" textColor={colors.primary} onPress={onPress}>Open</Button>
      </View>
    </View>
  );
}

function DocRow({ title, subtitle, status }: { title: string; subtitle: string; status: string }) {
  return (
    <View style={{ padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8, gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: colors.muted }}>{subtitle}</Text>
        </View>
        <Chip compact>{status}</Chip>
      </View>
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <View style={{ padding: spacing.md, borderRadius: 8, backgroundColor: colors.background }}>
      <Text style={{ color: colors.muted }}>{text}</Text>
    </View>
  );
}
