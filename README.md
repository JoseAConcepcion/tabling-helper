# TablingHelper

Desktop application for managing and visualizing university academic schedules. Built with [Tauri 2](https://tauri.app) (Rust backend + Vanilla JS frontend).

## Features

- **Data import** from JSON with shift validation
- **Tabular view** of schedules by year/career/group, with per-subject color coding
- **Conflict detection** for scheduling overlaps
- **PDF export** via [Typst](https://typst.app):
  - Full schedules per group
  - Per-week schedules
  - Master room schedule (consolidated and per-week)
  - Parallel compilation for maximum speed

## Requirements

- [Typst](https://github.com/typst/typst/releases) — required for PDF export (`apt install typst` on Linux, or download the binary)
- Node.js and pnpm (for development)

## Development

```bash
pnpm install
pnpm tauri dev
```

## Structure

```
src/              # Frontend (HTML + CSS + vanilla JS)
src-tauri/src/    # Rust backend
  export.rs       # PDF export via Typst
  lib.rs          # Tauri commands and shift logic
data/             # Sample data and reference Python exporter
```
