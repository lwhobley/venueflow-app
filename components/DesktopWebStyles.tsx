import { useEffect } from 'react';
import { Platform } from 'react-native';

const STYLE_ID = 'venuewrangler-desktop-web-styles';

export function DesktopWebStyles() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    if (document.getElementById(STYLE_ID)) return undefined;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @media (min-width: 900px) {
        button,
        [role="button"],
        div:has(> button),
        div:has(> [role="button"]) {
          align-self: flex-start !important;
          flex-grow: 0 !important;
          flex-basis: auto !important;
          width: fit-content !important;
          max-width: min(100%, 360px) !important;
        }

        button[aria-label="tab"],
        [role="button"][aria-label="tab"],
        [role="tab"],
        [role="menuitem"],
        [role="checkbox"],
        [role="radio"],
        [role="switch"],
        div:has(> button[aria-label="tab"]),
        div:has(> [role="button"][aria-label="tab"]),
        div:has(> [role="tab"]),
        div:has(> [role="menuitem"]),
        div:has(> [role="checkbox"]),
        div:has(> [role="radio"]),
        div:has(> [role="switch"]) {
          align-self: initial !important;
          width: auto !important;
          max-width: none !important;
        }
      }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  return null;
}
