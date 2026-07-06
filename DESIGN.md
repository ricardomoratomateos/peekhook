# PeekHook — Design System

Minimal monochrome canvas with a single electric-lime accent. Inspired
by the parent repo's dashboard/sandbox language. Tweak deliberately.

## Color tokens

| token          | value         | role                         |
| -------------- | ------------- | ---------------------------- |
| `--bg`         | `#0a0a0a`     | page background              |
| `--surface`    | `#111111`     | sidebar / panels             |
| `--surface-2`  | `#171717`     | hover / inactive controls    |
| `--surface-3`  | `#1f1f1f`     | selected / active            |
| `--text-strong`| `#fafafa`     | primary text                 |
| `--text-body`  | `#a3a3a3`     | secondary text               |
| `--text-muted` | `#838383`     | muted / labels               |
| `--border`     | `rgba(64,64,64,.16)` | soft separators     |
| `--border-strong`| `rgba(64,64,64,.3)` | panel borders      |
| `--accent`     | `#c8ff00`     | electric-lime accent         |
| `--accent-ink` | `#0a0a0a`     | text on accent               |
| `--green-10`   | `rgba(200,255,0,.10)` | accent at 10% (selected rows) |
| `--status-red` | `#f87171`     | error messages               |

## Typography

- Sans: `Geist`, fallback to system sans
- Mono: `Geist Mono`, fallback to `SFMono-Regular`, monospace

Body copy: 13–14px / line-height 1.5
Labels / eyebrows: 10–11px mono, letter-spacing 0.2em, uppercase
Headlines: clamp(44, 7vw, 76) / line-height 0.98 / letter-spacing -2px

## Spacing

4 / 8 / 12 / 16 / 24 / 32 grid. Stay on multiples.

## Motion

- Pulse: `sbpulse 2s ease infinite` on dot indicators
- Fade-in on new events: `sbfade .3s ease`
- Hover transitions: 120–150 ms

## Status

Sandbox/Inspector screenshots not yet captured. Once shipped →
capture via `/qa` and update this file with annotated examples.
