import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const openerStyles = `
  #vw-opener {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: #FBD4B6;
    opacity: 1;
    transition: opacity .85s ease;
  }
  #vw-opener.vw-show { display: block; }
  #vw-opener.vw-hide { opacity: 0; pointer-events: none; }
  html.vw-lock, html.vw-lock body { overflow: hidden; }
  #vw-skip {
    display: none;
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 10000;
    font-family: 'Nunito', system-ui, sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: #2B2A33;
    background: rgba(255,255,255,0.82);
    border: 1px solid rgba(0,0,0,0.08);
    padding: 9px 16px;
    border-radius: 999px;
    cursor: pointer;
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    box-shadow: 0 6px 18px rgba(20,20,40,0.14);
  }
  #vw-skip.vw-show { display: block; }
  #vw-skip:hover { background: #fff; }
  @media (prefers-reduced-motion: reduce) {
    #vw-opener, #vw-skip { display: none !important; }
  }
`;

// Keep this bootstrap behavior aligned with the enterprise marketing opener.
// The animation bundle itself is copied byte-for-byte to public/opener.js and
// guarded by tests so the desktop app cannot silently drift to a look-alike.
const openerBootstrap = `
(function () {
  var KEY = 'vw-opener-seen';
  var host = document.getElementById('vw-opener');
  var skip = document.getElementById('vw-skip');
  if (!host) return;
  var reduced = false, seen = false;
  try { reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  try { seen = !!sessionStorage.getItem(KEY); } catch (e) {}
  if (seen || reduced) { host.remove(); if (skip) skip.remove(); return; }

  document.documentElement.classList.add('vw-lock');
  host.classList.add('vw-show');

  var finished = false;
  function finish() {
    if (finished) return; finished = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    host.classList.add('vw-hide');
    if (skip) skip.classList.remove('vw-show');
    document.documentElement.classList.remove('vw-lock');
    setTimeout(function () { host.remove(); if (skip) skip.remove(); }, 950);
  }
  if (skip) skip.addEventListener('click', finish);
  var safety = setTimeout(finish, 16000);

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.crossOrigin = 'anonymous';
      if (integrity) script.integrity = integrity;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('failed ' + src)); };
      document.head.appendChild(script);
    });
  }

  loadScript('https://unpkg.com/react@18.3.1/umd/react.production.min.js', 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z')
    .then(function () { return loadScript('https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1'); })
    .then(function () { return loadScript('/opener.js'); })
    .then(function () {
      if (!window.VenueWranglerOpener || !window.React || !window.ReactDOM) { finish(); return; }
      if (skip) skip.classList.add('vw-show');
      var root = window.ReactDOM.createRoot(host);
      root.render(window.React.createElement(window.VenueWranglerOpener, {
        onDone: function () { clearTimeout(safety); finish(); }
      }));
    })
    .catch(function () { finish(); });
})();
`;

// Web-only root document used by Expo Router's static export.
export default function RootDocument({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#F4FAFC" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Nunito:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: openerStyles }} />
      </head>
      <body>
        <div id="vw-opener" aria-hidden="true" />
        <button id="vw-skip" type="button" aria-label="Skip intro">
          Skip intro ›
        </button>
        {children}
        <script dangerouslySetInnerHTML={{ __html: openerBootstrap }} />
      </body>
    </html>
  );
}
