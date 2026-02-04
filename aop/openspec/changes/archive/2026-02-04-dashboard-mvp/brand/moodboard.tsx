import { renderToReadableStream } from "react-dom/server";
import React from "react";
import * as fs from "fs";
import * as path from "path";

// Load fonts
const fontsDir = "/home/eng/.claude/skills/canvas-design/canvas-fonts";
const geistMonoRegular = fs.readFileSync(path.join(fontsDir, "GeistMono-Regular.ttf"));
const geistMonoBold = fs.readFileSync(path.join(fontsDir, "GeistMono-Bold.ttf"));
const instrumentSansRegular = fs.readFileSync(path.join(fontsDir, "InstrumentSans-Regular.ttf"));
const instrumentSansBold = fs.readFileSync(path.join(fontsDir, "InstrumentSans-Bold.ttf"));
const juraLight = fs.readFileSync(path.join(fontsDir, "Jura-Light.ttf"));
const juraMedium = fs.readFileSync(path.join(fontsDir, "Jura-Medium.ttf"));

// Color palette - refined for pristine consistency
const colors = {
  // Foundation - warm blacks
  black: "#0A0A0B",
  darkest: "#101012",
  dark: "#18181B",
  charcoal: "#27272A",

  // Warm whites
  cream: "#FAFAF9",
  offWhite: "#F4F4F5",
  warmGray: "#E4E4E7",

  // Primary accent - refined amber
  amber: "#D97706",
  amberLight: "#F59E0B",
  amberMuted: "#B45309",

  // Secondary - slate
  slate: "#71717A",
  slateDark: "#52525B",
  slateLight: "#A1A1AA",

  // Status - muted for sophistication
  success: "#059669",
  working: "#2563EB",
  blocked: "#DC2626",
};

const Moodboard = () => {
  const width = 2400;
  const height = 3420;
  const margin = 120;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
    >
      <defs>
        <style type="text/css">{`
          @font-face {
            font-family: 'GeistMono';
            src: url(data:font/truetype;base64,${geistMonoRegular.toString('base64')}) format('truetype');
            font-weight: 400;
          }
          @font-face {
            font-family: 'GeistMono';
            src: url(data:font/truetype;base64,${geistMonoBold.toString('base64')}) format('truetype');
            font-weight: 700;
          }
          @font-face {
            font-family: 'InstrumentSans';
            src: url(data:font/truetype;base64,${instrumentSansRegular.toString('base64')}) format('truetype');
            font-weight: 400;
          }
          @font-face {
            font-family: 'InstrumentSans';
            src: url(data:font/truetype;base64,${instrumentSansBold.toString('base64')}) format('truetype');
            font-weight: 700;
          }
          @font-face {
            font-family: 'Jura';
            src: url(data:font/truetype;base64,${juraLight.toString('base64')}) format('truetype');
            font-weight: 300;
          }
          @font-face {
            font-family: 'Jura';
            src: url(data:font/truetype;base64,${juraMedium.toString('base64')}) format('truetype');
            font-weight: 500;
          }
        `}</style>

        <radialGradient id="agentGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={colors.amber} stopOpacity="0.4" />
          <stop offset="100%" stopColor={colors.amber} stopOpacity="0" />
        </radialGradient>

        <pattern id="dotGrid" width="48" height="48" patternUnits="userSpaceOnUse">
          <circle cx="24" cy="24" r="0.8" fill={colors.charcoal} fillOpacity="0.5" />
        </pattern>
      </defs>

      {/* Background */}
      <rect width={width} height={height} fill={colors.black} />

      {/* Subtle dot grid - entire canvas */}
      <rect x={margin} y={margin} width={width - margin * 2} height={height - margin * 2} fill="url(#dotGrid)" />

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* HEADER SECTION */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${margin}, 80)`}>
        <text
          fill={colors.slateDark}
          fontFamily="GeistMono"
          fontSize="10"
          letterSpacing="4"
        >
          BRAND IDENTITY SYSTEM
        </text>

        <text
          y="140"
          fill={colors.cream}
          fontFamily="Jura"
          fontWeight="300"
          fontSize="200"
          letterSpacing="40"
        >
          AOP
        </text>

        <text
          y="200"
          fill={colors.slate}
          fontFamily="InstrumentSans"
          fontWeight="400"
          fontSize="24"
          letterSpacing="16"
        >
          AGENTS OPERATING PLATFORM
        </text>

        {/* Accent line */}
        <line x1="0" y1="240" x2="640" y2="240" stroke={colors.amber} strokeWidth="1.5" />
        <circle cx="640" cy="240" r="3" fill={colors.amber} />
      </g>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* PHILOSOPHY SECTION */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${margin}, 440)`}>
        <text fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="3">
          01 — PHILOSOPHY
        </text>

        <text y="56" fill={colors.cream} fontFamily="Jura" fontWeight="300" fontSize="40" letterSpacing="2">
          Orchestral Precision
        </text>

        <text y="110" fill={colors.slateLight} fontFamily="InstrumentSans" fontSize="15" letterSpacing="0.3">
          The invisible force that coordinates many autonomous voices into unified purpose.
        </text>
        <text y="134" fill={colors.slateLight} fontFamily="InstrumentSans" fontSize="15" letterSpacing="0.3">
          Control meets autonomy. Structure enables freedom.
        </text>
      </g>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* COLOR PALETTE SECTION */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${margin}, 640)`}>
        <text fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="3">
          02 — COLOR SYSTEM
        </text>

        {/* Foundation row */}
        <g transform="translate(0, 56)">
          {[
            { color: colors.black, hex: "#0A0A0B", name: "BLACK" },
            { color: colors.darkest, hex: "#101012", name: "DARKEST" },
            { color: colors.dark, hex: "#18181B", name: "DARK" },
            { color: colors.charcoal, hex: "#27272A", name: "CHARCOAL" },
          ].map((c, i) => (
            <g key={c.name} transform={`translate(${i * 200}, 0)`}>
              <rect width="180" height="160" fill={c.color} rx="4" />
              <text y="184" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9">{c.hex}</text>
              <text y="200" fill={colors.slate} fontFamily="InstrumentSans" fontSize="11">{c.name}</text>
            </g>
          ))}

          <line x1="840" y1="0" x2="840" y2="160" stroke={colors.charcoal} strokeWidth="1" />

          {[
            { color: colors.cream, hex: "#FAFAF9", name: "CREAM" },
            { color: colors.offWhite, hex: "#F4F4F5", name: "OFF WHITE" },
            { color: colors.warmGray, hex: "#E4E4E7", name: "WARM GRAY" },
          ].map((c, i) => (
            <g key={c.name} transform={`translate(${880 + i * 200}, 0)`}>
              <rect width="180" height="160" fill={c.color} rx="4" />
              <text y="184" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9">{c.hex}</text>
              <text y="200" fill={colors.slate} fontFamily="InstrumentSans" fontSize="11">{c.name}</text>
            </g>
          ))}
        </g>

        {/* Accent row */}
        <g transform="translate(0, 290)">
          <rect width="600" height="120" fill={colors.amberMuted} rx="4" />
          <rect x="600" width="1" height="120" fill={colors.amber} />
          <rect x="601" width="600" height="120" fill={colors.amber} rx="4" />

          <text x="20" y="145" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9">#B45309</text>
          <text x="620" y="145" fill={colors.amber} fontFamily="GeistMono" fontSize="9" fontWeight="700">#D97706</text>
          <text x="300" y="166" fill={colors.cream} fontFamily="InstrumentSans" fontSize="12" letterSpacing="4" textAnchor="middle">PRIMARY ACCENT — AMBER</text>

          {/* Slate secondary */}
          <g transform="translate(1280, 0)">
            {[
              { color: colors.slateDark, hex: "#52525B" },
              { color: colors.slate, hex: "#71717A" },
              { color: colors.slateLight, hex: "#A1A1AA" },
            ].map((c, i) => (
              <rect key={c.hex} x={i * 140} width="130" height="120" fill={c.color} rx="4" />
            ))}
            <text y="145" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9">#52525B</text>
            <text x="280" y="145" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9">#A1A1AA</text>
            <text x="210" y="166" fill={colors.slate} fontFamily="InstrumentSans" fontSize="11" letterSpacing="2" textAnchor="middle">SECONDARY</text>
          </g>
        </g>

        {/* Status indicators */}
        <g transform="translate(0, 460)">
          <text fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" letterSpacing="2">STATUS</text>

          {[
            { color: colors.charcoal, border: colors.slateDark, label: "DRAFT", hex: "#27272A" },
            { color: colors.amber, border: null, label: "READY", hex: "#D97706" },
            { color: colors.working, border: null, label: "WORKING", hex: "#2563EB" },
            { color: colors.success, border: null, label: "DONE", hex: "#059669" },
            { color: colors.blocked, border: null, label: "BLOCKED", hex: "#DC2626" },
          ].map((s, i) => (
            <g key={s.label} transform={`translate(${i * 320}, 32)`}>
              <circle r="16" fill={s.color} stroke={s.border || "none"} strokeWidth={s.border ? 1 : 0} />
              <text x="32" y="5" fill={colors.slateLight} fontFamily="GeistMono" fontSize="10">{s.label}</text>
              <text x="120" y="5" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9">{s.hex}</text>
            </g>
          ))}
        </g>
      </g>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* TYPOGRAPHY SECTION */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${margin}, 1220)`}>
        <text fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="3">
          03 — TYPOGRAPHY
        </text>

        <g transform="translate(0, 56)">
          <text fill={colors.cream} fontFamily="Jura" fontWeight="300" fontSize="80" letterSpacing="4">
            Jura Light
          </text>
          <text y="30" fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="1">
            DISPLAY · HEADLINES · NUMBERS
          </text>

          <text y="140" fill={colors.cream} fontFamily="InstrumentSans" fontWeight="400" fontSize="48">
            Instrument Sans
          </text>
          <text y="172" fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="1">
            BODY · UI LABELS · DESCRIPTIONS
          </text>

          <text y="260" fill={colors.amber} fontFamily="GeistMono" fontWeight="400" fontSize="40">
            Geist Mono
          </text>
          <text y="292" fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="1">
            CODE · IDS · TECHNICAL DATA
          </text>
        </g>

        {/* Type specimen panel */}
        <g transform="translate(960, 56)">
          <rect width="480" height="280" fill={colors.darkest} rx="6" />

          <text x="32" y="40" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" letterSpacing="2">SPECIMEN</text>

          <text x="32" y="100" fill={colors.cream} fontFamily="Jura" fontWeight="300" fontSize="56" letterSpacing="6">
            3847
          </text>
          <text x="32" y="122" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9">DEFAULT PORT</text>

          <text x="32" y="180" fill={colors.amber} fontFamily="GeistMono" fontSize="15">
            task_01h455vb4pex5vsknk08
          </text>
          <text x="32" y="200" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9">TYPEID</text>

          <text x="32" y="252" fill={colors.slateLight} fontFamily="InstrumentSans" fontSize="16">
            DRAFT → READY → WORKING → DONE
          </text>
        </g>
      </g>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* LOGO SECTION */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${margin}, 1620)`}>
        <text fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="3">
          04 — LOGO SYSTEM
        </text>

        {/* Primary mark - dark */}
        <g transform="translate(0, 56)">
          <rect width="380" height="380" fill={colors.darkest} rx="8" />

          <g transform="translate(190, 190)">
            {/* Orbital rings */}
            <circle r="120" fill="none" stroke={colors.charcoal} strokeWidth="0.75" strokeDasharray="3 6" />
            <circle r="80" fill="none" stroke={colors.charcoal} strokeWidth="0.75" />
            <circle r="44" fill="none" stroke={colors.amber} strokeWidth="1.5" />

            {/* Agents */}
            <circle cy="-80" r="10" fill={colors.cream} />
            <circle cx="69" cy="40" r="10" fill={colors.cream} />
            <circle cx="-69" cy="40" r="10" fill={colors.cream} />

            {/* Orchestrator */}
            <circle r="14" fill={colors.amber} />

            {/* Connection lines */}
            <line y2="-66" stroke={colors.amber} strokeWidth="1" strokeOpacity="0.4" />
            <line x2="56" y2="33" stroke={colors.amber} strokeWidth="1" strokeOpacity="0.4" />
            <line x2="-56" y2="33" stroke={colors.amber} strokeWidth="1" strokeOpacity="0.4" />
          </g>

          <text x="190" y="360" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" textAnchor="middle" letterSpacing="1">
            PRIMARY — DARK
          </text>
        </g>

        {/* Secondary mark - light */}
        <g transform="translate(440, 56)">
          <rect width="380" height="380" fill={colors.cream} rx="8" />

          <g transform="translate(190, 190)">
            <circle r="120" fill="none" stroke={colors.warmGray} strokeWidth="0.75" strokeDasharray="3 6" />
            <circle r="80" fill="none" stroke={colors.warmGray} strokeWidth="0.75" />
            <circle r="44" fill="none" stroke={colors.amberMuted} strokeWidth="1.5" />

            <circle cy="-80" r="10" fill={colors.dark} />
            <circle cx="69" cy="40" r="10" fill={colors.dark} />
            <circle cx="-69" cy="40" r="10" fill={colors.dark} />

            <circle r="14" fill={colors.amberMuted} />

            <line y2="-66" stroke={colors.amberMuted} strokeWidth="1" strokeOpacity="0.4" />
            <line x2="56" y2="33" stroke={colors.amberMuted} strokeWidth="1" strokeOpacity="0.4" />
            <line x2="-56" y2="33" stroke={colors.amberMuted} strokeWidth="1" strokeOpacity="0.4" />
          </g>

          <text x="190" y="360" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" textAnchor="middle" letterSpacing="1">
            SECONDARY — LIGHT
          </text>
        </g>

        {/* Wordmark */}
        <g transform="translate(880, 56)">
          <rect width="560" height="160" fill={colors.darkest} rx="8" />

          <g transform="translate(48, 80)">
            {/* Compact logo */}
            <circle r="24" fill="none" stroke={colors.charcoal} strokeWidth="0.75" />
            <circle r="7" fill={colors.amber} />
            <circle cy="-20" r="4" fill={colors.cream} />
            <circle cx="17" cy="10" r="4" fill={colors.cream} />
            <circle cx="-17" cy="10" r="4" fill={colors.cream} />

            <text x="48" y="8" fill={colors.cream} fontFamily="Jura" fontWeight="300" fontSize="52" letterSpacing="8">
              AOP
            </text>
          </g>

          <text x="280" y="145" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" textAnchor="middle" letterSpacing="1">
            WORDMARK
          </text>
        </g>

        {/* Favicon */}
        <g transform="translate(880, 276)">
          <rect width="160" height="160" fill={colors.darkest} rx="8" />

          <g transform="translate(80, 80)">
            <circle r="48" fill="none" stroke={colors.charcoal} strokeWidth="0.75" />
            <circle r="14" fill={colors.amber} />
            <circle cy="-38" r="7" fill={colors.cream} />
            <circle cx="33" cy="19" r="7" fill={colors.cream} />
            <circle cx="-33" cy="19" r="7" fill={colors.cream} />
          </g>

          <text x="80" y="150" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" textAnchor="middle" letterSpacing="1">
            ICON
          </text>
        </g>

        {/* Minimum size */}
        <g transform="translate(1100, 276)">
          <rect width="160" height="160" fill={colors.darkest} rx="8" />

          <g transform="translate(80, 80)">
            <circle r="20" fill="none" stroke={colors.charcoal} strokeWidth="0.5" />
            <circle r="6" fill={colors.amber} />
            <circle cy="-16" r="3" fill={colors.cream} />
            <circle cx="14" cy="8" r="3" fill={colors.cream} />
            <circle cx="-14" cy="8" r="3" fill={colors.cream} />
          </g>

          <text x="80" y="150" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" textAnchor="middle" letterSpacing="1">
            MIN 24px
          </text>
        </g>
      </g>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* VISUAL LANGUAGE SECTION */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${margin}, 2140)`}>
        <text fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="3">
          05 — VISUAL LANGUAGE
        </text>

        {/* Task flow diagram */}
        <g transform="translate(0, 56)">
          <rect width="720" height="400" fill={colors.darkest} rx="8" />

          <g transform="translate(60, 180)">
            {[
              { x: 0, status: "DRAFT", color: colors.charcoal, border: colors.slateDark },
              { x: 160, status: "READY", color: `${colors.amber}20`, border: colors.amber },
              { x: 320, status: "WORKING", color: `${colors.working}20`, border: colors.working },
              { x: 480, status: "DONE", color: `${colors.success}20`, border: colors.success },
            ].map((s, i) => (
              <g key={s.status}>
                <rect x={s.x} y="-32" width="120" height="64" fill={s.color} stroke={s.border} strokeWidth="1" rx="4" />
                <text x={s.x + 60} fill={s.border} fontFamily="GeistMono" fontSize="10" textAnchor="middle">{s.status}</text>

                {i < 3 && (
                  <>
                    <line x1={s.x + 120} y1="0" x2={s.x + 152} y2="0" stroke={s.border} strokeWidth="1" />
                    <polygon points={`${s.x + 152},-4 ${s.x + 160},0 ${s.x + 152},4`} fill={s.border} />
                  </>
                )}
              </g>
            ))}

            {/* Agent indicator */}
            <g transform="translate(380, -100)">
              <circle r="24" fill="url(#agentGlow)" />
              <circle r="8" fill={colors.cream} />
              <text y="44" fill={colors.slateDark} fontFamily="GeistMono" fontSize="8" textAnchor="middle">AGENT</text>
              <line y1="12" y2="58" stroke={colors.slate} strokeWidth="1" strokeDasharray="2 2" />
            </g>

            {/* Blocked branch */}
            <g transform="translate(380, 0)">
              <line y1="32" y2="80" stroke={colors.blocked} strokeWidth="1" strokeDasharray="3 3" />
              <rect x="-60" y="88" width="120" height="40" fill={`${colors.blocked}20`} stroke={colors.blocked} strokeWidth="1" rx="4" />
              <text y="114" fill={colors.blocked} fontFamily="GeistMono" fontSize="10" textAnchor="middle">BLOCKED</text>
            </g>
          </g>

          <text x="360" y="380" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" textAnchor="middle" letterSpacing="1">
            TASK STATE FLOW
          </text>
        </g>

        {/* Spacing system */}
        <g transform="translate(780, 56)">
          <rect width="480" height="400" fill={colors.darkest} rx="8" />

          <g transform="translate(40, 40)">
            {/* Grid visualization */}
            {Array.from({ length: 9 }).map((_, i) => (
              <line key={`v${i}`} x1={i * 48} y1="0" x2={i * 48} y2="288" stroke={colors.charcoal} strokeWidth="0.5" />
            ))}
            {Array.from({ length: 7 }).map((_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 48} x2="384" y2={i * 48} stroke={colors.charcoal} strokeWidth="0.5" />
            ))}

            {/* Example elements */}
            <rect x="48" y="48" width="192" height="96" fill={colors.dark} rx="4" />
            <rect x="48" y="168" width="288" height="48" fill={colors.charcoal} rx="4" />
            <rect x="48" y="240" width="96" height="96" fill={`${colors.amber}30`} rx="4" />
            <rect x="168" y="240" width="96" height="96" fill={`${colors.amber}30`} rx="4" />
            <rect x="288" y="240" width="96" height="96" fill={`${colors.amber}30`} rx="4" />
          </g>

          <text x="56" y="365" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" letterSpacing="1">8px BASE UNIT</text>
          <text x="240" y="380" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" textAnchor="middle" letterSpacing="1">
            SPACING SYSTEM
          </text>
        </g>
      </g>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* DASHBOARD PREVIEW */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${margin}, 2640)`}>
        <text fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="3">
          06 — DASHBOARD PREVIEW
        </text>

        <g transform="translate(0, 56)">
          <rect width="1600" height="540" fill={colors.darkest} rx="8" stroke={colors.charcoal} strokeWidth="1" />

          {/* Header */}
          <rect width="1600" height="56" fill={colors.dark} rx="8" />
          <rect y="48" width="1600" height="8" fill={colors.dark} />

          {/* Logo */}
          <g transform="translate(28, 28)">
            <circle r="12" fill="none" stroke={colors.charcoal} strokeWidth="0.75" />
            <circle r="4" fill={colors.amber} />
            <circle cy="-10" r="2.5" fill={colors.cream} />
            <circle cx="8.5" cy="5" r="2.5" fill={colors.cream} />
            <circle cx="-8.5" cy="5" r="2.5" fill={colors.cream} />

            <text x="24" y="5" fill={colors.cream} fontFamily="Jura" fontWeight="300" fontSize="18" letterSpacing="2">AOP</text>
          </g>

          {/* Capacity */}
          <g transform="translate(1340, 20)">
            <text fill={colors.slateDark} fontFamily="GeistMono" fontSize="9">CAPACITY</text>
            <rect x="72" y="-8" width="120" height="16" fill={colors.charcoal} rx="2" />
            <rect x="72" y="-8" width="80" height="16" fill={colors.amber} rx="2" />
            <text x="204" y="4" fill={colors.slateLight} fontFamily="GeistMono" fontSize="11">2/3</text>
          </g>

          {/* Kanban columns */}
          {[
            { title: "DRAFT", color: colors.slateDark, fill: colors.charcoal, tasks: [{ name: "Setup CI pipeline", repo: "core" }, { name: "Add logging", repo: "api" }] },
            { title: "READY", color: colors.amber, fill: `${colors.amber}15`, tasks: [{ name: "Implement auth flow", repo: "api" }] },
            { title: "WORKING", color: colors.working, fill: `${colors.working}15`, tasks: [{ name: "Database migration", repo: "core", progress: 0.6 }] },
            { title: "DONE", color: colors.success, fill: `${colors.success}15`, tasks: [{ name: "API endpoints", repo: "api" }, { name: "User model", repo: "core" }] },
          ].map((col, i) => (
            <g key={col.title} transform={`translate(${24 + i * 392}, 80)`}>
              <circle cx="8" cy="10" r="5" fill={col.color} />
              <text x="24" y="14" fill={colors.slateLight} fontFamily="GeistMono" fontSize="11" letterSpacing="1">{col.title}</text>
              <text x="120" y="14" fill={colors.slateDark} fontFamily="GeistMono" fontSize="10">{col.tasks.length}</text>

              {col.tasks.map((task, j) => (
                <g key={j} transform={`translate(0, ${40 + j * 92})`}>
                  <rect width="368" height="76" fill={colors.dark} rx="4" stroke={colors.charcoal} strokeWidth="1" />
                  <text x="16" y="28" fill={colors.cream} fontFamily="InstrumentSans" fontSize="14">{task.name}</text>
                  <text x="16" y="50" fill={colors.slateDark} fontFamily="GeistMono" fontSize="10">{task.repo}</text>

                  {task.progress !== undefined && (
                    <g transform="translate(16, 58)">
                      <rect width="240" height="4" fill={colors.charcoal} rx="2" />
                      <rect width={240 * task.progress} height="4" fill={colors.working} rx="2" />
                    </g>
                  )}
                </g>
              ))}
            </g>
          ))}

          {/* Blocked section */}
          <g transform="translate(0, 400)">
            {/* Section background */}
            <rect width="1600" height="120" fill={`${colors.blocked}08`} />
            <line y1="0" x2="1600" y2="0" stroke={colors.blocked} strokeWidth="1" strokeOpacity="0.3" />

            {/* Section header */}
            <g transform="translate(24, 24)">
              <circle r="5" fill={colors.blocked} />
              <text x="16" y="4" fill={colors.blocked} fontFamily="GeistMono" fontSize="11" letterSpacing="1">BLOCKED</text>
              <text x="100" y="4" fill={colors.slateDark} fontFamily="GeistMono" fontSize="10">2</text>
            </g>

            {/* Blocked task cards */}
            {[
              { name: "Fix connection timeout", repo: "db-service", error: "tests failed" },
              { name: "Update auth middleware", repo: "api", error: "build error" },
            ].map((task, i) => (
              <g key={i} transform={`translate(${24 + i * 392}, 48)`}>
                <rect width="368" height="64" fill={colors.dark} rx="4" stroke={colors.blocked} strokeWidth="1" strokeOpacity="0.5" />
                <text x="16" y="24" fill={colors.cream} fontFamily="InstrumentSans" fontSize="14">{task.name}</text>
                <text x="16" y="44" fill={colors.slateDark} fontFamily="GeistMono" fontSize="10">{task.repo}</text>
                <text x="100" y="44" fill={colors.blocked} fontFamily="GeistMono" fontSize="10" fillOpacity="0.8">— {task.error}</text>

                {/* Action buttons */}
                <rect x="260" y="12" width="48" height="20" fill={colors.charcoal} rx="3" />
                <text x="284" y="26" fill={colors.slateLight} fontFamily="GeistMono" fontSize="9" textAnchor="middle">Retry</text>

                <rect x="314" y="12" width="48" height="20" fill="transparent" rx="3" stroke={colors.charcoal} strokeWidth="1" />
                <text x="338" y="26" fill={colors.slateDark} fontFamily="GeistMono" fontSize="9" textAnchor="middle">Remove</text>
              </g>
            ))}
          </g>
        </g>
      </g>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* FOOTER */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${margin}, 3320)`}>
        <line x1="0" y1="0" x2={width - margin * 2} y2="0" stroke={colors.charcoal} strokeWidth="1" />

        <text y="48" fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="3">
          AOP BRAND IDENTITY
        </text>
        <text x={width - margin * 2} y="48" fill={colors.slateDark} fontFamily="GeistMono" fontSize="10" letterSpacing="2" textAnchor="end">
          ORCHESTRAL PRECISION v1.0
        </text>
      </g>
    </svg>
  );
};

// Render and save
async function main() {
  const stream = await renderToReadableStream(<Moodboard />);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const svgContent = Buffer.concat(chunks).toString();

  const svgPath = "/home/eng/Workspace/my-agent/aop/brand/moodboard.svg";
  fs.writeFileSync(svgPath, svgContent);
  console.log(`SVG saved to ${svgPath}`);

  const pdfPath = "/home/eng/Workspace/my-agent/aop/brand/moodboard.pdf";

  try {
    const result = Bun.spawnSync(["rsvg-convert", "-f", "pdf", "-o", pdfPath, svgPath]);
    if (result.exitCode === 0) {
      console.log(`PDF saved to ${pdfPath}`);
    } else {
      console.log("rsvg-convert not available, SVG file saved");
    }
  } catch {
    console.log("PDF conversion skipped, SVG file saved");
  }
}

main();
