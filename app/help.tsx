import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Card, IconButton, Text, TextInput } from 'react-native-paper';
import { colors, spacing } from '../lib/theme';

type GuideSection = {
  key: string;
  tab: string;
  title: string;
  summary: string;
  steps: string[];
};

// Grounded in the actual screens under app/(tabs) — keep this in sync when a
// feature's flow changes so the in-app guide never drifts from the product.
const SECTIONS: GuideSection[] = [
  {
    key: 'home',
    tab: 'Home',
    title: 'Daily brief & dashboard',
    summary: 'Your service snapshot for the day: covers, staff, alerts, and what needs attention first.',
    steps: [
      'Open the Home tab to see the manager daily brief — covers, staff on shift, prep, sales, and urgent alerts for the selected date.',
      'Use the date controls at the top to look at a different day.',
      'Tap an alert (open shifts, low stock, pending requests) to jump straight to the screen that needs action.',
      'Use the search bar to find a reservation, guest, or staff member from anywhere in the app.',
      'Add personal goals in the manager center to track shift-level targets.',
    ],
  },
  {
    key: 'clock',
    tab: 'Clock',
    title: 'Time clock',
    summary: 'Clock in and out with geofenced location checks, track breaks, and review who is on shift.',
    steps: [
      'Tap Clock In at the start of your shift — your location is checked against the venue geofence set in Venue settings, and clock-ins outside that radius or from a mocked location are rejected.',
      'Use the break buttons to start and end paid or unpaid breaks during a shift.',
      'Tap Clock Out to end your shift; your punches for the pay period appear under Daily punches and Period totals.',
      'If a punch looks wrong, use Request Time Correction to send a fix to your manager instead of editing it yourself.',
      'Managers see Who\'s clocked in and Manager alerts for missed clock-outs or late arrivals across the whole team.',
    ],
  },
  {
    key: 'schedule',
    tab: 'Schedule',
    title: 'Scheduling',
    summary: 'Build the week, publish shifts, and handle swap requests.',
    steps: [
      'Open the Schedule tab and build shifts for the week — copy a previous day or apply a template to speed this up.',
      'On the Forecast tab, tap Generate AI draft to have shifts proposed automatically from demand (covers, private events) and staff availability — review each proposed shift, remove any you don\'t want, then create the rest in one batch.',
      'The Forecast tab also flags predictive compliance risks before you publish: staff approaching or over 40h, long shifts (6h+) that need a break, and "clopening" pairs — closing one day and opening the next with too little rest.',
      'Publish the schedule when it is ready so staff can see their shifts and get notified.',
      'Open Shift swaps to review swap requests staff have submitted between each other.',
      'Use the Request review queue to approve or deny availability changes and other schedule requests before they take effect.',
    ],
  },
  {
    key: 'availability',
    tab: 'Availability',
    title: 'Availability & pay periods',
    summary: 'Staff submit when they can work; managers control the pay-period window.',
    steps: [
      'Staff: set your weekly availability here ahead of the schedule being built.',
      'Managers: define the pay-period length and start date once, in the availability settings.',
      'Availability is locked by default during an active pay period — managers unlock it only when a specific edit is needed, so the schedule stays stable.',
    ],
  },
  {
    key: 'floor',
    tab: 'Floor',
    title: 'Live floor plan',
    summary: 'See sections, tables, and occupancy, and seat parties in real time.',
    steps: [
      'Open the Floor tab to see the active floor plan for the venue, broken into sections and tables.',
      'Tap a table to seat a party, see its status, or merge it with another table for a larger group.',
      'Check Needs assignment for reservations or walk-ins that haven\'t been seated yet.',
      'If no floor plan exists yet, use the floor editor to lay out sections and tables first.',
    ],
  },
  {
    key: 'reservations',
    tab: 'Reservations',
    title: 'Reservations & waitlist',
    summary: 'Bookings, walk-ins, and private events in one list, feeding straight into the floor plan.',
    steps: [
      'Open Reservations to see upcoming bookings, add a new reservation, or add a walk-in to the waitlist.',
      'Reservations connected through Integrations sync in automatically — see the Integrations tab to connect a provider.',
      'Seat a reservation directly from this list; it moves onto the Floor tab as an assigned table.',
      'Private events and larger parties can be tracked here alongside standard bookings.',
    ],
  },
  {
    key: 'guests',
    tab: 'Guests',
    title: 'CRM & guest profiles',
    summary: 'Guest notes, preferences, and history — so the team recognizes regulars and VIPs.',
    steps: [
      'Open the Guests tab for the full guest directory; search by name to find a specific guest.',
      'Tap a guest to open their CRM profile: preferences, visit timeline, and guest intelligence (spend, frequency, notes).',
      'Add notes or preferences during or after a visit so the next shift has context.',
      'Use Generated document to produce paperwork like a BEO for a private event tied to a guest.',
    ],
  },
  {
    key: 'integrations',
    tab: 'Integrations',
    title: 'POS, reservations & CRM connections',
    summary: 'Connect your POS and reservation provider so sales and bookings sync automatically.',
    steps: [
      'Open Integrations and choose POS sync to connect a supported POS (Toast, Square, Clover, Shopify POS, Lightspeed Restaurant, SpotOn, or a generic webhook).',
      'Choose Reservation integration to connect an outside booking provider so reservations flow into the Reservations tab automatically.',
      'CRM lead capture connects inbound leads (web forms, calls) directly into the Guests CRM.',
      'Check Connections to see what\'s currently linked, and Recent checks to confirm data is syncing.',
    ],
  },
  {
    key: 'sales',
    tab: 'Sales',
    title: 'Sales performance',
    summary: 'See revenue by server, by employee, and top-selling items — pulled from your connected POS.',
    steps: [
      'Open Sales to see revenue broken down By server and By employee for the selected period.',
      'Check Top items by revenue to see what\'s actually selling.',
      'This tab needs a connected POS (see Integrations) to populate with live sales data.',
    ],
  },
  {
    key: 'chat',
    tab: 'Chat',
    title: 'Team chat',
    summary: 'Venue-scoped messaging so shift changes and updates don\'t get lost in a personal group text.',
    steps: [
      'Open Chat to message the team or a specific person — every conversation is scoped to your venue.',
      'Use chat for shift-day coordination; formal requests (swaps, time off, availability changes) still go through Schedule and Availability so they\'re tracked.',
    ],
  },
  {
    key: 'bar-stock',
    tab: 'Bar Stock',
    title: 'Bar & inventory counts',
    summary: 'Count bottles, import stock from a photo or CSV, and keep the reorder list current.',
    steps: [
      'Open Bar Stock and use Inventory Count to walk the bar and log on-hand quantities against par levels.',
      'Under AI import, paste a list, upload a CSV, or snap a photo of an invoice — it\'s parsed into structured items for you to review before importing.',
      'Add items manually anytime with Add item if you\'d rather skip the AI import.',
      'Check the Reorder list for anything below par, and the Prep / 86 board to mark items unavailable for service.',
      'Stock snapshot CSV and the movement log give you exportable records of counts and changes over time.',
    ],
  },
  {
    key: 'reports',
    tab: 'Reports',
    title: 'Reports & payroll exports',
    summary: 'Labor, sales, and reservation data rolled up for the manager meeting — and ready for payroll.',
    steps: [
      'Open Reports for the Live snapshot: covers, labor, and clock alerts for the day.',
      'Check Labor efficiency to see labor cost against sales for the period.',
      'Use Time entries CSV or the Payroll integration to get clock data into your payroll provider.',
      'Reservations CSV exports booking history for reporting outside the app.',
    ],
  },
  {
    key: 'staff',
    tab: 'Staff',
    title: 'Staff management',
    summary: 'Add, invite, and manage the team\'s roles, onboarding, and access.',
    steps: [
      'Open Staff (managers and admins only) to see the full venue roster.',
      'Add staff by email one at a time — set their role (Admin, Manager, Staff), job title, and contact info.',
      'Or use Invite staff via link to generate a shareable link scoped to a role; anyone with the link creates their own account.',
      'Migrate staff from another platform: paste or upload a roster export from Homebase, When I Work, 7shifts, Deputy, Sling, or any spreadsheet. Review the parsed list, then add everyone in one batch instead of one at a time.',
      'Manage Roles & positions to add custom job titles beyond the built-in list.',
      'New staff onboarding tracks each person\'s setup checklist (profile, certifications, training, first-shift readiness).',
      'The role-based audit log records every staff change — who added, edited, or deactivated whom.',
      'Deactivate selected staff to remove someone\'s access without deleting their history.',
    ],
  },
  {
    key: 'logbook',
    tab: 'Profile',
    title: 'Shift logbook',
    summary: 'Handoff notes shared with the whole team, so nothing gets lost between shifts.',
    steps: [
      'Open Shift logbook from Profile to see the running feed of notes for the venue.',
      'Post an entry with a category — shift handoff, incident, maintenance, or general — and a short note for the next shift.',
      'Managers and admins can pin an important entry to the top of the feed.',
      'You can remove your own entries any time; managers can remove any entry.',
    ],
  },
  {
    key: 'checklist',
    tab: 'Profile',
    title: 'Opening/closing task checklist',
    summary: 'A daily task list for opening and closing the venue, with photo proof on tasks that need it.',
    steps: [
      'Open Opening/closing checklist from Profile and switch between the Opening and Closing lists.',
      'Tap Mark done on a task, or Take photo & complete on tasks that require photo proof — the photo is attached to that day\'s completion.',
      'Managers and admins can add new tasks and choose whether a task requires a photo.',
      'The checklist resets automatically each day — yesterday\'s completions (and photos) stay on record.',
    ],
  },
  {
    key: 'profile',
    tab: 'Profile',
    title: 'Account, venue settings & billing',
    summary: 'Your account, the venue\'s location/geofence, and subscription billing.',
    steps: [
      'Open Profile to see your account details and sign out.',
      'Managers and admins: open Venue location & geofence to set the venue\'s address and the radius staff must be inside to clock in.',
      'Open Billing to view or manage the venue\'s subscription.',
      'Account deletion permanently removes your account, profile, and availability — assigned shifts are released back to the venue first.',
    ],
  },
];

export default function HelpScreen() {
  const [query, setQuery] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (section) =>
        section.tab.toLowerCase().includes(q) ||
        section.title.toLowerCase().includes(q) ||
        section.summary.toLowerCase().includes(q) ||
        section.steps.some((step) => step.toLowerCase().includes(q)),
    );
  }, [query]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton icon="arrow-left" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Help & feature guide</Text>
          <Text style={{ color: colors.muted }}>How to work each part of Venue Wrangler.</Text>
        </View>
      </View>

      <TextInput
        placeholder="Search features (e.g. clock, floor, import)"
        value={query}
        onChangeText={setQuery}
        mode="outlined"
        left={<TextInput.Icon icon="magnify" />}
        style={{ backgroundColor: colors.surface }}
      />

      {filtered.length === 0 ? (
        <Text style={{ color: colors.muted }}>No features match "{query}".</Text>
      ) : (
        filtered.map((section) => {
          const isOpen = expandedKey === section.key;
          return (
            <Card key={section.key} style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <Pressable
                  onPress={() => setExpandedKey(isOpen ? null : section.key)}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}
                  accessibilityRole="button"
                  accessibilityLabel={`${isOpen ? 'Collapse' : 'Expand'} ${section.title} instructions`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      {section.tab}
                    </Text>
                    <Text variant="titleMedium" style={{ fontWeight: '700' }}>{section.title}</Text>
                    <Text style={{ color: colors.muted }}>{section.summary}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={24}
                    color={colors.muted}
                  />
                </Pressable>
                {isOpen ? (
                  <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                    {section.steps.map((step, index) => (
                      <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
                        <Text style={{ color: colors.primary, fontWeight: '700' }}>{index + 1}.</Text>
                        <Text style={{ flex: 1, color: colors.charcoal, lineHeight: 20 }}>{step}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card.Content>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}
