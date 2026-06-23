/* =========================================================================
   app.js — UI logic (vanilla JS)
   Consumes API/Events from api.js. Never talks to Rust directly.
   ========================================================================= */

import { BLOCKS, DAYS, API, Events } from './api.js';

const COLUMNS = [
  { key: "id", label: "ID", cls: "col-id" },
  { key: "career", label: "Carrera", cls: "" },
  { key: "year", label: "Año", cls: "col-anio" },
  { key: "group", label: "Grupo", cls: "col-grupo" },
  { key: "subject", label: "Asignatura", cls: "" },
  { key: "kind", label: "Tipo", cls: "col-tipo" },
  { key: "day", label: "Día", cls: "" },
  { key: "schedule", label: "Horario", cls: "col-horario" },
  { key: "weeks_str", label: "Semanas", cls: "col-sem" },
  { key: "room", label: "Aula", cls: "" },
];

// Default column widths in px (keyed by COLUMNS.key). Used for the resizable
// <colgroup>; user changes override these and persist in localStorage.
const DEFAULT_WIDTHS = {
  id: 46,
  career: 160,
  year: 48,
  group: 70,
  subject: 170,
  kind: 56,
  day: 96,
  schedule: 210,
  weeks_str: 120,
  room: 96,
};
const COL_WIDTH_KEY = "tabling.colWidths";
const MIN_COL_WIDTH = 40;

function loadColWidths() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(COL_WIDTH_KEY)) || {};
  } catch (_) {}
  return { ...DEFAULT_WIDTHS, ...saved };
}

const state = {
  shifts: [], // Shift[] from the backend
  conflicts: new Set(), // conflicting ids
  config: null,
  tab: "all", // 'all' | 'conflicts'
  filters: {}, // { column: text }
  sort: { key: null, dir: 1 },
  selId: null,
  editId: null,
  nConflicts: 0, // number of conflict messages from last listConflicts
  colWidths: loadColWidths(), // { columnKey: px }
  validationResult: null, // { errors: [...], warnings: [...] } from last validate
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ============================ Startup ============================ */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  // The app always runs against the Tauri backend.
  const tag = $("#mode-tag");
  tag.textContent = "LIVE";
  tag.classList.add("live");

  buildColgroup();
  buildThead();
  buildFilters();
  buildComboboxes();
  buildSteppers();
  populateDays();
  bindMenus();
  bindForm();
  bindActions();
  bindModals();
  bindShortcuts();
  bindSplitter();

  await loadConfig();
  await refresh();
  await doValidateSchedule(true);
  setFormMode("create");

  Events.onExportProgress(updateExportProgress);
  Events.onExportComplete(onExportComplete);
}

/* ============================ Menus ============================ */
function bindMenus() {
  $$("[data-menu]").forEach((menu) => {
    menu.querySelector(".menu-label").addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.classList.contains("open");
      closeMenus();
      if (!open) menu.classList.add("open");
    });
    menu.addEventListener("mouseenter", () => {
      if ($$("[data-menu].open").length) {
        closeMenus();
        menu.classList.add("open");
      }
    });
  });
  document.addEventListener("click", closeMenus);
}
function closeMenus() {
  $$("[data-menu]").forEach((m) => m.classList.remove("open"));
}

/* Action delegation (menus + buttons share data-action) */
function bindActions() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.classList.contains("disabled") || el.disabled) return;
    closeMenus();
    const fn = actions[el.dataset.action];
    if (fn) fn();
  });
}

const actions = {
  // File
  load_file: doLoadFile,
  save_file: doSaveFile,
  import_csv: doImportCsv,
  export_pdf: doExportPdf,
  clear_all: doClearAll,
  // Shift
  add_shift: doAddOrUpdate,
  edit_sel: doEdit,
  delete_sel: doDelete,
  new_shift: clearForm,
  clear_form: clearForm,
  focus_form: () => $("#f-carrera").focus(),
  // Tools
  validate_schedule: doValidateSchedule,
  open_config: openConfig,
  clear_filters: clearFilters,
  start_export: startExport,
  // Insult
  insult: doInsult,
  // Help
  help_format: () =>
    showInfo(
      "Formato de grupos y semanas",
      `<p><strong>Grupos:</strong> número de 2 o 3 dígitos. Formato <code>[prefijo][año][subgrupo]</code>.</p>
     <ul><li>2 dígitos → año completo (ej. <code>21</code> = carrera prefijo 2, año 1).</li>
     <li>3 dígitos → subgrupo (ej. <code>211</code>, <code>212</code>).</li></ul>
     <p><strong>Semanas:</strong> rangos y valores separados por coma, ej. <code>5-8,10</code>. Rango válido 1–16.</p>`,
    ),
  about: () =>
    showInfo(
      "Acerca de",
      `<p><strong>Gestor de Horarios — Facultad</strong></p><p>Frontend Tauri + vanilla JS. El estado y la validación viven en el backend Rust.</p>`,
    ),
};

/* ============================ Table: header ============================ */
// Builds the <colgroup> that drives column widths (table-layout: fixed).
function buildColgroup() {
  const cg = $("#colgroup");
  cg.innerHTML = "";
  COLUMNS.forEach((c) => {
    const col = document.createElement("col");
    col.dataset.key = c.key;
    col.style.width = `${state.colWidths[c.key]}px`;
    cg.appendChild(col);
  });
}

function setColWidth(key, px) {
  const w = Math.max(MIN_COL_WIDTH, Math.round(px));
  state.colWidths[key] = w;
  const col = $(`#colgroup col[data-key="${key}"]`);
  if (col) col.style.width = `${w}px`;
}

function persistColWidths() {
  try {
    localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(state.colWidths));
  } catch (_) {}
}

// Starts a drag-resize for the column owned by `th`.
function startColResize(th, startX) {
  const key = th.dataset.key;
  const startW = state.colWidths[key];
  const handle = th.querySelector(".col-resizer");
  handle?.classList.add("dragging");
  document.body.classList.add("col-resizing");

  const onMove = (e) => setColWidth(key, startW + (e.clientX - startX));
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    handle?.classList.remove("dragging");
    document.body.classList.remove("col-resizing");
    persistColWidths();
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function buildThead() {
  const row = $("#thead-row");
  row.innerHTML = "";
  COLUMNS.forEach((c) => {
    const th = document.createElement("th");
    th.className = c.cls;
    th.dataset.key = c.key;
    th.innerHTML = c.label + ' <span class="sort-ind" data-ind></span>';
    th.addEventListener("click", () => sortBy(c.key));

    // Resize handle: starts a drag and never triggers the sort click.
    const resizer = document.createElement("span");
    resizer.className = "col-resizer";
    resizer.addEventListener("click", (e) => e.stopPropagation());
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startColResize(th, e.clientX);
    });
    th.appendChild(resizer);

    row.appendChild(th);
  });
}

function sortBy(key) {
  if (state.sort.key === key) state.sort.dir *= -1;
  else {
    state.sort.key = key;
    state.sort.dir = 1;
  }
  renderTable();
}

/* ============================ Table: filters ============================ */
function buildFilters() {
  const grid = $("#filters-grid");
  grid.style.gridTemplateColumns = `repeat(${COLUMNS.length}, 1fr)`;
  grid.innerHTML = "";
  COLUMNS.forEach((c) => {
    const wrap = document.createElement("div");
    wrap.className = "fcol";
    wrap.innerHTML = `<span>${c.label}</span><input type="text" data-fcol="${c.key}" />`;
    grid.appendChild(wrap);
  });
  grid.addEventListener("input", (e) => {
    const k = e.target.dataset.fcol;
    if (!k) return;
    const v = e.target.value.trim().toLowerCase();
    if (v) state.filters[k] = v;
    else delete state.filters[k];
    renderTable();
  });
}
function clearFilters() {
  state.filters = {};
  $$("[data-fcol]").forEach((i) => (i.value = ""));
  renderTable();
}

/* ============================ Data ============================ */
async function loadConfig() {
  try {
    state.config = await API.getConfig();
    populateDatalists();
    renderConfig();
  } catch (e) {
    toast("No se pudo cargar la configuración", "err");
  }
}

// The backend stores canonical data (weeks as a Vec, block, duration_min,
// start_time) and does NOT pre-compute presentation fields. The UI, however,
// needs `weeks_str` (string) and `schedule` (human label) on every shift, so we
// derive them here on the front. Mirrors the former Mock.view logic.
function weeksToString(list) {
  if (!list || !list.length) return "";
  const r = [];
  let start = list[0],
    end = list[0];
  for (const s of list.slice(1)) {
    if (s === end + 1) end = s;
    else {
      r.push(start === end ? `${start}` : `${start}-${end}`);
      start = end = s;
    }
  }
  r.push(start === end ? `${start}` : `${start}-${end}`);
  return r.join(",");
}

// Recover the block number from its start time (fallback when the backend did
// not store `block`).
function blockFromStart(startTime) {
  for (const [n, b] of Object.entries(BLOCKS))
    if (b.start === startTime) return +n;
  return null;
}

// "HH:MM" + minutes -> "HH:MM".
function addMinutes(hhmm, mins) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const total = h * 60 + m + (mins || 0);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Ordinal label for a "turno" (block): "1er turno", "2do turno"…
const TURNO_ORDINALS = ["", "1er", "2do", "3er", "4to", "5to", "6to"];
function ordinalTurno(n) {
  return TURNO_ORDINALS[n] ? `${TURNO_ORDINALS[n]} turno` : `turno ${n}`;
}

// Real minutes for `h` class-hours: each class-hour is 45 min and consecutive
// ones are separated by a 5-min break -> durMin = h*45 + (h-1)*5.
function durationFromClassHours(h) {
  const n = Math.max(1, h | 0);
  return n * 45 + (n - 1) * 5;
}

// Class-hours ("horas clase") from a duration in minutes. Inverse of the
// formula above: h = round((durMin + 5) / 50).
function classHours(durMin) {
  return Math.max(1, Math.round((durMin + 5) / 50));
}

// The single source of truth for the "Horario" label, shared by the table
// (decorateShift) and the form's live indicator (syncSchedule).
//   Standard:      08:30–10:05 · 2h clase · 1er turno
//   Personalizado: 14:15–15:45 · 2h clase
function formatScheduleLabel(scheduleType, block, startTime, durationMin) {
  if (scheduleType === "estandar" && BLOCKS[block]) {
    const b = BLOCKS[block];
    // Derive from the block span (canonical), sidestepping the backend's
    // mis-stored duration_min for standard shifts.
    return `${b.start}–${b.end} · ${classHours(b.dur)}h clase · ${ordinalTurno(block)}`;
  }
  if (!/^\d{1,2}:\d{2}$/.test(String(startTime || "")))
    return `${classHours(durationMin)}h clase`;
  const end = addMinutes(startTime, durationMin);
  return `${startTime}–${end} · ${classHours(durationMin)}h clase`;
}

function decorateShift(t) {
  const weeks = Array.isArray(t.weeks) ? t.weeks : [];
  const weeks_str = t.weeks_str ?? weeksToString(weeks);
  let block = t.block;
  if (block == null && t.schedule_type === "estandar")
    block = blockFromStart(t.start_time);
  const schedule = formatScheduleLabel(
    t.schedule_type,
    block,
    t.start_time,
    t.duration_min,
  );
  return { ...t, block, weeks, weeks_str, schedule };
}

async function refresh() {
  try {
    state.shifts = (await API.listShifts()).map(decorateShift);
    const conflictList = await API.listConflicts();
    state.conflicts = new Set(conflictList.flatMap((c) => c.ids));
    state.nConflicts = conflictList.length;
  } catch (e) {
    toast("Error al listar turnos: " + e.message, "err");
    return;
  }
  renderTable();
  updateBadges();
  updateStatus();
}

/* ============================ Table: render ============================ */
function filterAndSort() {
  let rows =
    state.tab === "conflicts"
      ? state.shifts.filter((t) => state.conflicts.has(t.id))
      : state.shifts.slice();

  for (const [k, v] of Object.entries(state.filters))
    rows = rows.filter((t) =>
      String(t[k] ?? "")
        .toLowerCase()
        .includes(v),
    );

  if (state.sort.key) {
    const k = state.sort.key,
      d = state.sort.dir;
    rows.sort((a, b) => {
      let x = a[k],
        y = b[k];
      if (k === "id" || k === "year") {
        x = +x;
        y = +y;
        return (x - y) * d;
      }
      if (k === "day") {
        // Order by weekday, not alphabetically (unknown days go last).
        const ix = DAYS.indexOf(x),
          iy = DAYS.indexOf(y);
        return ((ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)) * d;
      }
      return String(x).localeCompare(String(y), "es", { numeric: true }) * d;
    });
  }
  return rows;
}

function renderTable() {
  const rows = filterAndSort();
  const tbody = $("#tbody");
  tbody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="${COLUMNS.length}" class="empty-state">${
      state.tab === "conflicts"
        ? "No hay conflictos. ✔"
        : "No hay turnos. Agrega uno con el formulario de arriba."
    }</td>`;
    tbody.appendChild(tr);
  } else {
    for (const t of rows) {
      const tr = document.createElement("tr");
      tr.dataset.id = t.id;
      if (state.conflicts.has(t.id)) tr.classList.add("conflict");
      if (t.id === state.selId) tr.classList.add("selected");
      tr.innerHTML = COLUMNS.map(
        (c) => `<td class="${c.cls}">${escapeHtml(t[c.key])}</td>`,
      ).join("");
      tr.addEventListener("click", () => select(t.id));
      tr.addEventListener("dblclick", () => {
        select(t.id);
        doEdit();
      });
      tbody.appendChild(tr);
    }
  }

  // sort indicators
  $$("[data-ind]").forEach((s) => (s.textContent = ""));
  if (state.sort.key) {
    const th = $(`th[data-key="${state.sort.key}"] [data-ind]`);
    if (th) th.textContent = state.sort.dir > 0 ? "▲" : "▼";
  }
  const nf = Object.keys(state.filters).length;
  $("#filtros-count").textContent = nf
    ? `${nf} filtro(s) · ${rows.length} fila(s)`
    : "";
}

function updateBadges() {
  const n = state.nConflicts;
  const b = $("#badge-conf");
  b.textContent = n;
  b.classList.toggle("zero", n === 0);
}

/* ============================ Selection ============================ */
function select(id) {
  state.selId = id;
  $$("#tbody tr").forEach((tr) =>
    tr.classList.toggle("selected", +tr.dataset.id === id),
  );
  const sel = !!id;
  $$("[data-needs-sel]").forEach((el) => el.classList.toggle("disabled", !sel));
  const t = id != null ? state.shifts.find((x) => x.id === id) : null;
  $("#sb-sel").textContent = t
    ? `Sel: #${t.id} ${t.subject} (${t.group})`
    : "Sin selección";
  if (t) {
    // Selecting a row dumps the shift into the form in read-only mode (T3).
    loadIntoForm(t);
    setFormMode("view", t);
  } else {
    // No selection: back to an empty, editable "create" form.
    resetFormFields();
    setFormMode("create");
  }
  renderErrorsPanel();
}

/* ============================ Tabs ============================ */
$$(".tab[data-tab]").forEach((tab) =>
  tab.addEventListener("click", () => {
    state.tab = tab.dataset.tab;
    $$(".tab[data-tab]").forEach((t) =>
      t.classList.toggle("active", t === tab),
    );
    renderTable();
    renderErrorsPanel();
  }),
);

/* ============================ Combobox (reusable) ============================ */
// A text input that autocompletes against a fixed list and ONLY accepts values
// present in that list. Used for the config-backed fields (career, subject,
// kind, day, room) so no arbitrary string can reach the backend.
class Combobox {
  constructor(mount, inputId, { placeholder = "", onSelect = null, onUpdate = null } = {}) {
    this.values = [];
    this.committed = ""; // last valid value (always one of `values`, or "")
    this.onSelect = onSelect; // fired only when a value is committed
    this.onUpdate = onUpdate; // fired on any change (for live validation)
    this.activeIdx = -1;
    mount.classList.add("combobox");
    mount.innerHTML = `
      <input id="${inputId}" class="combo-input" type="text" autocomplete="off"
             placeholder="${escapeHtml(placeholder)}" />
      <div class="combo-list" hidden></div>`;
    this.input = mount.querySelector(".combo-input");
    this.list = mount.querySelector(".combo-list");
    this._bind();
  }

  setValues(values) {
    this.values = values.slice();
    if (this.committed && !this.values.includes(this.committed)) {
      this.committed = "";
      this.input.value = "";
    }
  }

  _bind() {
    this.input.addEventListener("input", () => {
      this.committed = ""; // typing invalidates until re-committed
      this.input.classList.remove("invalid");
      this._open(this.input.value);
      if (this.onUpdate) this.onUpdate();
    });
    this.input.addEventListener("focus", () => {
      if (!this.input.disabled) this._open(this.input.value);
    });
    this.input.addEventListener("keydown", (e) => this._onKey(e));
    this.input.addEventListener("blur", () => setTimeout(() => this._commitOnBlur(), 120));
    this.list.addEventListener("mousedown", (e) => {
      const item = e.target.closest(".combo-item");
      if (!item) return;
      e.preventDefault(); // beat the input blur
      this._commit(item.dataset.value);
      this._close();
    });
  }

  _matches(q) {
    const needle = q.trim().toLowerCase();
    return needle
      ? this.values.filter((v) => v.toLowerCase().includes(needle))
      : this.values.slice();
  }

  _open(q) {
    const matches = this._matches(q);
    this.activeIdx = -1;
    this.list.innerHTML = matches.length
      ? matches
          .map((v) => `<div class="combo-item" data-value="${escapeHtml(v)}">${escapeHtml(v)}</div>`)
          .join("")
      : `<div class="combo-empty">Sin coincidencias</div>`;
    this.list.hidden = false;
  }

  _close() {
    this.list.hidden = true;
    this.activeIdx = -1;
  }

  _onKey(e) {
    if (this.list.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      this._open(this.input.value);
      return;
    }
    const items = [...this.list.querySelectorAll(".combo-item")];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.activeIdx = Math.min(this.activeIdx + 1, items.length - 1);
      this._highlight(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIdx = Math.max(this.activeIdx - 1, 0);
      this._highlight(items);
    } else if (e.key === "Enter") {
      if (!this.list.hidden && this.activeIdx >= 0) {
        e.preventDefault();
        this._commit(items[this.activeIdx].dataset.value);
        this._close();
      }
    } else if (e.key === "Escape") {
      this._close();
    }
  }

  _highlight(items) {
    items.forEach((it, i) => it.classList.toggle("active", i === this.activeIdx));
    if (this.activeIdx >= 0) items[this.activeIdx].scrollIntoView({ block: "nearest" });
  }

  _commit(value) {
    this.committed = value;
    this.input.value = value;
    this.input.classList.remove("invalid");
    if (this.onSelect) this.onSelect(value);
    if (this.onUpdate) this.onUpdate();
  }

  // On blur: snap to an exact (case-insensitive) match, else mark invalid.
  _commitOnBlur() {
    this._close();
    const text = this.input.value.trim();
    if (!text) {
      this.committed = "";
      this.input.classList.remove("invalid");
      if (this.onUpdate) this.onUpdate();
      return;
    }
    const exact = this.values.find((v) => v.toLowerCase() === text.toLowerCase());
    if (exact) {
      this._commit(exact);
    } else {
      this.committed = "";
      this.input.classList.add("invalid");
      if (this.onUpdate) this.onUpdate();
    }
  }

  /* ---- public API ---- */
  getValue() {
    return this.committed;
  }
  setValue(v) {
    const val = v ?? "";
    this.input.value = val;
    this.committed = this.values.includes(val) ? val : "";
    this.input.classList.remove("invalid");
    if (this.onUpdate) this.onUpdate();
  }
  setEnabled(on) {
    this.input.disabled = !on;
    if (!on) this._close();
  }
  isValid() {
    return this.committed !== "" && this.values.includes(this.committed);
  }
  focus() {
    this.input.focus();
  }
}

// Registry of the form's comboboxes, built once at startup.
const combos = {};
function buildComboboxes() {
  combos.career = new Combobox($('[data-combo="career"]'), "f-carrera", {
    placeholder: "Carrera…",
    onSelect: syncGroups,
    onUpdate: refreshSubmitEnabled,
  });
  combos.group = new Combobox($('[data-combo="group"]'), "f-grupo", {
    placeholder: "Grupo…",
    onUpdate: refreshSubmitEnabled,
  });
  combos.subject = new Combobox($('[data-combo="subject"]'), "f-asignatura", {
    placeholder: "Asignatura…",
    onUpdate: refreshSubmitEnabled,
  });
  combos.kind = new Combobox($('[data-combo="kind"]'), "f-tipo", {
    placeholder: "Tipo…",
    onUpdate: refreshSubmitEnabled,
  });
  combos.day = new Combobox($('[data-combo="day"]'), "f-dia", {
    placeholder: "Día…",
    onUpdate: refreshSubmitEnabled,
  });
  combos.room = new Combobox($('[data-combo="room"]'), "f-aula", {
    placeholder: "Aula…",
    onUpdate: refreshSubmitEnabled,
  });
}

/* ============================ Stepper (reusable) ============================ */
// A spinner-style field (like the number input for "Horas clase") that steps
// through a fixed list of options. Keeps non-numeric data (e.g. the schedule
// type) while looking like the class-hours widget.
class Stepper {
  // options: array of { value, label }.
  constructor(mount, options, { onChange = null, loop = true } = {}) {
    this.options = options;
    this.idx = 0;
    this.onChange = onChange;
    this.loop = loop;
    this.enabled = true;
    mount.classList.add("stepper");
    mount.tabIndex = 0; // focusable so it joins the Tab order
    mount.innerHTML = `
      <span class="stepper-value"></span>
      <span class="stepper-arrows">
        <button type="button" class="stepper-up" tabindex="-1">▲</button>
        <button type="button" class="stepper-down" tabindex="-1">▼</button>
      </span>`;
    this.mount = mount;
    this.valueEl = mount.querySelector(".stepper-value");
    mount
      .querySelector(".stepper-up")
      .addEventListener("click", () => this.step(+1));
    mount
      .querySelector(".stepper-down")
      .addEventListener("click", () => this.step(-1));
    mount.addEventListener("wheel", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.step(e.deltaY < 0 ? +1 : -1);
    });
    // Arrow keys cycle the value, like a native number input.
    mount.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        e.preventDefault();
        this.step(+1);
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        e.preventDefault();
        this.step(-1);
      }
    });
    this._render();
  }

  step(dir) {
    if (!this.enabled) return;
    let i = this.idx + dir;
    if (this.loop) i = (i + this.options.length) % this.options.length;
    else i = Math.max(0, Math.min(this.options.length - 1, i));
    if (i === this.idx) return;
    this.idx = i;
    this._render();
    if (this.onChange) this.onChange(this.getValue());
  }

  _render() {
    this.valueEl.textContent = this.options[this.idx].label;
  }

  getValue() {
    return this.options[this.idx].value;
  }
  setValue(v) {
    const i = this.options.findIndex((o) => String(o.value) === String(v));
    if (i >= 0) {
      this.idx = i;
      this._render();
    }
  }
  setEnabled(on) {
    this.enabled = on;
    this.mount.classList.toggle("disabled", !on);
    this.mount.tabIndex = on ? 0 : -1; // out of Tab order when read-only
    this.mount.querySelectorAll("button").forEach((b) => (b.disabled = !on));
  }
}

// Fired whenever a schedule-related field changes (block, type, class-hours).
function onScheduleFieldChange() {
  syncSchedule();
  refreshSubmitEnabled();
}

// Registry of the form's steppers, built once at startup.
const steppers = {};
function buildSteppers() {
  steppers.htipo = new Stepper(
    $('[data-stepper="htipo"]'),
    [
      { value: "estandar", label: "Estándar" },
      { value: "personalizado", label: "Personalizado" },
    ],
    { onChange: onScheduleFieldChange },
  );
}

/* ============================ Form mode ============================ */
// The form has three modes:
//   "create" → empty & editable, primary button "Agregar turno".
//   "view"   → a selected shift is shown read-only (T3); Editar/Eliminar/Nuevo.
//   "edit"   → the selected shift is editable, primary button "Actualizar".
let formEnabled = true;

// Plain (non-combobox) fields toggled together with the comboboxes.
const PLAIN_FIELDS = ["f-anio", "f-bloque", "f-semanas"];

function setFormEnabled(on) {
  formEnabled = on;
  for (const c of Object.values(combos)) c.setEnabled(on);
  for (const s of Object.values(steppers)) s.setEnabled(on);
  for (const id of PLAIN_FIELDS) $("#" + id).disabled = !on;
  syncSchedule(); // re-applies f-hora / f-dur availability honoring formEnabled
}

function setFormMode(mode, t) {
  setFormEnabled(mode !== "view");

  const add = $("#btn-agregar");
  const edit = $("#btn-editar");
  const del = $("#btn-eliminar");
  const nuevo = $("#btn-nuevo");
  const label = $("#form-mode-label");

  if (mode === "create") {
    state.editId = null;
    add.hidden = false;
    add.textContent = "Agregar turno";
    edit.hidden = true;
    del.hidden = true;
    nuevo.hidden = true;
    label.textContent = "";
    refreshSubmitEnabled();
  } else if (mode === "view") {
    state.editId = null;
    add.hidden = true;
    edit.hidden = false;
    del.hidden = false;
    nuevo.hidden = false;
    label.textContent = `Turno #${t.id} · solo lectura`;
    clearFieldHints();
  } else if (mode === "edit") {
    state.editId = t.id;
    add.hidden = false;
    add.textContent = "Actualizar turno";
    edit.hidden = true;
    del.hidden = false;
    nuevo.hidden = false;
    label.textContent = `Editando turno #${t.id}`;
    refreshSubmitEnabled();
  }
}

// True if `s` is a valid 24-hour time "H:MM"/"HH:MM" (00:00–23:59).
function isValidTime24(s) {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s).trim());
}

// Yellow "pending" hint on a field that still needs to be filled.
function setNeedsFill(el, needs) {
  if (el) el.classList.toggle("needs-fill", needs && formEnabled);
}

// Removes every pending-field hint (used when the form turns read-only).
function clearFieldHints() {
  $$(".needs-fill").forEach((el) => el.classList.remove("needs-fill"));
}

// Enables the primary button only when every required field is filled/valid,
// and paints the still-missing fields yellow. Front-end gate (T2); the backend
// still validates as last line.
function refreshSubmitEnabled() {
  if (!formEnabled) return; // read-only: primary button is hidden anyway

  const ok = {
    career: combos.career.isValid(),
    group: combos.group.isValid(),
    subject: combos.subject.isValid(),
    kind: combos.kind.isValid(),
    day: combos.day.isValid(),
    room: combos.room.isValid(),
    year: !!$("#f-anio").value.trim(),
    weeks: validateWeeks($("#f-semanas").value).length === 0,
  };
  // Start time only matters (and is editable) in custom mode.
  const customTime = scheduleType() === "personalizado";
  ok.hora = !customTime || isValidTime24($("#f-hora").value);

  // Paint the missing/invalid fields yellow.
  setNeedsFill(combos.career.input, !ok.career);
  setNeedsFill(combos.group.input, !ok.group);
  setNeedsFill(combos.subject.input, !ok.subject);
  setNeedsFill(combos.kind.input, !ok.kind);
  setNeedsFill(combos.day.input, !ok.day);
  setNeedsFill(combos.room.input, !ok.room);
  setNeedsFill($("#f-anio"), !ok.year);
  setNeedsFill($("#f-semanas"), !ok.weeks);
  setNeedsFill($("#f-hora"), customTime && !ok.hora);

  $("#btn-agregar").disabled = !Object.values(ok).every(Boolean);
}

/* ============================ Form ============================ */
function populateDays() {
  combos.day.setValues(DAYS);
}
function populateDatalists() {
  const c = state.config;
  combos.career.setValues(c.careers.map((x) => x.name));
  combos.subject.setValues(c.subjects.map((x) => x.name));
  combos.kind.setValues(c.types.map((x) => x.name));
  combos.room.setValues(c.rooms);
}

function bindForm() {
  // Schedule type changes are handled by the stepper's onChange. Turno and
  // class-hours are native number inputs and need a live refresh.
  $("#f-bloque").addEventListener("input", onScheduleFieldChange);
  $("#f-dur").addEventListener("input", onScheduleFieldChange);
  // group depends on career (combo onSelect -> syncGroups) + year
  $("#f-anio").addEventListener("input", () => {
    syncGroups();
    refreshSubmitEnabled();
  });
  // Weeks: live enable/disable while typing, full validation (toast) on blur.
  $("#f-semanas").addEventListener("input", refreshSubmitEnabled);
  $("#f-semanas").addEventListener("blur", validateWeeksField);
  // Start time (custom mode): live update of the indicator + 24h validation.
  $("#f-hora").addEventListener("input", () => {
    syncSchedule();
    refreshSubmitEnabled();
  });
  $("#f-hora").addEventListener("blur", () => {
    const v = $("#f-hora").value.trim();
    const bad = v && !isValidTime24(v);
    $("#f-hora").classList.toggle("invalid", bad);
    if (bad) toast("Hora inválida. Usa formato 24h HH:MM (00:00–23:59).", "err");
  });
  syncSchedule();
}

function scheduleType() {
  return steppers.htipo.getValue();
}

function syncSchedule() {
  const std = scheduleType() === "estandar";
  // Guard against an invalid/empty block value so we never read `undefined`.
  let n = +$("#f-bloque").value;
  if (!BLOCKS[n]) {
    n = 1;
    $("#f-bloque").value = "1";
  }
  const b = BLOCKS[n];

  // Field availability also honors the read-only form mode (view).
  $("#f-bloque").disabled = !formEnabled;
  $("#f-hora").disabled = !formEnabled || std;
  $("#f-dur").disabled = !formEnabled || std;

  // Standard mode: start time and class-hours come from the block (a 95-min
  // block is 2 class-hours). Don't clobber a custom time when editing/viewing.
  if (std) {
    $("#f-hora").value = b.start;
    $("#f-dur").value = classHours(b.dur);
  }

  // Live indicator: same label shown in the table's "Horario" column.
  let durationMin = b.dur;
  if (!std) durationMin = durationFromClassHours(+$("#f-dur").value || 1);
  $("#bloque-info").textContent = formatScheduleLabel(
    std ? "estandar" : "personalizado",
    n,
    std ? b.start : $("#f-hora").value,
    durationMin,
  );
  $("#bloque-info").style.display = "";
  $("#dur-fija").textContent = "";
}

async function syncGroups() {
  const career = combos.career.getValue();
  const year = $("#f-anio").value.trim();
  const prev = combos.group.getValue();
  if (!career || !year) {
    combos.group.setValues([]);
    combos.group.setValue("");
    refreshSubmitEnabled();
    return;
  }
  let options = [];
  try {
    options = await API.groupOptions(career, year);
  } catch (_) {}
  combos.group.setValues(options);
  // Keep the previous value only if it still belongs to the new option set.
  combos.group.setValue(options.includes(prev) ? prev : "");
  refreshSubmitEnabled();
}

/* ---- Weeks field validation ---- */
const WEEK_MIN = 1;
const WEEK_MAX = 16;

// Wraps the offending token in a yellow highlight (HTML, escaped).
function hlToken(tok) {
  return `<span class="bad-token">${escapeHtml(tok)}</span>`;
}

// Validates the "weeks" string. Returns an array of HTML problem messages
// (empty array = valid). Canonical valid form: strictly ascending,
// non-overlapping tokens separated by commas, each a number or a `a-b` range,
// all within WEEK_MIN..WEEK_MAX. Spaces around commas and dashes are tolerated.
function validateWeeks(raw) {
  const errors = [];
  const text = (raw ?? "").trim();
  if (!text) return ["El campo de semanas está vacío."];

  let prevEnd = 0; // highest week consumed so far (enforces ascending + no overlap)
  for (const rawTok of text.split(",")) {
    const tok = rawTok.trim();
    if (!tok) {
      errors.push(
        "Hay una coma vacía o sobrante (revisa comas dobles o al inicio/final).",
      );
      continue;
    }

    let start, end;
    if (tok.includes("-")) {
      const parts = tok.split("-").map((p) => p.trim());
      if (
        parts.length !== 2 ||
        !/^\d+$/.test(parts[0]) ||
        !/^\d+$/.test(parts[1])
      ) {
        errors.push(
          `Rango mal formado: ${hlToken(tok)}. Usa solo números, comas y guiones (para rangos).`,
        );
        continue;
      }
      start = +parts[0];
      end = +parts[1];
      if (start > end) {
        errors.push(
          `Rango invertido: ${hlToken(tok)} (el inicio es mayor que el fin).`,
        );
        continue;
      }
      if (start === end) {
        errors.push(`Rango redundante: ${hlToken(tok)} (usa solo ${start}).`);
        continue;
      }
    } else {
      if (!/^\d+$/.test(tok)) {
        errors.push(
          `Valor inválido: ${hlToken(tok)}. Usa solo números, comas y guiones (para rangos).`,
        );
        continue;
      }
      start = end = +tok;
    }

    if (start < WEEK_MIN || end > WEEK_MAX) {
      errors.push(
        `Semana fuera de rango (${WEEK_MIN}–${WEEK_MAX}): ${hlToken(tok)}.`,
      );
      continue;
    }
    if (start <= prevEnd) {
      errors.push(
        `Fuera de orden o solapado: ${hlToken(tok)} debería ir antes (la semana ${prevEnd} ya fue usada).`,
      );
      continue;
    }
    prevEnd = end;
  }

  return [...new Set(errors)]; // de-duplicate identical messages
}

// Validates the weeks field on blur: lists every problem in a prominent toast
// and disables "Guardar turno" while the value is invalid.
function validateWeeksField() {
  const input = $("#f-semanas");
  const problems = validateWeeks(input.value);
  const ok = problems.length === 0;
  input.classList.toggle("invalid", !ok);
  refreshSubmitEnabled();
  if (!ok) {
    toast(
      "Problema en las semanas:\n• " + problems.join("\n• "),
      "err big",
      7000,
      true, // messages contain HTML (highlighted tokens)
    );
  }
  return ok;
}

function readForm() {
  return {
    career: $("#f-carrera").value.trim(),
    year: $("#f-anio").value,
    group: combos.group.getValue(),
    subject: $("#f-asignatura").value.trim(),
    kind: $("#f-tipo").value.trim(),
    day: $("#f-dia").value,
    schedule_type: scheduleType(),
    block: $("#f-bloque").value,
    start_time: $("#f-hora").value.trim(),
    duration_hours: $("#f-dur").value,
    weeks_str: $("#f-semanas").value.trim(),
    room: $("#f-aula").value.trim(),
  };
}

function loadIntoForm(t) {
  combos.career.setValue(t.career);
  $("#f-anio").value = t.year;
  combos.subject.setValue(t.subject);
  combos.kind.setValue(t.kind);
  combos.day.setValue(t.day);
  combos.room.setValue(t.room);
  steppers.htipo.setValue(t.schedule_type);
  if (t.schedule_type === "estandar") {
    $("#f-bloque").value = t.block;
    $("#f-dur").value = "1";
  } else {
    $("#f-bloque").value = "1";
    $("#f-dur").value = String(Math.floor((t.duration_min + 5) / 50));
  }
  $("#f-semanas").value = t.weeks_str;
  syncSchedule();
  if (t.schedule_type === "personalizado") $("#f-hora").value = t.start_time;
  // Group options depend on career+year: regenerate them first, then restore
  // the saved value once they exist (fixes the lost-group bug, T5).
  syncGroups().then(() => {
    combos.group.setValue(t.group);
    refreshSubmitEnabled();
  });
}

// Resets every form field to its default, without touching the form mode.
function resetFormFields() {
  combos.career.setValue("");
  $("#f-anio").value = "1";
  combos.group.setValues([]);
  combos.group.setValue("");
  combos.subject.setValue("");
  combos.kind.setValue(
    combos.kind.values.includes("C") ? "C" : combos.kind.values[0] || "",
  );
  combos.day.setValue(DAYS[0]);
  combos.room.setValue("");
  steppers.htipo.setValue("estandar");
  $("#f-bloque").value = "1";
  $("#f-hora").value = "";
  $("#f-dur").value = "1";
  $("#f-semanas").value = "";
  $("#f-semanas").classList.remove("invalid");
  syncSchedule();
}

// "Nuevo turno" / clear: drop any selection and return to an empty create form.
function clearForm() {
  state.selId = null;
  $$("#tbody tr").forEach((tr) => tr.classList.remove("selected"));
  $$("[data-needs-sel]").forEach((el) => el.classList.add("disabled"));
  $("#sb-sel").textContent = "Sin selección";
  resetFormFields();
  setFormMode("create");
}

/* ============================ Shift actions ============================ */
async function doAddOrUpdate() {
  const data = readForm();
  try {
    if (state.editId != null) {
      await API.updateShift(state.editId, data);
      toast("Turno actualizado", "ok");
    } else {
      await API.addShift(data);
      toast("Turno agregado", "ok");
    }
    clearForm();
    await refresh();
    await doValidateSchedule(true);
  } catch (e) {
    toast(e.message, "err");
  }
}

function doEdit() {
  if (state.selId == null) return;
  const t = state.shifts.find((x) => x.id === state.selId);
  if (!t) return;
  // The shift is already loaded (view mode); just make the form editable (T4).
  loadIntoForm(t);
  setFormMode("edit", t);
  $("#f-carrera").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function doDelete() {
  if (state.selId == null) return;
  if (!confirm("¿Eliminar este turno?")) return;
  const before = filterAndSort();
  const idx = before.findIndex((t) => t.id === state.selId);
  try {
    await API.deleteShift(state.selId);
    await refresh();
    const after = filterAndSort();
    if (after.length > 0) {
      const next = after[Math.min(idx, after.length - 1)];
      select(next.id);
    } else {
      select(null);
    }
    await doValidateSchedule(true);
    toast("Turno eliminado", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}

async function doClearAll() {
  if (!(await showConfirm(
    "Limpiar base de datos",
    "Estás a punto de eliminar TODOS los turnos. Esta acción no se puede deshacer.",
  ))) return;
  try {
    await API.clearAll();
    state.selId = null;
    select(null);
    await refresh();
    $("#errors-box").innerHTML = '<span class="ok-msg">Sin validar.</span>';
    $("#val-dot").className = "dot idle";
    toast("Todos los turnos eliminados", "warn");
  } catch (e) {
    toast(e.message, "err");
  }
}

/* ============================ Schedule validation ============================ */

function renderErrorsPanel() {
  const box = $("#errors-box");
  const dot = $("#val-dot");
  box.innerHTML = "";

  if (!state.validationResult) {
    box.innerHTML = '<span class="ok-msg">Sin validar.</span>';
    dot.className = "dot idle";
    return;
  }

  let errors = state.validationResult.errors;
  if (state.tab === "conflicts" && state.selId != null) {
    errors = errors.filter((m) => m.ids.includes(state.selId));
  }

  if (!errors.length) {
    box.innerHTML = '<span class="ok-msg">✔ No hay conflictos.</span>';
    dot.className = "dot ok";
  } else {
    const h = document.createElement("div");
    h.className = "err-header";
    h.textContent = `✖ ${errors.length} conflicto(s) crítico(s):`;
    box.appendChild(h);
    errors.forEach((m) => box.appendChild(renderMessage(m)));
    dot.className = "dot err";
  }
}

async function doValidateSchedule(silent = false) {
  let res;
  try {
    res = await API.validateSchedule();
  } catch (e) {
    toast("Error al validar: " + e.message, "err");
    return;
  }
  state.validationResult = res;
  renderErrorsPanel();
  if (!silent)
    toast(
      res.errors.length
        ? `${res.errors.length} conflicto(s)`
        : "Horario válido",
      res.errors.length ? "err" : "ok",
    );
  await refresh();
}

// Renders a conflict message with the same colors as the original Tkinter
function renderMessage(m) {
  const div = document.createElement("div");
  div.className = "ln";
  const kindTxt =
    m.kind === "room" ? "Conflicto de aula" : "Conflicto de grupo";
  const roomTxt = m.room
    ? ` <span class="t-err">aula ${escapeHtml(m.room)}</span>`
    : "";
  div.innerHTML =
    `<span class="t-err">• [</span><span class="t-id">IDs: ${m.ids[0]} y ${m.ids[1]}</span>` +
    `<span class="t-err">] ${kindTxt}: </span>` +
    `<span class="t-grupo">${escapeHtml(m.groups[0])} y ${escapeHtml(m.groups[1])}</span> ` +
    `<span class="t-asig">${escapeHtml(m.subjects[0])} y ${escapeHtml(m.subjects[1])}</span>` +
    `<span class="t-err"> en ${escapeHtml(m.day)} sem </span>` +
    `<span class="t-sem">${escapeHtml(m.weeks)}</span>${roomTxt}`;
  return div;
}

/* ============================ Files ============================ */
async function doSaveFile() {
  try {
    const path = await API.saveFile();
    if (path) toast("Guardado en: " + path, "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}
async function doLoadFile() {
  try {
    const n = await API.loadFile();
    if (n !== null) {
      await refresh();
      toast(`Cargado (${n} turnos)`, "ok");
    }
  } catch (e) {
    toast(e.message, "err");
  }
}
async function doImportCsv() {
  try {
    const r = await API.importCsv();
    if (!r) return;
    await refresh();
    showInfo(
      "Importación CSV",
      `<p>Archivos procesados: <strong>${r.files}</strong></p>
       <p>Turnos agregados: <strong>${r.added}</strong></p>
       <p>Errores: <strong>${r.errors.length}</strong></p>
       ${r.errors.length ? '<hr><pre style="white-space:pre-wrap;font-size:11px;">' + r.errors.map(escapeHtml).join("\n") + "</pre>" : ""}`,
    );
  } catch (e) {
    toast(e.message, "err");
  }
}
async function doExportPdf() {
  if (!state.shifts.length) {
    toast("No hay turnos para exportar", "warn");
    return;
  }
  // Show config panel, hide progress
  $("#export-config").style.display = "";
  $("#export-progress").style.display = "none";
  $("#export-period").value = "1er periodo 2025-2026";
  openOverlay("ov-export");
}

async function startExport() {
  const period = $("#export-period").value.trim();
  if (!period) {
    toast("Escribe el periodo (ej. 1er periodo 2025-2026)", "warn");
    return;
  }
  // Hide config, show progress
  $("#export-config").style.display = "none";
  $("#export-progress").style.display = "";
  $("#export-bar").style.width = "0%";
  $("#export-label").textContent = "Iniciando…";
  try {
    const path = await API.exportPdf({ period, keepTyp: $("#export-keep-typ").checked });
    // Path returned immediately; the actual export runs in a background thread.
    // The export_complete event will fire when done.
    if (!path) {
      closeOverlay("ov-export");
      toast("Exportación cancelada", "warn");
    }
    // If path is set, the overlay stays open with the progress bar.
  } catch (e) {
    closeOverlay("ov-export");
    toast("Error al exportar: " + e.message, "err");
  }
}

function onExportComplete({ success, path, error }) {
  closeOverlay("ov-export");
  if (success) {
    showInfo(
      "Exportación finalizada",
      `<p>Horarios exportados en:</p><p><code>${escapeHtml(path)}</code></p>`,
    );
  } else {
    toast("Error al exportar: " + (error || "desconocido"), "err");
  }
}
function updateExportProgress({ current, total, message }) {
  $("#export-bar").style.width = (total ? (current / total) * 100 : 0) + "%";
  $("#export-label").textContent = message;
}

/* ============================ Config ============================ */
const CFG_DEFS = {
  careers: {
    cols: ["name", "tag", "prefix_digit", "groups"],
    labels: ["Nombre", "Dim.", "Prefijo", "Grupos"],
  },
  subjects: {
    cols: ["name", "tag"],
    labels: ["Nombre", "Diminutivo"],
  },
  types: { cols: ["name", "tag"], labels: ["Nombre", "Diminutivo"] },
  rooms: { cols: ["value"], labels: ["Aula"] },
};
let cfgSel = { careers: null, subjects: null, types: null, rooms: null };

function renderConfig() {
  const cont = $("#cfg-panes");
  cont.innerHTML = "";
  // Keep the pane in sync with whichever tab header is currently active,
  // since the headers are static markup and survive this re-render.
  const activeTab = $(".cfg-tab.active")?.dataset.cfgTab || "careers";
  for (const category of Object.keys(CFG_DEFS)) {
    const def = CFG_DEFS[category];
    const pane = document.createElement("div");
    pane.className = "cfg-pane" + (category === activeTab ? " active" : "");
    pane.dataset.cfgPane = category;

    const items =
      category === "rooms"
        ? state.config.rooms.map((a) => ({ value: a }))
        : state.config[category];
    const rowsHtml = items
      .map(
        (it, i) =>
          `<tr data-i="${i}">${def.cols.map((c) => `<td>${escapeHtml(it[c] ?? "")}</td>`).join("")}</tr>`,
      )
      .join("");

    const formFields = def.cols
      .map(
        (c) =>
          `<div class="field"><label>${def.labels[def.cols.indexOf(c)]}</label><input data-cf="${c}" type="text" /></div>`,
      )
      .join("");

    pane.innerHTML = `
      <div class="cfg-layout">
        <div class="cfg-list">
          <table><thead><tr>${def.labels.map((l) => `<th>${l}</th>`).join("")}</tr></thead>
          <tbody data-cfg-rows="${category}">${rowsHtml}</tbody></table>
        </div>
        <div class="cfg-form">
          ${formFields}
          <button class="btn primary" data-cfg-add="${category}">Añadir / Actualizar</button>
          <button class="btn danger" data-cfg-del="${category}">Eliminar seleccionado</button>
        </div>
      </div>`;
    cont.appendChild(pane);

    // row selection
    pane
      .querySelector(`[data-cfg-rows="${category}"]`)
      .addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        if (!tr) return;
        cfgSel[category] = +tr.dataset.i;
        $$(`[data-cfg-rows="${category}"] tr`).forEach((r) =>
          r.classList.toggle("sel", r === tr),
        );
        const it = items[cfgSel[category]];
        def.cols.forEach((c) => {
          const inp = pane.querySelector(`[data-cf="${c}"]`);
          if (inp) inp.value = it[c] ?? "";
        });
      });

    pane
      .querySelector(`[data-cfg-add="${category}"]`)
      .addEventListener("click", () => saveCfg(category, pane));
    pane
      .querySelector(`[data-cfg-del="${category}"]`)
      .addEventListener("click", () => deleteCfg(category));
  }
}

async function saveCfg(category, pane) {
  const v = {};
  CFG_DEFS[category].cols.forEach(
    (c) => (v[c] = pane.querySelector(`[data-cf="${c}"]`).value.trim()),
  );
  try {
    if (category === "careers") {
      if (!v.name || !v.tag)
        return toast("Nombre y diminutivo obligatorios", "warn");
      await API.saveCareer({
        name: v.name,
        tag: v.tag,
        prefix_digit: v.prefix_digit,
        groups: parseInt(v.groups, 10) || 2,
      });
    } else if (category === "rooms") {
      if (!v.value) return;
      await API.saveRoom(v.value);
    } else {
      if (!v.name || !v.tag)
        return toast("Nombre y diminutivo obligatorios", "warn");
      const entry = { name: v.name, tag: v.tag };
      await (category === "subjects"
        ? API.saveSubject(entry)
        : API.saveType(entry));
    }
    await loadConfig();
    toast("Configuración guardada", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}

async function deleteCfg(category) {
  const i = cfgSel[category];
  if (i == null) return toast("Selecciona un elemento", "warn");
  try {
    if (category === "careers")
      await API.deleteCareer(state.config.careers[i].name);
    else if (category === "rooms") await API.deleteRoom(state.config.rooms[i]);
    else {
      const name = state.config[category][i].name;
      await (category === "subjects"
        ? API.deleteSubject(name)
        : API.deleteType(name));
    }
    cfgSel[category] = null;
    await loadConfig();
    toast("Elemento eliminado", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}

async function openConfig() {
  // Config is handled fully in the frontend via the embedded modal.
  renderConfig();
  openOverlay("ov-config");
}

/* config tabs */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-cfg-tab]");
  if (!t) return;
  $$("[data-cfg-tab]").forEach((x) => x.classList.toggle("active", x === t));
  $$("[data-cfg-pane]").forEach((p) =>
    p.classList.toggle("active", p.dataset.cfgPane === t.dataset.cfgTab),
  );
});

/* ============================ Modals / overlays ============================ */
function bindModals() {
  $$("[data-close]").forEach((el) =>
    el.addEventListener("click", () => {
      el.closest(".overlay").classList.remove("open");
    }),
  );
  $$(".overlay").forEach((ov) =>
    ov.addEventListener("click", (e) => {
      if (e.target === ov && ov.id !== "ov-export") ov.classList.remove("open");
    }),
  );
}
function openOverlay(id) {
  $("#" + id).classList.add("open");
}
function closeOverlay(id) {
  $("#" + id).classList.remove("open");
}
function showInfo(title, html) {
  $("#info-title").textContent = title;
  $("#info-body").innerHTML = html;
  openOverlay("ov-info");
}

function showConfirm(title, msg) {
  return new Promise((resolve) => {
    $("#confirm-title").textContent = title;
    $("#confirm-body").textContent = msg;

    const onOk = () => {
      cleanup();
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onOverlay = (e) => {
      if (e.target === $("#ov-confirm")) {
        cleanup();
        resolve(false);
      }
    };
    const okBtn = $("#ov-confirm").querySelector("[data-confirm-ok]");
    const cancelBtn = $("#ov-confirm").querySelector("[data-confirm-cancel]");
    const overlay = $("#ov-confirm");
    const cleanup = () => {
      closeOverlay("ov-confirm");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlay);
    };

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlay);
    openOverlay("ov-confirm");
  });
}

/* ============================ Keyboard shortcuts ============================ */
function bindShortcuts() {
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "s") {
      e.preventDefault();
      doSaveFile();
    } else if (mod && e.key === "o") {
      e.preventDefault();
      doLoadFile();
    } else if (mod && e.key === "n") {
      e.preventDefault();
      $("#f-carrera").focus();
    } else if (e.key === "F5") {
      e.preventDefault();
      doValidateSchedule();
    } else if (
      e.key === "Delete" &&
      state.selId != null &&
      e.target.tagName !== "INPUT"
    )
      doDelete();
    else if (e.key === "Escape") {
      closeMenus();
      $$(".overlay.open").forEach((o) => {
        if (o.id !== "ov-export") o.classList.remove("open");
      });
    }
  });
}

/* ============================ Splitter (horizontal resize) ========= */
function bindSplitter() {
  const splitter = $("#splitter");
  const bottom = document.querySelector(".bottom");
  if (!splitter || !bottom) return;

  const MIN_ERR = 200; // min width of the errors panel
  const MIN_TBL = 320; // min width of the table

  let dragging = false;

  splitter.addEventListener("mousedown", (e) => {
    dragging = true;
    splitter.classList.add("dragging");
    document.body.classList.add("col-resizing");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = bottom.getBoundingClientRect();
    // errors panel width = distance from cursor to right edge
    let errW = rect.right - e.clientX;
    const maxErr = rect.width - MIN_TBL - 6;
    errW = Math.max(MIN_ERR, Math.min(errW, maxErr));
    bottom.style.setProperty("--errores-w", errW + "px");
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    document.body.classList.remove("col-resizing");
  });

  // Double click on the splitter: restore default width
  splitter.addEventListener("dblclick", () => {
    bottom.style.removeProperty("--errores-w");
  });
}

/* ============================ Status bar ============================ */
function updateStatus() {
  $("#sb-total").textContent = state.shifts.length;
  const n = state.nConflicts;
  $("#sb-conf").textContent = n === 0 ? "sin conflictos" : `${n} en conflicto`;
  $("#sb-conf-dot").className =
    "dot " + (state.shifts.length === 0 ? "idle" : n ? "err" : "ok");
}

/* ============================ Utilities ============================ */
function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
let toastSeq = 0;
function toast(msg, type = "", duration = 2600, html = false) {
  const stack = $("#toast-stack");
  const el = document.createElement("div");
  el.className = "toast " + type;
  if (html) el.innerHTML = msg;
  else el.textContent = msg;
  stack.appendChild(el);
  const id = ++toastSeq;
  $("#sb-action").textContent = el.textContent;
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .2s";
    setTimeout(() => el.remove(), 220);
  }, duration);
}

async function doInsult() {
  try {
    const txt = await API.insult();
    showInfo("Insult", `<p>${escapeHtml(txt)}</p>`);
  } catch (e) {
    toast(e.message, "err");
  }
}
