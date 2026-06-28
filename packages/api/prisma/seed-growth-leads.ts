import { PrismaClient, CrmLeadStatus } from '@prisma/client';

const LEADS = [
  { fullName: 'Dennis Gobis / Justin Lavenue', email: 'info@therooseveltroomatx.com', company: 'The Roosevelt Room', source: 'Cold Email', status: 'new', tags: ['Cocktail Lounge', 'Downtown', 'Historic'] },
  { fullName: 'Jessica Sanders', email: 'info@drinkwellaustin.com', company: 'DrinkWell', source: 'Cold Email', status: 'new', tags: ['Neighborhood Bar', 'North Loop', 'Cocktails'] },
  { fullName: 'Scranton Twohey', company: "Whisler's", source: 'Instagram DM', status: 'new', tags: ['East Austin', 'Mezcal', 'Patio'] },
  { fullName: 'Paola Guerrero-Smith', company: 'Milonga Room', source: 'Instagram DM', status: 'new', tags: ['Speakeasy', 'Underground', 'South American'] },
  { fullName: 'General Manager', company: 'Midnight Cowboy', source: 'Instagram DM', status: 'new', tags: ['Speakeasy', 'Downtown', '6th Street'] },
  { fullName: 'General Manager', email: 'contact@auraislandhookah.com', company: 'Aura Island Hookah Lounge', source: 'Cold Email', status: 'new', tags: ['Hookah Lounge', 'Island Theme', 'VIP'] },
  { fullName: 'Operations Manager', company: 'Noir Hookah Lounge', source: 'Instagram DM', status: 'new', tags: ['Hookah Lounge', 'Private Events', 'Nightlife'] },
  { fullName: 'Owner / GM', email: 'info@yahalahookahlounge.com', company: 'Yahala Hookah Lounge', source: 'Cold Email', status: 'new', tags: ['Hookah Lounge', 'Mediterranean', 'Chill'] },
  { fullName: 'Operations Lead', company: 'Sky Hookah Lounge', source: 'Instagram DM', status: 'new', tags: ['Hookah Lounge', 'Gaming', 'DJs'] },
  { fullName: 'VIP Bookings Manager', email: 'info@mayfairaustin.com', company: 'Mayfair Nightclub', source: 'Cold Email', status: 'new', tags: ['Nightclub', 'Downtown', 'VIP Tables'] },
  { fullName: 'Event Booking Manager', email: 'info@saharalounge.com', company: 'Sahara Lounge', source: 'Cold Email', status: 'new', tags: ['Live Music', 'East Austin', 'Community'] },
  { fullName: 'Membership Director', email: 'events@thepershing.com', company: 'The Pershing', source: 'Cold Email', status: 'new', tags: ['Private Club', 'East Austin', 'Luxury'] },
  { fullName: 'Bar Manager', company: 'Daydreamer', source: 'Instagram DM', status: 'new', tags: ['Champagne Bar', 'East Austin', 'Retro'] },
  { fullName: 'Operations Lead', company: 'Codependent Cocktails', source: 'Instagram DM', status: 'new', tags: ['Coffee & Cocktails', 'Downtown', 'Luxe'] },
  { fullName: 'Nikolas Webb', company: 'Here Nor There', source: 'Instagram DM', status: 'new', tags: ['Speakeasy', 'Exclusive', 'App Access'] },
  { fullName: 'Josh Loving', company: 'Small Victory', source: 'Instagram DM', status: 'new', tags: ['Speakeasy', 'Downtown', 'Cozy'] },
  { fullName: 'Bar Manager', company: 'Garage Bar', source: 'Instagram DM', status: 'new', tags: ['Cocktail Lounge', 'Downtown', 'Inside Garage'] },
  { fullName: 'Reservations Manager', company: 'Trona', source: 'Instagram DM', status: 'new', tags: ['Speakeasy', 'East Austin', 'Mexico City Theme'] },
  { fullName: 'Bar Manager', company: 'The Treasury', source: 'Instagram DM', status: 'new', tags: ['Speakeasy', 'East Austin', 'Vault Theme'] },
  { fullName: 'Food & Beverage Director', company: "Lutie's", source: 'Instagram DM', status: 'new', tags: ['Garden Lounge', 'Upscale', 'Commodore Perry'] },
  { fullName: 'Bar Manager / Owner', company: 'Holiday', source: 'Instagram DM', status: 'new', tags: ['Patio Bar', 'East Austin', 'Converted Gas Station'] },
  { fullName: 'F&B Manager', company: 'Watertrade', source: 'Instagram DM', status: 'new', tags: ['Japanese Cocktails', 'South Congress', 'Intimate'] },
  { fullName: 'General Manager', company: 'Edge Rooftop', source: 'Instagram DM', status: 'new', tags: ['Rooftop Lounge', 'Downtown', 'Skyline View'] },
  { fullName: 'Bar Manager', company: 'King Bee Lounge', source: 'Instagram DM', status: 'new', tags: ['Cocktail Lounge', 'East Austin', 'Absinthe'] },
  { fullName: 'Booking Manager', company: 'C-Boy’s Heart & Soul', source: 'Instagram DM', status: 'new', tags: ['Music Lounge', 'South Congress', 'Retro'] },
  { fullName: 'General Manager', email: 'manager@continentalclub.com', company: 'The Gallery Lounge', source: 'Cold Email', status: 'new', tags: ['Jazz Lounge', 'South Congress', 'Intimate'] },
  { fullName: 'Front of House Lead', company: 'South Congress Hotel Bar', source: 'Instagram DM', status: 'new', tags: ['Hotel Bar', 'South Congress', 'Courtyard'] },
  { fullName: 'Restaurant Manager', company: 'Maie Day', source: 'Instagram DM', status: 'new', tags: ['Chophouse Bar', 'South Congress', 'Patio'] },
  { fullName: 'General Manager', company: 'Firehouse Lounge', source: 'Instagram DM', status: 'new', tags: ['Speakeasy', 'Downtown', 'Bookshelf Entry'] },
  { fullName: 'Owner / GM', company: 'Tehran Café', source: 'Instagram DM', status: 'new', tags: ['Hookah Cafe', 'Persian Dining', 'Patio'] },
  { fullName: 'General Manager', company: 'Lava Leander', source: 'Instagram DM', status: 'new', tags: ['Hookah Lounge', 'Cocktail Lounge', 'Leander'] },
  { fullName: 'Private Events Director', email: 'events@speakeasyaustin.com', company: 'Speakeasy', source: 'Cold Email', status: 'new', tags: ['Event Space', 'Downtown', 'Rooftop'] },
  { fullName: 'Bar Manager', company: 'Tigress Pub', source: 'Instagram DM', status: 'new', tags: ['Neighborhood Pub', 'North Loop', 'Cozy'] },
  { fullName: 'Owner / GM', company: 'Mezze Cafe', source: 'Instagram DM', status: 'new', tags: ['Hookah Lounge', 'Social Lounge', 'Chill'] },
  { fullName: 'Bar Manager', company: 'Half Step', source: 'Instagram DM', status: 'new', tags: ['Craft Cocktails', 'Rainey Street', 'Patio'] }
];

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('Seeding Venue Wrangler Growth Cycle 1 leads...');

    // 1. Ensure at least one venue exists
    let venue = await prisma.venue.findFirst();
    if (!venue) {
      console.log('No venue found in database. Creating a default "Austin Nightlife Group" venue...');
      venue = await prisma.venue.create({
        data: {
          name: 'Austin Nightlife Group',
          latitude: 30.2672,
          longitude: -97.7431,
          geofenceRadiusM: 250,
          timezone: 'America/Chicago',
          address: '600 Congress Ave., Austin, TX 78701',
          venueType: 'lounge',
          staffRange: '11-50',
          subscriptionStatus: 'active',
        },
      });
      console.log(`Created Venue: ${venue.name} (ID: ${venue.id})`);
    } else {
      console.log(`Using existing Venue: ${venue.name} (ID: ${venue.id})`);
    }

    // 2. Seed CRM leads
    let seededCount = 0;
    for (const lead of LEADS) {
      const existingLead = await prisma.crmLead.findFirst({
        where: {
          venueId: venue.id,
          company: lead.company,
          deletedAt: null
        }
      });

      if (!existingLead) {
        await prisma.crmLead.create({
          data: {
            venueId: venue.id,
            fullName: lead.fullName,
            email: lead.email ?? null,
            company: lead.company,
            source: lead.source,
            status: lead.status as CrmLeadStatus,
            tags: lead.tags,
            lastActivityAt: new Date(),
            estimatedValueCents: 14900, // Founding Member Rate: $149/mo
          }
        });
        seededCount++;
      }
    }

    console.log(`Successfully seeded ${seededCount} new CRM leads.`);
    
    // Print total count in DB
    const totalLeads = await prisma.crmLead.count({
      where: { venueId: venue.id, deletedAt: null }
    });
    console.log(`Total CRM leads active for venue "${venue.name}": ${totalLeads}`);

  } catch (error) {
    console.error('Error seeding growth leads:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
