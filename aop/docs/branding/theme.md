# AOP Theme Reference

A comprehensive design system for the Agents Operating Platform dashboard and related interfaces.

---

## Color Tokens

### Foundation (Backgrounds)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-black` | `#0A0A0B` | Page background |
| `--color-darkest` | `#101012` | Card/panel backgrounds |
| `--color-dark` | `#18181B` | Elevated surfaces, headers |
| `--color-charcoal` | `#27272A` | Borders, dividers, subtle fills |

### Content (Text & Foreground)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-cream` | `#FAFAF9` | Primary text |
| `--color-off-white` | `#F4F4F5` | Secondary text |
| `--color-warm-gray` | `#E4E4E7` | Tertiary text, captions |

### Neutral (UI Elements)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-slate-dark` | `#52525B` | Disabled, labels |
| `--color-slate` | `#71717A` | Muted text, annotations |
| `--color-slate-light` | `#A1A1AA` | Secondary interactive |

### Accent (Brand)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-amber` | `#D97706` | Primary accent, READY state |
| `--color-amber-light` | `#F59E0B` | Hover states |
| `--color-amber-muted` | `#B45309` | Pressed states |

### Status (Semantic)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | `#059669` | DONE, success states |
| `--color-working` | `#2563EB` | WORKING, in-progress |
| `--color-blocked` | `#DC2626` | BLOCKED, errors |

---

## CSS Custom Properties

```css
:root {
  /* Foundation */
  --color-black: #0A0A0B;
  --color-darkest: #101012;
  --color-dark: #18181B;
  --color-charcoal: #27272A;

  /* Content */
  --color-cream: #FAFAF9;
  --color-off-white: #F4F4F5;
  --color-warm-gray: #E4E4E7;

  /* Neutral */
  --color-slate-dark: #52525B;
  --color-slate: #71717A;
  --color-slate-light: #A1A1AA;

  /* Accent */
  --color-amber: #D97706;
  --color-amber-light: #F59E0B;
  --color-amber-muted: #B45309;

  /* Status */
  --color-success: #059669;
  --color-working: #2563EB;
  --color-blocked: #DC2626;

  /* Semantic aliases */
  --color-bg-page: var(--color-black);
  --color-bg-card: var(--color-darkest);
  --color-bg-elevated: var(--color-dark);
  --color-border: var(--color-charcoal);

  --color-text-primary: var(--color-cream);
  --color-text-secondary: var(--color-off-white);
  --color-text-muted: var(--color-slate);

  /* Status backgrounds (10% opacity) */
  --color-status-ready-bg: #D9770620;
  --color-status-working-bg: #2563EB20;
  --color-status-done-bg: #05966920;
  --color-status-blocked-bg: #DC262620;
}
```

---

## Tailwind Configuration

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        // Foundation
        'aop-black': '#0A0A0B',
        'aop-darkest': '#101012',
        'aop-dark': '#18181B',
        'aop-charcoal': '#27272A',

        // Content
        'aop-cream': '#FAFAF9',
        'aop-off-white': '#F4F4F5',
        'aop-warm-gray': '#E4E4E7',

        // Neutral
        'aop-slate': {
          DEFAULT: '#71717A',
          dark: '#52525B',
          light: '#A1A1AA',
        },

        // Accent
        'aop-amber': {
          DEFAULT: '#D97706',
          light: '#F59E0B',
          muted: '#B45309',
        },

        // Status
        'aop-success': '#059669',
        'aop-working': '#2563EB',
        'aop-blocked': '#DC2626',
      },
      fontFamily: {
        display: ['Jura', 'system-ui', 'sans-serif'],
        body: ['Instrument Sans', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
      fontSize: {
        'display-xl': ['200px', { lineHeight: '1', letterSpacing: '0.1em' }],
        'display-lg': ['80px', { lineHeight: '1', letterSpacing: '0.05em' }],
        'display-md': ['56px', { lineHeight: '1.1', letterSpacing: '0.03em' }],
        'display-sm': ['40px', { lineHeight: '1.2', letterSpacing: '0.02em' }],
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      borderRadius: {
        'aop': '4px',
        'aop-lg': '8px',
      },
    },
  },
}
```

---

## Typography

### Font Stack

| Role | Font | Weights | Usage |
|------|------|---------|-------|
| Display | Jura | 300 (Light), 500 (Medium) | Headlines, large numbers, wordmark |
| Body | Instrument Sans | 400, 700 | UI labels, descriptions, body text |
| Mono | Geist Mono | 400, 700 | Code, IDs, technical data, status labels |

### Type Scale

| Name | Size | Line Height | Usage |
|------|------|-------------|-------|
| `display-xl` | 200px | 1 | Hero wordmark |
| `display-lg` | 80px | 1 | Page titles |
| `display-md` | 56px | 1.1 | Large numbers |
| `display-sm` | 40px | 1.2 | Section headers |
| `heading-lg` | 24px | 1.2 | Card titles |
| `heading-md` | 18px | 1.3 | Subsection titles |
| `body-lg` | 16px | 1.5 | Body text |
| `body-md` | 14px | 1.5 | UI labels |
| `body-sm` | 12px | 1.4 | Captions |
| `mono-md` | 14px | 1.4 | Code, IDs |
| `mono-sm` | 11px | 1.3 | Status labels |
| `mono-xs` | 10px | 1.2 | Technical annotations |

---

## Spacing

Based on an 8px grid system.

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight spacing |
| `space-2` | 8px | Default gap |
| `space-3` | 12px | Compact padding |
| `space-4` | 16px | Standard padding |
| `space-5` | 20px | Section gaps |
| `space-6` | 24px | Card padding |
| `space-8` | 32px | Large gaps |
| `space-10` | 40px | Section margins |
| `space-12` | 48px | Column width base |

---

## Components

### Task Card

```
┌─────────────────────────────────┐
│  Task title                     │  ← cream, Instrument Sans 14px
│  repo-name                      │  ← slate-dark, Geist Mono 10px
│  ┌─────────────────────────┐   │
│  │░░░░░░░░░░░░░░░░        │   │  ← progress bar (optional)
│  └─────────────────────────┘   │
└─────────────────────────────────┘
Background: dark (#18181B)
Border: charcoal (#27272A) 1px
Border-radius: 4px
Padding: 16px
```

### Status Badge

```
● READY    ← amber dot + Geist Mono 11px
```

Colors per status:
- DRAFT: charcoal fill, slate-dark stroke
- READY: amber
- WORKING: working (#2563EB)
- DONE: success (#059669)
- BLOCKED: blocked (#DC2626)

### Kanban Column Header

```
● DRAFT  2    ← status dot + Geist Mono 11px + count
```

### Blocked Section

A horizontal row of blocked task cards displayed below the main Kanban columns.

```
┌─────────────────────────────────────────────────────────────────────┐
│ ● BLOCKED  2                                                        │
│ ┌─────────────────────────┐  ┌─────────────────────────┐           │
│ │ Task name        [Retry]│  │ Task name        [Retry]│           │
│ │ repo — error    [Remove]│  │ repo — error    [Remove]│           │
│ └─────────────────────────┘  └─────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

- Section background: blocked at 8% opacity
- Top border: blocked at 30% opacity
- Card border: blocked at 50% opacity, 1px
- Card background: dark (#18181B)
- Error text: blocked color at 80% opacity

---

## Logo Usage

### Minimum Size
- Icon: 24px minimum
- Wordmark: 80px width minimum

### Clear Space
- Maintain 1x the center hub radius as clear space around the logo

### Color Variants
- **Dark background**: Cream agents, amber orchestrator
- **Light background**: Dark agents, amber-muted orchestrator

---

## Motion (Future)

| Property | Duration | Easing |
|----------|----------|--------|
| Quick | 100ms | ease-out |
| Normal | 200ms | ease-out |
| Slow | 300ms | ease-in-out |
| Enter | 200ms | ease-out |
| Exit | 150ms | ease-in |

---

## Files

| File | Description |
|------|-------------|
| `design-philosophy.md` | Orchestral Precision aesthetic manifesto |
| `moodboard.pdf` | Complete visual brand system (print quality) |
| `moodboard.svg` | Editable brand system source |
| `theme.md` | This file - implementation reference |
