/* =========================================================================
   app.js — UI logic (vanilla JS)
   Consumes API/Events from api.js. Never talks to Rust directly.
   ========================================================================= */

import { BLOCKS, DAYS, API, Events } from "./api.js";

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
  id: 40,
  career: 40,
  year: 40,
  group: 40,
  subject: 59,
  kind: 40,
  day: 47,
  schedule: 123,
  weeks_str: 81,
  room: 40,
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
  autoColWidths();
  await doValidateSchedule(true);
  setFormMode("create");
  bindVisualMode();

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
  // Visual mode
  toggle_visual_mode: toggleVisualMode,
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

function measureTextWidth(text, font) {
  const el = document.createElement("span");
  el.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${font};`;
  el.textContent = text ?? "";
  document.body.appendChild(el);
  const w = el.offsetWidth;
  document.body.removeChild(el);
  return w;
}

// Expands columns to fit their longest data value (one-time on startup).
// Only grows, never shrinks, so user resize is preserved.
function autoColWidths() {
  if (!state.shifts.length) return;
  const font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  COLUMNS.forEach((c) => {
    let maxW = DEFAULT_WIDTHS[c.key];
    for (const t of state.shifts) {
      const val = t[c.key];
      if (val != null) {
        const tw = measureTextWidth(String(val), font);
        maxW = Math.max(maxW, tw + 19);
      }
    }
    if (maxW > state.colWidths[c.key]) setColWidth(c.key, maxW);
  });
  persistColWidths();
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
  const row = $("#filters-row");
  row.innerHTML = "";
  COLUMNS.forEach((c) => {
    const th = document.createElement("th");
    th.className = "filter-cell";
    th.innerHTML = `<input type="text" data-fcol="${c.key}" placeholder="${escapeHtml(c.label)}" />`;
    row.appendChild(th);
  });
  row.addEventListener("input", (e) => {
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
  // Resolve kind: backend stores the tag, show it as-is (it's already the diminutivo)
  const kind = t.kind;
  return { ...t, kind, block, weeks, weeks_str, schedule };
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
  if (_VS.active) _renderVisualGrid();
}

/* ============================ Table: render ============================ */

function removeDiacritics(s) {
  return String(s).normalize("NFD").replace(/\p{M}/gu, "");
}

// Parses a user typed filter into individual week numbers.
// Accepts numbers, ranges (5-8), and comma-separated combos.
function parseWeekFilter(text) {
  const nums = [];
  for (const part of String(text).split(",")) {
    const t = part.trim();
    if (!t) continue;
    if (t.includes("-")) {
      const [a, b] = t.split("-").map((s) => parseInt(s, 10));
      if (!isNaN(a) && !isNaN(b))
        for (let w = Math.min(a, b); w <= Math.max(a, b); w++) nums.push(w);
    } else {
      const n = parseInt(t, 10);
      if (!isNaN(n)) nums.push(n);
    }
  }
  return [...new Set(nums)];
}

function filterAndSort() {
  let rows =
    state.tab === "conflicts"
      ? state.shifts.filter((t) => state.conflicts.has(t.id))
      : state.shifts.slice();

  for (const [k, v] of Object.entries(state.filters))
    rows = rows.filter((t) => {
      // Weeks column: parse filter as week numbers and match against the
      // resolved weeks array. This way "5" matches a shift with weeks "3-6".
      if (k === "weeks_str" && t.weeks?.length) {
        const filterWeeks = parseWeekFilter(v);
        if (!filterWeeks.length) return true;
        return filterWeeks.some((w) => t.weeks.includes(w));
      }
      return removeDiacritics(t[k]).toLowerCase().includes(removeDiacritics(v));
    });

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
  constructor(
    mount,
    inputId,
    { placeholder = "", onSelect = null, onUpdate = null } = {},
  ) {
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
    this.input.addEventListener("blur", () =>
      setTimeout(() => this._commitOnBlur(), 120),
    );
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
          .map(
            (v) =>
              `<div class="combo-item" data-value="${escapeHtml(v)}">${escapeHtml(v)}</div>`,
          )
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
    items.forEach((it, i) =>
      it.classList.toggle("active", i === this.activeIdx),
    );
    if (this.activeIdx >= 0)
      items[this.activeIdx].scrollIntoView({ block: "nearest" });
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
    const exact = this.values.find(
      (v) => v.toLowerCase() === text.toLowerCase(),
    );
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
    {
      onChange: () => {
        delete $("#f-hora").dataset.userEdited;
        onScheduleFieldChange();
      },
    },
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
  const label = $("#vf-form-mode");

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
  // Type combobox: values = names (for dropdown display), but search also
  // matches tags, and the committed value is the tag.
  state.typeTag = Object.fromEntries(c.types.map((x) => [x.name, x.tag]));
  state.tagType = Object.fromEntries(c.types.map((x) => [x.tag, x.name]));
  combos.kind.setValues(c.types.map((x) => x.name));
  combos.kind._kindItems = c.types;
  // isValid override: check against _kindItems tags, not values (names)
  combos.kind.isValid = function () {
    return this.committed !== "" && this._kindItems.some((item) => item.tag === this.committed);
  };
  combos.kind._matches = function (q) {
    const needle = q.trim().toLowerCase();
    if (!needle) return this.values.slice();
    return this.values.filter((v) => {
      const item = this._kindItems.find((x) => x.name === v);
      return (
        v.toLowerCase().includes(needle) ||
        (item && item.tag.toLowerCase().includes(needle))
      );
    });
  };
  combos.kind._commitOnBlur = function () {
    this._close();
    const text = this.input.value.trim().toLowerCase();
    if (!text) {
      this.committed = "";
      this.input.classList.remove("invalid");
      if (this.onUpdate) this.onUpdate();
      return;
    }
    const match = this._kindItems.find(
      (item) =>
        item.name.toLowerCase() === text || item.tag.toLowerCase() === text,
    );
    if (match) {
      this._commit(match.tag);
    } else {
      this.committed = "";
      this.input.classList.add("invalid");
      if (this.onUpdate) this.onUpdate();
    }
  };
  combos.kind.setValue = function (v) {
    const match = v
      ? this._kindItems.find((item) => item.name === v || item.tag === v)
      : null;
    if (match) {
      this.input.value = match.tag;
      this.committed = match.tag;
    } else {
      this.input.value = "";
      this.committed = "";
    }
    this.input.classList.remove("invalid");
    if (this.onUpdate) this.onUpdate();
  };
  combos.room.setValues(c.rooms);
}

function bindForm() {
  // Schedule type changes are handled by the stepper's onChange. Turno and
  // class-hours are native number inputs and need a live refresh.
  $("#f-bloque").addEventListener("input", () => {
    delete $("#f-hora").dataset.userEdited;
    onScheduleFieldChange();
  });
  $("#f-dur").addEventListener("input", onScheduleFieldChange);
  // group depends on career (combo onSelect -> syncGroups) + year
  $("#f-anio").addEventListener("input", () => {
    syncGroups();
    refreshSubmitEnabled();
  });
  // Weeks: live enable/disable while typing, full validation (toast) on blur.
  $("#f-semanas").addEventListener("input", refreshSubmitEnabled);
  $("#f-semanas").addEventListener("blur", validateWeeksField);
  // Start time: live update + auto-switch to personalizado if user edits
  $("#f-hora").addEventListener("input", () => {
    if (scheduleType() === "estandar") {
      steppers.htipo.setValue("personalizado");
      $("#f-bloque").value = "1";
    }
    $("#f-hora").dataset.userEdited = "1";
    syncSchedule();
    refreshSubmitEnabled();
  });
  $("#f-hora").addEventListener("blur", () => {
    const v = $("#f-hora").value.trim();
    const bad = v && !isValidTime24(v);
    $("#f-hora").classList.toggle("invalid", bad);
    if (bad)
      toast("Hora inválida. Usa formato 24h HH:MM (00:00–23:59).", "err");
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
  $("#f-hora").disabled = !formEnabled;
  $("#f-dur").disabled = !formEnabled;

  // Start time auto-fills from block in standard mode. In personalizado it
  // auto-fills only until the user manually edits the field.
  if (std || !$("#f-hora").dataset.userEdited) {
    $("#f-hora").value = b.start;
  }
  if (std) {
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
  combos.kind.setValue(state.typeTag?.[t.kind] ?? t.kind);
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
  if (t.schedule_type === "personalizado") {
    $("#f-hora").value = t.start_time;
    $("#f-hora").dataset.userEdited = "1";
  }
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
  delete $("#f-hora").dataset.userEdited;
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
  if (_VS.active) return _visualSave();
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
  if (_VS.active) return _visualDelete();
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
  if (
    !(await showConfirm(
      "Limpiar base de datos",
      "Estás a punto de eliminar TODOS los turnos. Esta acción no se puede deshacer.",
    ))
  )
    return;
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
      await doValidateSchedule(true);
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
    await doValidateSchedule(true);
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
    const path = await API.exportPdf({
      period,
      keepTyp: $("#export-keep-typ").checked,
    });
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
          <div class="cfg-buttons">
            <div class="cfg-row-add">
              <button class="btn icon" data-cfg-clear="${category}" title="Nuevo">+</button>
              <button class="btn primary" data-cfg-add="${category}" hidden>Añadir</button>
            </div>
            <div class="cfg-row-upd">
              <button class="btn primary" data-cfg-upd="${category}" disabled>Actualizar</button>
              <button class="btn danger" data-cfg-del="${category}" disabled>Eliminar</button>
            </div>
          </div>
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
        pane.querySelector(`[data-cfg-add="${category}"]`).hidden = true;
        pane.querySelector(`[data-cfg-upd="${category}"]`).disabled = false;
        pane.querySelector(`[data-cfg-del="${category}"]`).disabled = false;
      });

    pane
      .querySelector(`[data-cfg-clear="${category}"]`)
      .addEventListener("click", () => cfgClearForm(pane, category));
    pane
      .querySelector(`[data-cfg-add="${category}"]`)
      .addEventListener("click", () => addCfg(category, pane));
    pane
      .querySelector(`[data-cfg-upd="${category}"]`)
      .addEventListener("click", () => updateCfg(category, pane));
    pane
      .querySelector(`[data-cfg-del="${category}"]`)
      .addEventListener("click", () => deleteCfg(category, pane));
  }
}

function cfgFormValues(pane, category) {
  const v = {};
  CFG_DEFS[category].cols.forEach(
    (c) => (v[c] = pane.querySelector(`[data-cf="${c}"]`).value.trim()),
  );
  return v;
}

function cfgClearForm(pane, category) {
  CFG_DEFS[category].cols.forEach((c) => {
    pane.querySelector(`[data-cf="${c}"]`).value = "";
  });
  cfgSel[category] = null;
  pane.querySelector(`[data-cfg-add="${category}"]`).hidden = false;
  pane.querySelector(`[data-cfg-upd="${category}"]`).disabled = true;
  pane.querySelector(`[data-cfg-del="${category}"]`).disabled = true;
  // De-highlight selected row
  $$(`[data-cfg-rows="${category}"] tr.sel`).forEach((r) =>
    r.classList.remove("sel"),
  );
}

async function addCfg(category, pane) {
  const v = cfgFormValues(pane, category);
  try {
    if (category === "careers") {
      if (!v.name || !v.tag)
        return toast("Nombre y diminutivo obligatorios", "warn");
      if (state.config.careers.some((c) => c.name === v.name))
        return toast("Ya existe una carrera con ese nombre", "warn");
      await API.saveCareer({
        name: v.name,
        tag: v.tag,
        prefix_digit: v.prefix_digit,
        groups: parseInt(v.groups, 10) || 2,
      });
    } else if (category === "rooms") {
      if (!v.value) return;
      if (state.config.rooms.includes(v.value))
        return toast("Ya existe ese aula", "warn");
      await API.saveRoom(v.value);
    } else {
      if (!v.name || !v.tag)
        return toast("Nombre y diminutivo obligatorios", "warn");
      const items =
        category === "subjects" ? state.config.subjects : state.config.types;
      if (items.some((i) => i.name === v.name))
        return toast("Ya existe un elemento con ese nombre", "warn");
      const entry = { name: v.name, tag: v.tag };
      await (category === "subjects"
        ? API.saveSubject(entry)
        : API.saveType(entry));
    }
    cfgClearForm(pane, category);
    await loadConfig();
    await refresh();
    toast("Elemento añadido", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}

async function updateCfg(category, pane) {
  const idx = cfgSel[category];
  if (idx == null) return toast("Selecciona un elemento", "warn");
  const v = cfgFormValues(pane, category);
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
      const oldRoom = state.config.rooms[idx];
      if (oldRoom !== v.value) {
        await API.deleteRoom(oldRoom);
        await API.saveRoom(v.value);
      }
    } else {
      if (!v.name || !v.tag)
        return toast("Nombre y diminutivo obligatorios", "warn");
      const entry = { name: v.name, tag: v.tag };
      await (category === "subjects"
        ? API.saveSubject(entry)
        : API.saveType(entry));
    }
    cfgClearForm(pane, category);
    await loadConfig();
    await refresh();
    toast("Elemento actualizado", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}

async function deleteCfg(category, pane) {
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
    cfgClearForm(pane, category);
    await loadConfig();
    await refresh();
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

// Upper-case tag inputs live as user types.
document.addEventListener("input", (e) => {
  const inp = e.target.closest(".cfg-form input[data-cf='tag']");
  if (inp) inp.value = inp.value.toUpperCase();
});

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

function _populatePicker(listId, items, selIdx, onSelect) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = items.map((item, i) =>
    `<div class="vpl-item${i === selIdx ? ' sel' : ''}" data-idx="${i}">${escapeHtml(item)}</div>`
  ).join("");
  // Remove old click listener, add new one
  list.onclick = (e) => {
    const el = e.target.closest(".vpl-item");
    if (!el) return;
    onSelect(parseInt(el.dataset.idx, 10));
    _closeAllPickers();
  };
}

async function doInsult() {
  try {
    const txt = await API.insult();
    showInfo("Insult", `<p>${escapeHtml(txt)}</p>`);
  } catch (e) {
    toast(e.message, "err");
  }
}

/* =========================================================================
   Visual Mode (Grid Aula × Bloque)
   ========================================================================= */
const _VS = {
  active: false,
  week: 1,
  dayIdx: 0,
  editId: null,
  dragShiftId: null,
  subjectColors: {},
};

function _getSubjectColor(subject) {
  if (_VS.subjectColors[subject]) return _VS.subjectColors[subject];
  const hue = (Object.keys(_VS.subjectColors).length * 137.508) % 360;
  const color = `hsl(${hue}, 55%, 50%)`;
  _VS.subjectColors[subject] = color;
  return color;
}

function bindVisualMode() {
  document.querySelector(".visual-nav")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-visual]");
    if (!btn) return;
    const a = btn.dataset.visual;
    if (a === "prev_week") _VS.week = Math.max(1, _VS.week - 1);
    else if (a === "next_week") _VS.week = Math.min(16, _VS.week + 1);
    else if (a === "prev_day") _VS.dayIdx = (_VS.dayIdx - 1 + 5) % 5;
    else if (a === "next_day") _VS.dayIdx = (_VS.dayIdx + 1) % 5;
    else return;
    _renderVisualGrid();
  });
  document.getElementById("visual-delete-btn")?.addEventListener("click", _visualDelete);
  document.getElementById("ov-visual-confirm")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-visual-confirm]");
    if (!btn) return;
    _onVisualConfirm(btn.dataset.visualConfirm);
  });
  _bindVisualSplitter();
  // Picker toggles: semana/dia labels open a scrollable list
  document.querySelectorAll(".visual-picker").forEach((picker) => {
    const label = picker.querySelector("span");
    const list = picker.querySelector(".visual-picker-list");
    label?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = list.classList.contains("open");
      _closeAllPickers();
      if (!isOpen) {
        list.classList.add("open");
        // Scroll selected into view
        const sel = list.querySelector(".vpl-item.sel");
        if (sel) sel.scrollIntoView({ block: "nearest" });
      }
    });
  });
  document.addEventListener("click", _closeAllPickers);
}
function _closeAllPickers() {
  document.querySelectorAll(".visual-picker-list.open").forEach((l) => l.classList.remove("open"));
}

function toggleVisualMode() {
  _VS.active = !_VS.active;
  document.body.classList.toggle("visual-mode", _VS.active);
  const btn = document.getElementById("btn-visual-mode");
  if (_VS.active) {
    btn.style.background = "var(--accent-soft)";
    btn.style.color = "var(--accent-ink)";
    btn.textContent = "🗂 Modo Manual";
    _VS.week = 1;
    _VS.dayIdx = 0;
    _VS.editId = null;
    state.selId = null;
    state.editId = null;
    const formPanel = document.querySelector(".form-panel");
    const visualPanel = document.getElementById("visual-form-panel");
    visualPanel.innerHTML = "";
    visualPanel.appendChild(formPanel);
    formPanel.style.border = "none";
    formPanel.style.boxShadow = "none";
    _buildVisualGrid();
    _renderVisualGrid();
  } else {
    btn.style.background = "";
    btn.style.color = "";
    btn.textContent = "🗂 Modo Visual";
    _VS.editId = null;
    clearForm();
    const formPanel = document.querySelector(".form-panel");
    const workspace = document.querySelector(".workspace");
    const visualPanel = document.getElementById("visual-form-panel");
    if (formPanel && workspace) {
      formPanel.style.border = "";
      formPanel.style.boxShadow = "";
      workspace.insertBefore(formPanel, workspace.firstChild);
    }
    visualPanel.innerHTML = '<div class="panel-title">Detalles del turno</div>';
  }
  _updateVisualUI();
}

function _buildVisualGrid() {
  const grid = document.getElementById("visual-grid");
  if (!grid) return;
  const rooms = _VS.active && state.config ? state.config.rooms : [];
  grid.innerHTML = "";
  if (!rooms.length) return;

  const N = rooms.length;
  const cols = "50px " + " minmax(90px,1fr)".repeat(6);
  const rows = "auto " + " 60px".repeat(N);
  grid.style.cssText = `display:grid;grid-template-columns:${cols};grid-template-rows:${rows};min-width:750px;`;

  // Corner
  const corner = document.createElement("div");
  corner.className = "vg-header vg-corner";
  corner.textContent = "Aula\\B";
  corner.style.cssText = "grid-row:1;grid-column:1;position:sticky;top:0;left:0;z-index:5;";
  grid.appendChild(corner);

  // Block headers
  for (let b = 1; b <= 6; b++) {
    const h = document.createElement("div");
    h.className = "vg-header";
    const blk = BLOCKS[b];
    h.innerHTML = `Bloque ${b}<br><span style="font-weight:400;font-size:10px;color:var(--ink-faint);">${blk ? blk.start + '\u2013' + blk.end : ''}</span>`;
    h.style.cssText = `grid-row:1;grid-column:${b+1};position:sticky;top:0;z-index:4;`;
    grid.appendChild(h);
  }

  // Room labels + cell backgrounds
  rooms.forEach((room, ri) => {
    const row = ri + 2;
    const label = document.createElement("div");
    label.className = "vg-room";
    label.textContent = room;
    label.style.cssText = `grid-row:${row};grid-column:1;position:sticky;left:0;z-index:3;`;
    grid.appendChild(label);

    for (let b = 1; b <= 6; b++) {
      const cell = document.createElement("div");
      cell.className = "vg-cell";
      cell.dataset.room = room;
      cell.dataset.block = String(b);
      cell.style.gridRow = String(row);
      cell.style.gridColumn = String(b + 1);
      cell.style.zIndex = "2";
      _setupVisualCell(cell);
      grid.appendChild(cell);
    }
  });
}

function _setupVisualCell(cell) {
  cell.addEventListener("click", () => {
    if (_VS.active) _onVisualCellClick(cell);
  });
  // Drag & drop
  cell.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (_VS.dragShiftId) cell.classList.add("drag-over");
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    cell.classList.remove("drag-over");
    if (_VS.dragShiftId) _onVisualCellDrop(cell);
  });
}

function _renderVisualGrid() {
  if (!_VS.active) return;
  const weekLabel = document.getElementById("visual-week-label");
  const dayLabel = document.getElementById("visual-day-label");
  if (weekLabel) weekLabel.textContent = `Semana ${_VS.week}`;
  if (dayLabel) dayLabel.textContent = DAYS[_VS.dayIdx];
  _populatePicker("visual-week-list", Array.from({length: 16}, (_, i) => `Semana ${i + 1}`), _VS.week - 1, (i) => { _VS.week = i + 1; _renderVisualGrid(); });
  _populatePicker("visual-day-list", DAYS, _VS.dayIdx, (i) => { _VS.dayIdx = i; _renderVisualGrid(); });

  if (!state.config || !state.config.rooms) return;
  const rooms = state.config.rooms;
  const existingRooms = [
    ...document.querySelectorAll("#visual-grid .vg-room"),
  ].map((e) => e.textContent);
  if (JSON.stringify(existingRooms) !== JSON.stringify(rooms))
    _buildVisualGrid();

  const grid = document.getElementById("visual-grid");
  if (!grid) return;
  const day = DAYS[_VS.dayIdx];

  // Remove old shift cards
  grid.querySelectorAll(".vg-shift-card").forEach((el) => el.remove());

  // Collect visible shifts (week+day filter)
  const visible = state.shifts.filter(
    (t) => t.day === day && t.weeks?.includes(_VS.week)
  );

  // Determine block ranges and detect conflicts by overlapping blocks
  visible.forEach((t) => {
    const ri = rooms.indexOf(t.room);
    if (ri < 0) return;
    const blocks = _shiftBlocks(t);
    if (!blocks.length) return;
    t._ri = ri;
    t._fb = blocks[0];
    t._lb = blocks[blocks.length - 1];
  });
  const roomGroups = {};
  visible.filter((t) => t._ri != null).forEach((t) => {
    const ri = t._ri;
    if (!roomGroups[ri]) roomGroups[ri] = [];
    var assigned = false;
    for (var gi = 0; gi < roomGroups[ri].length; gi++) {
      var group = roomGroups[ri][gi];
      var overlaps = group.some(function (other) { return !(t._lb < other._fb || t._fb > other._lb); });
      if (overlaps) { group.push(t); assigned = true; break; }
    }
    if (!assigned) roomGroups[ri].push([t]);
  });
  visible.forEach((t) => {
    if (t._ri == null) return;
    var groups = roomGroups[t._ri];
    for (var gi = 0; gi < groups.length; gi++) {
      var idx = groups[gi].indexOf(t);
      if (idx !== -1) { t._conflictIdx = idx; t._conflictCount = groups[gi].length; break; }
    }
  });

  // Track which cells are covered by at least one shift
  const covered = new Set();

  visible.forEach((t) => {
    const ri = t._ri;
    if (ri === undefined || ri < 0) return;
    const blocks = _shiftBlocks(t);
    if (!blocks.length) return;
    const fb = t._fb;
    const lb = t._lb;
    blocks.forEach((b) => covered.add(ri + ":" + b));

    const conflictIdx = t._conflictIdx || 0;
    const conflictCount = t._conflictCount || 1;

    const card = document.createElement("div");
    card.className = "vg-shift-card" + (conflictCount > 1 ? " vg-shift-conflict" : "");
    card.dataset.shiftId = t.id;
    card.draggable = true;

    card.style.cssText = [
      "grid-row:" + (ri + 2) + ";",
      "grid-column:" + (fb + 1) + " / " + (lb + 2) + ";",
      "background:" + _getSubjectColor(t.subject) + ";",
      "z-index:" + (conflictCount > 1 ? conflictIdx + 20 : 15) + ";",
    ].join(" ");

    // Proportional margins only for custom shifts
    if (t.schedule_type === "personalizado") {
      const blkStart = BLOCKS[fb];
      const blkEnd = BLOCKS[lb];
      if (blkStart && blkEnd) {
        const bsMin = _parseMinutes(blkStart.start);
        const beMin = _parseMinutes(blkEnd.end);
        const sMin = t.start_time ? _parseMinutes(t.start_time) : bsMin;
        let eMin;
        if (t.end_time) {
          eMin = _parseMinutes(t.end_time);
        } else if (t.duration_min) {
          eMin = sMin + t.duration_min;
        } else {
          eMin = beMin;
        }
        const firstBlockDur = _parseMinutes(blkStart.end) - bsMin;
        const lastBlockDur = _parseMinutes(blkEnd.end) - _parseMinutes(blkEnd.start);
        const nSpan = blocks.length;
        let left = 0, right = 0;
        if (sMin > bsMin && firstBlockDur > 0) {
          left = Math.min(((sMin - bsMin) / firstBlockDur) / nSpan * 100, 100 / nSpan);
        }
        if (eMin < beMin && lastBlockDur > 0) {
          right = Math.min(((beMin - eMin) / lastBlockDur) / nSpan * 100, 100 / nSpan);
        }
        if (left > 0) card.style.marginLeft = "calc(3px + " + left + "%)";
        if (right > 0) card.style.marginRight = "calc(3px + " + right + "%)";
      }
    }

    // Conflict stacking — share the row height without overlapping
    if (conflictCount > 1) {
      var cMargin = 2;
      var availH = 60 - 2 * cMargin;
      var cardH = Math.floor(availH / conflictCount);
      card.style.cssText += "margin:" + cMargin + "px 3px;height:" + cardH + "px;top:" + (cMargin + conflictIdx * cardH) + "px;position:relative;";
    }

    // Content
    card.innerHTML =
      '<span class="vg-shift-subject">' + escapeHtml(t.subject) + "</span>" +
      (t.group ? ' <span class="vg-shift-group">' + escapeHtml(t.group) + "</span>" : "");

    // Drag handlers
    card.addEventListener("dragstart", function (e) {
      _VS.dragShiftId = t.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(t.id));
    });
    card.addEventListener("dragend", function () {
      _VS.dragShiftId = null;
      grid.querySelectorAll(".vg-cell.drag-over").forEach(function (c) { c.classList.remove("drag-over"); });
    });
    card.addEventListener("dragover", function (e) {
      e.preventDefault();
    });
    card.addEventListener("dragleave", function () {
      grid.querySelectorAll(".vg-cell.drag-over").forEach(function (c) { c.classList.remove("drag-over"); });
    });
    card.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      grid.querySelectorAll(".vg-cell.drag-over").forEach(function (c) { c.classList.remove("drag-over"); });
      if (!_VS.dragShiftId) return;
      var els = document.elementsFromPoint(e.clientX, e.clientY);
      var targetCell = null;
      for (var i = 0; i < els.length; i++) {
        if (els[i].classList && els[i].classList.contains("vg-cell")) {
          targetCell = els[i];
          break;
        }
      }
      if (targetCell) _onVisualCellDrop(targetCell);
    });

    // Click handler
    card.addEventListener("click", function () {
      var cell = grid.querySelector('.vg-cell[data-room="' + t.room + '"][data-block="' + fb + '"]');
      if (cell) {
        _onVisualCellClick(cell);
        if (t.schedule_type === "personalizado") {
          cell.classList.remove("selected");
          card.classList.add("selected");
        }
      }
    });

    grid.appendChild(card);
  });

  // Update cell empty indicators
  var allCells = grid.querySelectorAll(".vg-cell");
  for (var i = 0; i < allCells.length; i++) {
    var cell = allCells[i];
    var ri = rooms.indexOf(cell.dataset.room);
    var key = ri + ":" + cell.dataset.block;
    var empty = cell.querySelector(".vg-empty");
    if (covered.has(key)) {
      cell.dataset.hasShifts = "1";
      if (empty) empty.remove();
    } else {
      cell.dataset.hasShifts = "0";
      if (!empty) {
        var e = document.createElement("div");
        e.className = "vg-empty";
        e.textContent = "+";
        cell.appendChild(e);
      }
    }
  }
  _updateVisualUI();
}

function _shiftBlocks(t) {
  if (t.schedule_type === "estandar" && t.block) return [t.block];
  // Custom: calculate which block(s) the shift occupies
  const start = t.start_time;
  if (!start || !t.duration_min) return [1];
  const startMin = _parseMinutes(start);
  const endMin = startMin + t.duration_min;
  const blocks = [];
  for (let b = 1; b <= 6; b++) {
    const blk = BLOCKS[b];
    if (!blk) continue;
    const blkStart = _parseMinutes(blk.start);
    const blkEnd = _parseMinutes(blk.end);
    if (startMin < blkEnd && endMin > blkStart) blocks.push(b);
  }
  return blocks.length ? blocks : [1];
}

function _parseMinutes(t) {
  const p = String(t).split(":").map(Number);
  return p[0] * 60 + (p[1] || 0);
}

function _onVisualCellClick(cell) {
  const room = cell.dataset.room;
  const block = parseInt(cell.dataset.block, 10);
  const day = DAYS[_VS.dayIdx];

  // Find shift in this cell
  const shiftsHere = [];
  state.shifts.forEach((t) => {
    if (t.day !== day) return;
    if (!t.weeks || !t.weeks.includes(_VS.week)) return;
    const blocks = _shiftBlocks(t);
    if (blocks.includes(block) && t.room === room) shiftsHere.push(t);
  });

  if (shiftsHere.length === 0) {
    // Empty cell: auto-fill form
    _VS.editId = null;
    clearForm();
    // Set room, day, block, week
    combos.room.setValue(room);
    combos.day.setValue(day);
    document.getElementById("f-bloque").value = String(block);
    document.getElementById("f-semanas").value = String(_VS.week);
    setFormMode("create");
    document.getElementById("vf-form-mode").textContent =
      "Nuevo turno en celda";
    document.getElementById("visual-delete-btn").style.display = "none";
  } else {
    // Occupied cell: load first shift into form
    const t = shiftsHere[0];
    _VS.editId = t.id;
    loadIntoForm(t);
    setFormMode("edit", t);
    document.getElementById("vf-form-mode").textContent = `Editando #${t.id}`;
    document.getElementById("visual-delete-btn").style.display = "";
  }
  // Mark selected cell
  document
    .querySelectorAll("#visual-grid .vg-cell.selected, #visual-grid .vg-shift-card.selected")
    .forEach((c) => c.classList.remove("selected"));
  cell.classList.add("selected");
}

function _onVisualCellDrop(targetCell) {
  const srcShift = state.shifts.find((t) => t.id === _VS.dragShiftId);
  if (!srcShift) return;
  const targetRoom = targetCell.dataset.room;
  const targetBlock = parseInt(targetCell.dataset.block, 10);
  const targetDay = DAYS[_VS.dayIdx];

  // Check if target cell is occupied
  const targetBlocks = [targetBlock];
  const occupied = state.shifts.some((t) => {
    if (t.id === _VS.dragShiftId) return false;
    if (t.day !== targetDay) return false;
    if (t.room !== targetRoom) return false;
    if (!t.weeks || !t.weeks.includes(_VS.week)) return false;
    const blocks = _shiftBlocks(t);
    return blocks.some((b) => targetBlocks.includes(b));
  });
  if (occupied) {
    toast("La celda de destino está ocupada", "err");
    return;
  }

  // Show multi-week confirmation
  const hasMultipleWeeks = srcShift.weeks.length > 1;
  const msg = hasMultipleWeeks
    ? "¿Aplicar el movimiento a todas las semanas del turno o solo a esta?"
    : "¿Mover el turno a esta celda?";
  document.getElementById("ov-visual-confirm-msg").textContent = msg;
  _VS._pendingDrop = {
    shiftId: _VS.dragShiftId,
    room: targetRoom,
    day: targetDay,
    block: targetBlock,
  };
  document.getElementById("ov-visual-confirm").classList.add("open");
}

function _onVisualConfirm(answer) {
  document.getElementById("ov-visual-confirm").classList.remove("open");
  if (answer === "cancel") {
    _VS._pendingDrop = null;
    _VS._pendingSave = null;
    _VS._pendingDelete = null;
    _VS.dragShiftId = null;
    return;
  }

  if (_VS._pendingDrop) {
    const { shiftId, room, day, block } = _VS._pendingDrop;
    _VS._pendingDrop = null;
    const shift = state.shifts.find((t) => t.id === shiftId);
    if (!shift) return;

    if (answer === "all") {
      _doVisualUpdateShift(shiftId, room, day, block, null);
    } else if (answer === "single") {
      _doVisualSplitShift(shiftId, room, day, block, _VS.week);
    }
    _VS.dragShiftId = null;
  } else if (_VS._pendingSave) {
    const { id, data } = _VS._pendingSave;
    const shift = state.shifts.find((t) => t.id === id);
    _VS._pendingSave = null;
    if (answer === "single" && shift) {
      (async () => {
        try {
          const newWeeks = shift.weeks.filter((w) => w !== _VS.week);
          if (newWeeks.length > 0) {
            await API.updateShiftWeeks(id, newWeeks);
          } else {
            await API.deleteShift(id);
          }
          // Build a temp shift to find merge target
          const tempShift = {
            id: -1,
            career: data.career,
            group: data.group,
            subject: data.subject,
            kind: data.kind,
            schedule_type: data.schedule_type,
            weeks: [],
          };
          const existing = _findMergeTarget(tempShift, data.room, data.day, parseInt(data.block, 10) || 1);
          if (existing) {
            const mergedWeeks = [...new Set([...existing.weeks, _VS.week])].sort((a, b) => a - b);
            await API.updateShiftWeeks(existing.id, mergedWeeks);
            toast("Semana fusionada en turno existente", "ok");
          } else {
            data.weeks_str = String(_VS.week);
            await API.addShift(data);
            toast("Cambio aplicado solo a esta semana", "ok");
          }
          await refresh();
          _renderVisualGrid();
          _VS.editId = null;
        } catch (e) {
          toast(e.message, "err");
        }
      })();
    } else {
      // "Todas las semanas": update the whole shift
      (async () => {
        try {
          await API.updateShift(id, data);
          await refresh();
          _renderVisualGrid();
          _VS.editId = null;
          toast("Turno actualizado", "ok");
        } catch (e) {
          toast(e.message, "err");
        }
      })();
    }
  } else if (_VS._pendingDelete) {
    const deleteId = _VS._pendingDelete;
    _VS._pendingDelete = null;
    (async () => {
      try {
        if (answer === "single") {
          await API.updateShiftRemoveWeek(deleteId, _VS.week);
          toast("Semana eliminada del turno", "ok");
        } else {
          await API.deleteShift(deleteId);
          toast("Turno eliminado", "ok");
        }
        await refresh();
        _renderVisualGrid();
        _VS.editId = null;
        document.getElementById("visual-delete-btn").style.display = "none";
        document.getElementById("vf-form-mode").textContent = "";
        document.querySelectorAll("#visual-grid .vg-cell.selected, #visual-grid .vg-shift-card.selected")
          .forEach((c) => c.classList.remove("selected"));
      } catch (e) {
        toast(e.message, "err");
      }
    })();
  }
}

async function _doVisualUpdateShift(shiftId, room, day, block, specificWeek) {
  const shift = state.shifts.find((t) => t.id === shiftId);
  if (!shift) return;
  const data = _visualFormData(shift, room, day, block);
  try {
    if (specificWeek) {
      const newWeeks = shift.weeks.filter((w) => w !== specificWeek);
      if (newWeeks.length > 0) {
        await API.updateShiftWeeks(shiftId, newWeeks);
      } else {
        await API.deleteShift(shiftId);
      }
      const existing = _findMergeTarget(shift, room, day, block);
      if (existing) {
        const mergedWeeks = [...new Set([...existing.weeks, specificWeek])].sort((a, b) => a - b);
        await API.updateShiftWeeks(existing.id, mergedWeeks);
        toast("Semana fusionada en turno existente", "ok");
      } else {
        await API.addShift(data);
        toast("Turno creado en la nueva celda", "ok");
      }
    } else {
      await API.updateShift(shiftId, data);
      toast("Turno actualizado", "ok");
    }
    await refresh();
    _renderVisualGrid();
  } catch (e) {
    toast(e.message, "err");
  }
}

function _findMergeTarget(shift, room, day, block) {
  // Look for an existing shift with same group+subject+day+room+schedule+block
  return state.shifts.find((t) => {
    if (t.id === shift.id) return false;
    if (t.day !== day) return false;
    if (t.room !== room) return false;
    if (t.group !== shift.group) return false;
    if (t.subject !== shift.subject) return false;
    if (t.career !== shift.career) return false;
    if (t.schedule_type !== shift.schedule_type) return false;
    if (t.schedule_type === "estandar") {
      const targetBlock = _shiftBlocks(t)[0];
      if (targetBlock !== block) return false;
    }
    return true;
  });
}

async function _doVisualSplitShift(shiftId, room, day, block, week) {
  const shift = state.shifts.find((t) => t.id === shiftId);
  if (!shift) return;
  const data = _visualFormData(shift, room, day, block);
  try {
    // Remove week from original
    const newWeeks = shift.weeks.filter((w) => w !== week);
    if (newWeeks.length > 0) {
      await API.updateShiftWeeks(shiftId, newWeeks);
    } else {
      await API.deleteShift(shiftId);
    }
    // Try to merge into existing shift at target
    const existing = _findMergeTarget(shift, room, day, block);
    if (existing) {
      const mergedWeeks = [...new Set([...existing.weeks, week])].sort((a, b) => a - b);
      await API.updateShiftWeeks(existing.id, mergedWeeks);
      toast("Semana fusionada en turno existente", "ok");
    } else {
      // Create new shift for this week only
      data.weeks_str = String(week);
      await API.addShift(data);
      toast("Turno duplicado en la nueva celda", "ok");
    }
    await refresh();
    _renderVisualGrid();
  } catch (e) {
    toast(e.message, "err");
  }
}

function _visualFormData(srcShift, newRoom, newDay, newBlock) {
  const blk = BLOCKS[newBlock];
  const blockStart = blk ? blk.start : "08:30";
  if (srcShift.schedule_type === "personalizado") {
    const origBlocks = _shiftBlocks(srcShift);
    const origFirstBlock = origBlocks[0];
    const origBlk = BLOCKS[origFirstBlock];
    let newStartTime = blockStart;
    if (srcShift.start_time && origBlk) {
      const offset = _parseMinutes(srcShift.start_time) - _parseMinutes(origBlk.start);
      const newStartMin = _parseMinutes(blk.start) + offset;
      const h = Math.floor(newStartMin / 60);
      const m = newStartMin % 60;
      newStartTime = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    }
    return {
      career: srcShift.career,
      year: String(srcShift.year),
      group: srcShift.group,
      subject: srcShift.subject,
      kind: srcShift.kind,
      day: newDay,
      schedule_type: "personalizado",
      block: "",
      start_time: newStartTime,
      duration_hours: String(Math.ceil((srcShift.duration_min + 5) / 50)),
      weeks_str: srcShift.weeks_str || weeksToString(srcShift.weeks),
      room: newRoom,
    };
  }
  return {
    career: srcShift.career,
    year: String(srcShift.year),
    group: srcShift.group,
    subject: srcShift.subject,
    kind: srcShift.kind,
    day: newDay,
    schedule_type: "estandar",
    block: String(newBlock),
    start_time: blockStart,
    duration_hours: "1",
    weeks_str: srcShift.weeks_str || weeksToString(srcShift.weeks),
    room: newRoom,
  };
}

async function _visualSave() {
  const formPanel = document.querySelector(".form-panel");
  if (!formPanel) return;
  const data = readForm();
  data.room = combos.room.getValue();
  data.day = combos.day.getValue();
  data.block = document.getElementById("f-bloque").value;
  if (
    !data.career ||
    !data.subject ||
    !data.room ||
    !data.day ||
    !data.weeks_str
  ) {
    toast("Completa todos los campos requeridos", "warn");
    return;
  }
  try {
    if (_VS.editId != null) {
      const shift = state.shifts.find((t) => t.id === _VS.editId);
      if (shift) {
        const oldWeeks = shift.weeks;
        const newWeeks = deserializeWeeksStr(data.weeks_str);
        const weeksChanged =
          JSON.stringify([...oldWeeks].sort()) !==
          JSON.stringify([...newWeeks].sort());
        if (weeksChanged && oldWeeks.length > 1) {
          _VS._pendingSave = { id: _VS.editId, data };
          document.getElementById("ov-visual-confirm-msg").textContent =
            "Las semanas cambiaron. ¿Aplicar a todas las semanas o solo a esta?";
          document.getElementById("ov-visual-confirm").classList.add("open");
          return;
        }
      }
      await API.updateShift(_VS.editId, data);
      toast("Turno actualizado", "ok");
    } else {
      // Check if there's a matching shift to merge weeks into
      const newWeeks = deserializeWeeksStr(data.weeks_str);
      const tempShift = {
        id: -1, career: data.career, group: data.group, subject: data.subject,
        kind: data.kind, schedule_type: data.schedule_type, weeks: [],
      };
      const existing = _findMergeTarget(tempShift, data.room, data.day, parseInt(data.block, 10) || 1);
      if (existing) {
        const mergedWeeks = [...new Set([...existing.weeks, ...newWeeks])].sort((a, b) => a - b);
        await API.updateShiftWeeks(existing.id, mergedWeeks);
        toast("Semanas añadidas a turno existente", "ok");
      } else {
        await API.addShift(data);
        toast("Turno agregado", "ok");
      }
    }
    await refresh();
    _renderVisualGrid();
    _VS.editId = null;
    state.editId = null;
    document.getElementById("visual-delete-btn").style.display = "none";
    document.getElementById("vf-form-mode").textContent = "";
    document
      .querySelectorAll("#visual-grid .vg-cell.selected, #visual-grid .vg-shift-card.selected")
      .forEach((c) => c.classList.remove("selected"));
  } catch (e) {
    toast(e.message, "err");
  }
}

function deserializeWeeksStr(str) {
  const cleaned = String(str).replace(/\s/g, "");
  const result = [];
  cleaned.split(",").forEach((part) => {
    if (!part) return;
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      for (let w = Math.min(a, b); w <= Math.max(a, b); w++) result.push(w);
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) result.push(n);
    }
  });
  return [...new Set(result)].sort((a, b) => a - b);
}

async function _visualDelete() {
  if (_VS.editId == null) return;
  const shift = state.shifts.find((t) => t.id === _VS.editId);
  if (!shift) return;
  if (shift.weeks.length > 1) {
    document.getElementById("ov-visual-confirm-msg").textContent =
      "¿Eliminar esta semana o todas las semanas?";
    _VS._pendingDelete = _VS.editId;
    document.getElementById("ov-visual-confirm").classList.add("open");
  } else {
    if (!confirm("¿Eliminar este turno por completo?")) return;
    try {
      await API.deleteShift(_VS.editId);
      await refresh();
      _renderVisualGrid();
      _VS.editId = null;
      document.getElementById("visual-delete-btn").style.display = "none";
      document.getElementById("vf-form-mode").textContent = "";
      document.querySelectorAll("#visual-grid .vg-cell.selected, #visual-grid .vg-shift-card.selected")
        .forEach((c) => c.classList.remove("selected"));
      toast("Turno eliminado", "ok");
    } catch (e) {
      toast(e.message, "err");
    }
  }
}

function _updateVisualUI() {
  if (!_VS.active) return;
  document.getElementById("visual-delete-btn").style.display =
    _VS.editId != null ? "" : "none";
}

function _bindVisualSplitter() {
  const splitter = document.getElementById("visual-splitter");
  const visualPanel = document.getElementById("visual-form-panel");
  if (!splitter || !visualPanel) return;
  const MIN_W = 200;
  const MAX_W = 500;
  let dragging = false;
  splitter.addEventListener("mousedown", (e) => {
    dragging = true;
    splitter.classList.add("dragging");
    document.body.classList.add("col-resizing");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = splitter.parentNode.getBoundingClientRect();
    let w = rect.right - e.clientX;
    w = Math.max(MIN_W, Math.min(w, MAX_W));
    visualPanel.style.width = w + "px";
    visualPanel.style.flex = "none";
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    document.body.classList.remove("col-resizing");
  });
}
