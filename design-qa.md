# Operations command redesign QA

**Source visual truth path**

- `C:\Users\lwhob\.codex\generated_images\019fbb40-ca66-7f51-80ab-6ef6a1314b69\exec-98cf8500-679d-4199-bd51-e7b9c5b9d9a1.png`
- Source dimensions: 853 × 1842 pixels.

**Implementation evidence**

- Target route: `app/(tabs)/home.tsx`.
- Intended viewport: 390 × 844 CSS pixels at device scale factor 1.
- Browser-rendered implementation screenshot: unavailable. The local Expo web process did not expose a reachable preview during this run, and the in-app browser connection timed out before it could capture the authenticated app state.
- Density normalization: blocked; no implementation image was available to normalize with the source.
- State: authenticated manager with a selected venue, manager dashboard, daily brief, and command-center data available.

**Findings**

- [P1] Browser visual verification is unavailable
  Location: local mobile web preview.
  Evidence: no rendered implementation screenshot could be captured.
  Impact: the command layout cannot be compared visually against the selected reference at the required viewport.
  Fix: start the Expo web preview in a reachable local browser session, authenticate as a venue manager, capture the Home tab at 390 × 844, then compare it with the selected reference.

**Required fidelity surfaces**

- Fonts and typography: implemented with the native sans system rather than the earlier serif display treatment. Browser evidence is still required to check wrapping and optical weight.
- Spacing and layout rhythm: code uses one full-width command header, one priority strip, table rows, a timeline, and a compact four-column footer. Visual overflow and spacing remain unverified.
- Colors and visual tokens: shared light tokens now use green planboard, warm white, hairline dividers, accessible green, and amber warning states. Browser contrast verification is still needed.
- Image quality and asset fidelity: the selected reference has no app-owned raster imagery; the implementation uses the existing Material Community icon set for standard UI icons.
- Copy and content: all values come from existing dashboard, daily brief, command-center, notifications, and goal-query/mutation paths. Browser evidence is still needed to validate real-data wrapping.

**Open Questions**

- Does the manager command endpoint return a complete `readiness.categories` object for every venue? The UI safely renders missing values as pending, but this should be checked against a live manager account.

**Implementation Checklist**

1. Capture the authenticated manager Home tab at 390 × 844.
2. Verify the priority action, readiness-row navigation, notification read action, event navigation, and manager goal mutation.
3. Compare the capture side by side with the source image and correct P0/P1/P2 differences.

**Comparison history**

- No visual comparison iteration completed because the browser-rendered implementation could not be captured.

**Follow-up Polish**

- Consider reducing the header title size slightly if a long venue name causes the command header to wrap on narrow devices.

final result: blocked
