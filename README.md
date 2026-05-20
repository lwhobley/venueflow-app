# VenueFlow

VenueFlow is a native iOS/Android venue ops app built with Expo Router and Convex.

## Role model

- Admin/owner/manager: full visibility and edit access for schedule, floor plan, staff, requests, and live operations
- Staff: read-only floor/schedule visibility, personal time clock punching, own hours, and request flows

## What works now

- Convex-backed auth bootstrap
- Venue assignment
- Precise GPS geofenced clock-in and clock-out
- Manager/admin live clock board
- Weekly schedule calendar
- Staff request flows for add/drop shifts, time off, and two-week availability
- Floor plan and table management with drag-and-drop editor for admins/managers
- Staff management screen for admins/managers to add people and assign roles to a venue
- Profile page shortcut to open staff management for privileged roles
- Billing shell with automatic 14-day trial state for new venues

## Local setup

1. Start the mobile app with Expo.
2. Sync Convex after any backend change.
3. Test the sign-in flow, geofenced clock actions, and role-specific screens.

## EAS

- `eas build -p ios --profile production`
- `eas build -p android --profile production`
- `eas submit -p ios --profile production`
- `eas submit -p android --profile production`

## Backend

- Convex for auth, venue profiles, time clock data, floor plans, staff requests, and staff management
- Push notifications remain handled by Convex internal actions

## Floor sync

- Seed a sample floor plan from the Floor Editor if you need demo tables
- Admin/manager can save and publish floor changes
- Staff can view the floor but cannot edit it