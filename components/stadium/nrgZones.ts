/**
 * NRG Stadium pilot zone map for the home-page 3D spatial view.
 * Positions are in scene units relative to field center.
 * Data shaped for ops (amenities / menu / BEO), not ticketing.
 */

export type StadiumZone = {
  id: string;
  name: string;
  shortLabel: string;
  /** [x, y, z] in stadium scene space */
  position: [number, number, number];
  /** hotspot scale */
  scale?: number;
  capacity: string;
  sqft?: string;
  amenities: string[];
  menuOrBeo: string;
  notes?: string;
  /** base emissive hex when idle */
  color: string;
};

export const NRG_ZONES: StadiumZone[] = [
  {
    id: 'field',
    name: 'Field / Floor',
    shortLabel: 'FIELD',
    position: [0, 0.15, 0],
    scale: 1.4,
    capacity: 'Banquet ~6,080 · Reception ~8,200',
    sqft: '125,000 sq ft configurable',
    amenities: ['Retractable roof', 'Full rigging grid', 'Broadcast-ready', 'Field-level load-in'],
    menuOrBeo: 'Active BEO controls floor layout, staging, and F&B stations. Tap to open current event order.',
    notes: 'NRG Stadium floor converts between NFL, soccer, concert, and general-session configurations.',
    color: '#2F6B3A',
  },
  {
    id: 'club-east',
    name: 'East Club Level',
    shortLabel: 'E CLUB',
    position: [5.2, 1.6, 0],
    capacity: 'Club seating + lounge overflow',
    amenities: ['Climate-controlled lounge', 'Premium bars', 'In-seat service', 'Private restrooms'],
    menuOrBeo: 'Club menu packages and hospitality BEOs attach here for event day.',
    color: '#3D6B8A',
  },
  {
    id: 'club-west',
    name: 'West Club Level',
    shortLabel: 'W CLUB',
    position: [-5.2, 1.6, 0],
    capacity: 'Club seating + lounge overflow',
    amenities: ['Climate-controlled lounge', 'Premium bars', 'In-seat service', 'Private restrooms'],
    menuOrBeo: 'Club menu packages and hospitality BEOs attach here for event day.',
    color: '#3D6B8A',
  },
  {
    id: 'suites-north',
    name: 'North Suites',
    shortLabel: 'N SUITES',
    position: [0, 2.2, -6.4],
    capacity: '14–24 guests per suite',
    amenities: ['Retractable window wall', 'Private balcony', 'In-suite catering', 'Flat screens', 'VIP parking'],
    menuOrBeo: 'Per-suite catering menus and BEO line items live on each suite record.',
    notes: '198 suites total across lower, club, and upper levels.',
    color: '#8A6B2D',
  },
  {
    id: 'suites-south',
    name: 'South Suites',
    shortLabel: 'S SUITES',
    position: [0, 2.2, 6.4],
    capacity: '14–24 guests per suite',
    amenities: ['Retractable window wall', 'Private balcony', 'In-suite catering', 'Flat screens', 'VIP parking'],
    menuOrBeo: 'Per-suite catering menus and BEO line items live on each suite record.',
    color: '#8A6B2D',
  },
  {
    id: 'champions',
    name: 'Champions Club',
    shortLabel: 'CHAMPIONS',
    position: [3.8, 1.1, 5.8],
    capacity: 'Premium hospitality',
    amenities: ['Exclusive entry', 'Upscale F&B', 'Lounge seating', 'Event overlays'],
    menuOrBeo: 'Premium hospitality menu and BEO packages for Champions Club events.',
    color: '#A35E35',
  },
  {
    id: 'directors',
    name: "Director's Club",
    shortLabel: 'DIRECTORS',
    position: [-3.8, 1.1, 5.8],
    capacity: 'Premium hospitality',
    amenities: ['Exclusive entry', 'Upscale F&B', 'Lounge seating', 'Event overlays'],
    menuOrBeo: "Director's Club catering packages and BEO contents.",
    color: '#A35E35',
  },
  {
    id: 'concourse-upper',
    name: 'Upper Concourse',
    shortLabel: 'CONCOURSE',
    position: [0, 3.4, 0],
    scale: 0.9,
    capacity: 'Banquet ~5,900 · Reception ~8,000',
    sqft: '~94,000 sq ft concourse',
    amenities: ['F&B stations', 'Guest services', 'ADA routes', 'Merchandise'],
    menuOrBeo: 'Concourse F&B BEOs and station maps for event day staffing.',
    color: '#5A6B5E',
  },
  {
    id: 'service',
    name: 'Service Level',
    shortLabel: 'SERVICE',
    position: [0, -0.4, -4.2],
    capacity: 'Back-of-house ops',
    amenities: ['Loading docks', 'Production trailers', 'Kitchen support', 'Staff corridors'],
    menuOrBeo: 'Service-level notes, load-in windows, and production BEO attachments.',
    notes: 'Not guest-facing — ops and production only.',
    color: '#4A5560',
  },
];

export function getZoneById(id: string | null): StadiumZone | undefined {
  if (!id) return undefined;
  return NRG_ZONES.find((z) => z.id === id);
}
