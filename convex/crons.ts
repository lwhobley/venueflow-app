import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Refresh the dashboard's Cosmic Insights every 8 hours (no-op without
// OPENROUTER_API_KEY; the dashboard falls back to a curated library).
crons.interval('refresh cosmic insights', { hours: 8 }, internal.cosmicInsights.generateInsights, {});

export default crons;
