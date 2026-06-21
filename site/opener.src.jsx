// Venue Wrangler website opener. The scene (chaos -> lasso -> features snap into
// one workspace -> "Every venue, wrangled.") is the exact animation from the
// authoring file; only the surrounding Stage is replaced with a fullscreen,
// auto-playing web stage (no scrubber/letterbox) that cover-fits the viewport
// and fires onDone so the page can cross-fade into the landing.
//
// Source — compile with:
//   node -e "const b=require('@babel/core');const fs=require('fs');fs.writeFileSync('site/opener.js', b.transformFileSync('site/opener.src.jsx',{presets:[['@babel/preset-react',{runtime:'classic'}]]}).code)"
(function () {
  const React = window.React;
  if (!React) return;

  // How long the overlay plays before cross-fading out. The scene settles ~10s
  // and holds the finished workspace + tagline; we cut shortly after.
  const OPENER_DURATION = 11.4;

  // ── easing + interpolation (verbatim) ──────────────────────────────────────
  const Easing = {
    linear: (t) => t,
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => t * (2 - t),
    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => (--t) * t * t + 1,
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
    easeOutBack: (t) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
  };
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  function interpolate(input, output, ease = Easing.linear) {
    return (t) => {
      if (t <= input[0]) return output[0];
      if (t >= input[input.length - 1]) return output[output.length - 1];
      for (let i = 0; i < input.length - 1; i++) {
        if (t >= input[i] && t <= input[i + 1]) {
          const span = input[i + 1] - input[i];
          const local = span === 0 ? 0 : (t - input[i]) / span;
          const easeFn = Array.isArray(ease) ? (ease[i] || Easing.linear) : ease;
          return output[i] + (output[i + 1] - output[i]) * easeFn(local);
        }
      }
      return output[output.length - 1];
    };
  }

  const TimelineContext = React.createContext({ time: 0, duration: OPENER_DURATION, playing: false });
  const useTime = () => React.useContext(TimelineContext).time;

  // ── Venue Wrangler scene (verbatim) ────────────────────────────────────────
  const VW = { ink: '#2B2A33', teal: '#1FA98F', coral: '#FF6B5C', yellow: '#FFC24B' };
  const FONT_HEAD = "'Baloo 2', system-ui, sans-serif";
  const FONT_BODY = "'Nunito', system-ui, sans-serif";

  const T = { chaosStart: 0.8, wrangle: 4.6, featIn: 5.0, snap: 9.0, settle: 9.95, end: 13 };

  const FEATURES = [
    { label: 'Scheduling', icon: '🗓️', color: '#1FA98F' },
    { label: 'Reservations', icon: '📖', color: '#2C8FD6' },
    { label: 'Floor Control', icon: '🪑', color: '#7C6FD6' },
    { label: 'CRM', icon: '👥', color: '#C2557A' },
    { label: 'Inventory', icon: '📦', color: '#E08A2B' },
    { label: 'Reports', icon: '📊', color: '#D4564E' },
    { label: 'Payroll Exports', icon: '💸', color: '#2F9E5B' },
    { label: 'Staff Chat', icon: '💬', color: '#3BA1A0' },
  ];

  const CHAOS = [
    { type: 'note', text: 'OVERBOOKED!', color: '#FFD43B', x: 440, y: 300, rot: -8 },
    { type: 'note', text: 'NO-SHOW\nTable 4', color: '#FF9DAA', x: 1470, y: 330, rot: 7 },
    { type: 'note', text: 'WAITLIST\n× 12', color: '#9BE3B4', x: 1530, y: 690, rot: -6 },
    { type: 'note', text: 'DOUBLE\nBOOKED', color: '#FFB38A', x: 380, y: 730, rot: 9 },
    { type: 'phone', x: 710, y: 235, rot: -12 },
    { type: 'phone', x: 1230, y: 250, rot: 10 },
    { type: 'emoji', text: '😰', x: 300, y: 530, rot: 0, size: 96 },
    { type: 'emoji', text: '🧑‍🍳', x: 1620, y: 510, rot: 0, size: 96 },
    { type: 'emoji', text: '📋', x: 770, y: 840, rot: -10, size: 84 },
    { type: 'emoji', text: '🗒️', x: 1170, y: 850, rot: 8, size: 84 },
    { type: 'emoji', text: '❗', x: 560, y: 470, rot: 0, size: 72 },
    { type: 'emoji', text: '❗', x: 1390, y: 760, rot: 0, size: 72 },
  ];

  const WIN = { x: 280, y: 235, w: 1360, h: 470, title: 64 };
  const GRID = { startX: 338, startY: 344, pw: 290, ph: 118, gapX: 28, gapY: 28 };
  const cellCX = (i) => GRID.startX + (i % 4) * (GRID.pw + GRID.gapX) + GRID.pw / 2;
  const cellCY = (i) => GRID.startY + Math.floor(i / 4) * (GRID.ph + GRID.gapY) + GRID.ph / 2;
  const ORBIT = { cx: 960, cy: 460, r: 300 };

  function pillState(i, t) {
    const baseA = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const spin = (t > T.featIn ? (t - T.featIn) : 0) * 1.05;
    const ang = baseA + spin;
    const ox = ORBIT.cx + ORBIT.r * Math.cos(ang);
    const oy = ORBIT.cy + ORBIT.r * Math.sin(ang);
    const entryStart = T.featIn + i * 0.09;
    const entryEnd = entryStart + 0.7;
    const edgeA = baseA + 0.6;
    const offx = 960 + Math.cos(edgeA) * 1500;
    const offy = 540 + Math.sin(edgeA) * 1100;
    if (t < entryStart) return { x: offx, y: offy, scale: 0.6, opacity: 0, rot: 0 };
    if (t < entryEnd) {
      const p = Easing.easeOutCubic(clamp((t - entryStart) / (entryEnd - entryStart), 0, 1));
      return {
        x: offx + (ox - offx) * p, y: offy + (oy - offy) * p,
        scale: 0.6 + 0.4 * p, opacity: clamp(p * 2, 0, 1),
        rot: (1 - p) * 40 * (i % 2 ? 1 : -1),
      };
    }
    if (t < T.snap) return { x: ox, y: oy, scale: 1, opacity: 1, rot: Math.sin(t * 3 + i) * 4 };
    const angSnap = baseA + (T.snap - T.featIn) * 1.05;
    const sx = ORBIT.cx + ORBIT.r * Math.cos(angSnap);
    const sy = ORBIT.cy + ORBIT.r * Math.sin(angSnap);
    const raw = clamp((t - T.snap) / (T.settle - T.snap), 0, 1);
    const p = Easing.easeOutBack(raw);
    return {
      x: sx + (cellCX(i) - sx) * p, y: sy + (cellCY(i) - sy) * p,
      scale: 1, opacity: 1, rot: (1 - raw) * (i % 2 ? 6 : -6),
    };
  }

  function FeaturePill({ i }) {
    const t = useTime();
    const f = FEATURES[i];
    const s = pillState(i, t);
    if (s.opacity <= 0.01) return null;
    const floatY = t > T.settle ? Math.sin(t * 1.4 + i) * 3 : 0;
    return (
      <div style={{
        position: 'absolute', left: s.x, top: s.y + floatY,
        width: GRID.pw, height: GRID.ph,
        transform: `translate(-50%,-50%) scale(${s.scale}) rotate(${s.rot}deg)`,
        opacity: s.opacity, background: '#fff', borderRadius: 18,
        boxShadow: '0 12px 26px rgba(20,20,40,0.12)', border: '1px solid rgba(0,0,0,0.04)',
        display: 'flex', alignItems: 'center', gap: 18, padding: '0 24px',
        willChange: 'transform,opacity', boxSizing: 'border-box',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16, background: f.color + '22',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, flexShrink: 0,
        }}>{f.icon}</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 25, fontWeight: 700, color: VW.ink, lineHeight: 1.05, whiteSpace: 'nowrap' }}>{f.label}</div>
          <div style={{ width: 88, height: 8, borderRadius: 4, background: f.color, marginTop: 8, opacity: 0.85 }}></div>
        </div>
      </div>
    );
  }

  function AppWindow() {
    const t = useTime();
    const raw = clamp((t - (T.snap - 0.15)) / 0.7, 0, 1);
    if (raw <= 0) return null;
    const p = Easing.easeOutBack(raw);
    const opacity = clamp((t - (T.snap - 0.15)) / 0.4, 0, 1);
    const dot = (c) => ({ width: 14, height: 14, borderRadius: '50%', background: c });
    return (
      <div style={{
        position: 'absolute', left: WIN.x + WIN.w / 2, top: WIN.y + WIN.h / 2,
        width: WIN.w, height: WIN.h, transform: `translate(-50%,-50%) scale(${0.9 + 0.1 * p})`,
        opacity, background: '#FBFCFD', borderRadius: 24,
        boxShadow: '0 44px 96px rgba(20,20,40,0.22)', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.05)',
      }}>
        <div style={{ height: WIN.title, background: '#fff', borderBottom: '1px solid #EEEDEA', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16 }}>
          <div style={{ display: 'flex', gap: 9 }}>
            <span style={dot('#FF6058')}></span>
            <span style={dot('#FEBC2E')}></span>
            <span style={dot('#28C840')}></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 6 }}>
            <span style={{ fontSize: 24 }}>🤠</span>
            <span style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 22, color: VW.ink, letterSpacing: '-0.01em' }}>Venue Wrangler</span>
          </div>
          <div style={{ marginLeft: 'auto', fontFamily: FONT_BODY, fontSize: 15, color: '#9AA6A2', fontWeight: 700 }}>One shared workspace</div>
        </div>
      </div>
    );
  }

  function Storefront() {
    const t = useTime();
    const appear = clamp(t / 0.6, 0, 1);
    const fade = clamp(1 - (t - T.wrangle) / 0.5, 0, 1);
    const op = Math.min(appear, fade);
    if (op <= 0.01) return null;
    const wob = t < T.wrangle ? Math.sin(t * 9) * (clamp((t - T.chaosStart) / 2, 0, 1) * 1.6) : 0;
    const win = { width: 120, height: 130, borderRadius: 14, background: '#BFE9FB', border: '5px solid #2B2A33' };
    return (
      <div style={{
        position: 'absolute', left: 960, top: 560,
        transform: `translate(-50%,-50%) rotate(${wob}deg) scale(${0.96 + 0.04 * appear})`,
        opacity: op, width: 520, fontFamily: FONT_HEAD,
      }}>
        <div style={{ background: VW.ink, color: '#FFF3E2', borderRadius: 14, padding: '12px 0', textAlign: 'center', fontWeight: 800, fontSize: 30, letterSpacing: '0.02em', marginBottom: 6, boxShadow: '0 8px 0 rgba(0,0,0,0.12)' }}>BELLA&apos;S BISTRO</div>
        <div style={{ height: 46, borderRadius: '14px 14px 4px 4px', background: 'repeating-linear-gradient(90deg, #FF6B5C 0 34px, #FFF3E2 34px 68px)', border: '4px solid #2B2A33', borderBottom: 'none' }}></div>
        <div style={{ background: '#FFFDF7', border: '5px solid #2B2A33', borderRadius: '4px 4px 18px 18px', padding: '26px 30px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={win}></div>
          <div style={{ width: 108, height: 160, borderRadius: '14px 14px 0 0', background: '#FFD9A0', border: '5px solid #2B2A33' }}></div>
          <div style={win}></div>
        </div>
      </div>
    );
  }

  function ChaosItem({ item, i }) {
    const t = useTime();
    const start = T.chaosStart + i * 0.12;
    if (t < start) return null;
    const appear = clamp((t - start) / 0.3, 0, 1);
    const intensity = clamp((t - T.chaosStart) / 2.2, 0, 1);
    const ph = i * 1.7;
    const jx = Math.sin(t * (6 + i * 0.5) + ph) * (8 + 18 * intensity);
    const jy = Math.cos(t * (5 + i * 0.4) + ph * 1.3) * (6 + 16 * intensity);
    const pull = t > T.wrangle ? Easing.easeInCubic(clamp((t - T.wrangle) / 0.55, 0, 1)) : 0;
    let scale = (0.7 + 0.3 * Easing.easeOutBack(appear)) * (1 - pull);
    let op = appear * (1 - pull);
    let rot = item.rot + Math.sin(t * 7 + ph) * (4 + 8 * intensity) + pull * 240;
    if (op <= 0.01) return null;
    const bx = item.x + (960 - item.x) * pull + jx;
    const by = item.y + (520 - item.y) * pull + jy;
    let inner;
    if (item.type === 'note') {
      inner = (
        <div style={{ background: item.color, color: VW.ink, fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 26, lineHeight: 1.1, padding: '18px 22px', borderRadius: 6, whiteSpace: 'pre-line', textAlign: 'center', boxShadow: '0 10px 20px rgba(0,0,0,0.18)', minWidth: 120 }}>{item.text}</div>
      );
    } else if (item.type === 'phone') {
      inner = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 78 }}>📞</span>
          <span style={{ fontFamily: FONT_HEAD, fontWeight: 800, fontSize: 26, color: '#fff', background: VW.coral, padding: '6px 12px', borderRadius: 20, boxShadow: '0 6px 14px rgba(0,0,0,0.2)' }}>RING!</span>
        </div>
      );
    } else {
      inner = <span style={{ fontSize: item.size, filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.18))' }}>{item.text}</span>;
    }
    return (
      <div style={{ position: 'absolute', left: bx, top: by, transform: `translate(-50%,-50%) rotate(${rot}deg) scale(${scale})`, opacity: op, willChange: 'transform,opacity' }}>{inner}</div>
    );
  }

  function Lasso() {
    const t = useTime();
    const s = clamp((t - T.wrangle) / 1.0, 0, 1);
    if (t < T.wrangle || s >= 1) return null;
    const scale = 0.1 + s * 2.4;
    const op = s < 0.2 ? s / 0.2 : (1 - (s - 0.2) / 0.8);
    return (
      <div style={{ position: 'absolute', left: 960, top: 520, width: 600, height: 600, transform: `translate(-50%,-50%) scale(${scale}) rotate(${s * 420}deg)`, opacity: op * 0.9, borderRadius: '50%', border: `14px dashed ${VW.teal}`, boxShadow: `0 0 50px ${VW.teal}66` }}></div>
    );
  }

  function Confetti() {
    const t = useTime();
    const s = (t - T.snap) / 1.2;
    if (s < 0 || s > 1) return null;
    const colors = [VW.teal, VW.coral, VW.yellow, '#7C6FD6', '#2C8FD6'];
    const dist = Easing.easeOutCubic(clamp(s, 0, 1)) * 440;
    const dots = [];
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      dots.push(
        <div key={k} style={{ position: 'absolute', left: 960 + Math.cos(a) * dist, top: 460 + Math.sin(a) * dist, width: 16, height: 16, borderRadius: k % 2 ? '50%' : 3, background: colors[k % 5], opacity: 1 - s, transform: `translate(-50%,-50%) rotate(${s * 360}deg)` }}></div>
      );
    }
    return <>{dots}</>;
  }

  function Backdrop() {
    const t = useTime();
    const calm = clamp((t - T.wrangle) / (T.snap - T.wrangle), 0, 1);
    const flash = t > T.wrangle && t < T.wrangle + 0.35 ? (1 - (t - T.wrangle) / 0.35) : 0;
    return (
      <>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 40%, #FFE6CE, #FBD4B6)' }}></div>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 45%, #EDF9F3, #D6EFE7)', opacity: calm }}></div>
        <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: flash * 0.85 }}></div>
      </>
    );
  }

  function Tagline() {
    const t = useTime();
    const op = clamp((t - (T.settle + 0.15)) / 0.6, 0, 1);
    if (op <= 0) return null;
    const ty = (1 - Easing.easeOutCubic(op)) * 18;
    return (
      <div style={{ position: 'absolute', left: 960, top: 768, width: 1100, transform: `translate(-50%,0) translateY(${ty}px)`, opacity: op, textAlign: 'center' }}>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 42, fontWeight: 800, color: VW.ink, letterSpacing: '-0.02em' }}>Every venue, wrangled.</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 23, color: '#6B7A77', marginTop: 10, fontWeight: 600 }}>Scheduling, reservations, floor, CRM, inventory &amp; more — one shared workspace.</div>
      </div>
    );
  }

  function Camera({ children }) {
    const t = useTime();
    const zoom = interpolate(
      [0, T.chaosStart, T.wrangle, T.wrangle + 0.3, T.snap, T.settle],
      [1.0, 1.0, 1.12, 1.18, 1.0, 1.0],
      Easing.easeInOutCubic
    )(t);
    const shakeAmp = interpolate([T.chaosStart, 2.5, T.wrangle], [0, 5, 9], Easing.linear)(t) * (t < T.wrangle ? 1 : 0);
    const sx = Math.sin(t * 23) * shakeAmp;
    const sy = Math.cos(t * 19) * shakeAmp;
    return (
      <div style={{ position: 'absolute', inset: 0, transformOrigin: 'center', transform: `scale(${zoom}) translate(${sx}px,${sy}px)`, willChange: 'transform' }}>
        {children}
      </div>
    );
  }

  function VWScene() {
    return (
      <>
        <Backdrop />
        <Camera>
          <Storefront />
          {CHAOS.map((it, i) => <ChaosItem key={i} item={it} i={i} />)}
          <Lasso />
          <AppWindow />
          {FEATURES.map((f, i) => <FeaturePill key={i} i={i} />)}
          <Confetti />
        </Camera>
        <Tagline />
      </>
    );
  }

  // ── fullscreen web stage (replaces the authoring Stage) ────────────────────
  function WebStage({ duration, onDone, children }) {
    const W = 1920, H = 1080;
    const [time, setTime] = React.useState(0);
    const [scale, setScale] = React.useState(1);
    const doneRef = React.useRef(false);

    React.useEffect(() => {
      const measure = () => setScale(Math.max(window.innerWidth / W, window.innerHeight / H));
      measure();
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }, []);

    React.useEffect(() => {
      let raf, last = null;
      const step = (ts) => {
        if (last == null) last = ts;
        const dt = (ts - last) / 1000;
        last = ts;
        setTime((t) => {
          const next = t + dt;
          if (next >= duration && !doneRef.current) {
            doneRef.current = true;
            if (onDone) onDone();
          }
          return next >= duration ? duration : next;
        });
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => { if (raf) cancelAnimationFrame(raf); };
    }, [duration, onDone]);

    const ctx = React.useMemo(() => ({ time, duration, playing: true }), [time, duration]);
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#FBD4B6' }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: W, height: H, transform: `translate(-50%,-50%) scale(${scale})`, transformOrigin: 'center' }}>
          <TimelineContext.Provider value={ctx}>{children}</TimelineContext.Provider>
        </div>
      </div>
    );
  }

  function VenueWranglerOpener({ onDone }) {
    return <WebStage duration={OPENER_DURATION} onDone={onDone}><VWScene /></WebStage>;
  }

  window.VenueWranglerOpener = VenueWranglerOpener;
})();
