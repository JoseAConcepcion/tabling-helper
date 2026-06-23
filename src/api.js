/* =========================================================================
   api.js — Communication layer with the Rust backend (Tauri)
   -------------------------------------------------------------------------
   THIS IS THE LAYER YOU CONNECT TO RUST.

   Each function wraps a Tauri command `invoke('name', { args })`.
   The Rust backend must expose a command with EXACTLY that name and the
   argument names shown here (Tauri converts camelCase<->snake_case).
   ========================================================================= */

// Resolve invoke depending on Tauri version (v2: window.__TAURI__.core.invoke)
const tauriInvoke = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;

/* -------------------------------------------------------------------------
   Central helper: calls the backend.
   ------------------------------------------------------------------------- */
async function call(command, args = {}) {
  try {
    return await tauriInvoke(command, args);
  } catch (err) {
    // Rust returns Err(String) -> here it arrives as a string or {message}
    throw new ApiError(
      typeof err === "string" ? err : err?.message || "Unknown error",
    );
  }
}

class ApiError extends Error {}

/* -------------------------------------------------------------------------
   Schedule constants shared with app.js (blocks/"turnos" and weekdays).
   ------------------------------------------------------------------------- */
export const BLOCKS = {
  1: { start: "08:30", end: "10:05", dur: 95 },
  2: { start: "10:10", end: "11:45", dur: 95 },
  3: { start: "11:50", end: "13:25", dur: 95 },
  4: { start: "13:35", end: "15:10", dur: 95 },
  5: { start: "15:15", end: "16:50", dur: 95 },
  6: { start: "16:55", end: "18:30", dur: 95 },
};
export const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

/* =========================================================================
   PUBLIC API — what app.js consumes
   Each method maps 1:1 to a Rust command.
   ========================================================================= */
export const API = {
  // Returns the full list of shifts (each already "resolved":
  // with start_time, duration_min and formatted schedule). -> Vec<Shift>
  listShifts() {
    return call("list_shifts");
  },

  // Returns the list of conflicts with details (overlapping room or group). -> Vec<ConflictMessage>
  listConflicts() {
    return call("list_conflicts");
  },

  // Adds a new shift. The backend assigns the id (next_id) and validates.
  // payload: ShiftInput -> Ok(()) | Err(String validation message)
  addShift(payload) {
    return call("add_shift", { inputShift: payload });
  },

  // Updates an existing shift. Validates like add. -> Ok(Shift) | Err(String)
  updateShift(id, payload) {
    return call("update_shift", { id, inputShift: payload });
  },

  // Deletes a shift by id. -> Ok(()) | Err(String)
  deleteShift(id) {
    return call("delete_shift", { id });
  },

  // Clears all shifts and resets next_id. -> Ok(())
  clearAll() {
    return call("clear_all");
  },

  // Validates a shift WITHOUT inserting it. -> { valid: bool, error: String|null }
  validateShift(payload) {
    return call("validate_shift", { shift: payload });
  },

  // Recomputes and returns the list of structured conflict messages.
  // -> { errors: Vec<ConflictMessage>, warnings: Vec<ConflictMessage> }
  validateSchedule() {
    return call("validate_schedule");
  },

  /* ---- Config (careers, subjects, types, rooms) ---- */

  // Returns the whole config. -> Config
  getConfig() {
    return call("get_config");
  },

  // Careers: name, tag, prefix_digit, groups
  saveCareer(career) {
    return call("save_career", { career });
  }, // upsert by name
  deleteCareer(name) {
    return call("delete_career", { name });
  },

  // Subjects: { name, tag }
  saveSubject(entry) {
    return call("save_subject", { entry });
  },
  deleteSubject(name) {
    return call("delete_subject", { name });
  },

  // Class types: { name, tag }
  saveType(entry) {
    return call("save_type", { entry });
  },
  deleteType(name) {
    return call("delete_type", { name });
  },

  // Rooms (list of strings)
  saveRoom(room) {
    return call("save_room", { room });
  },
  deleteRoom(room) {
    return call("delete_room", { room });
  },

  // Returns the valid group options for (career, year):
  // [prefixYear, prefixYear1, ... prefixYearN]. Computed in Rust. -> Vec<String>
  groupOptions(career, year) {
    return call("group_options", { career, year });
  },

  /* ---- Persistence / file I/O (dialogs in Rust) ---- */

  // Opens "save as" dialog, serializes to JSON. -> Ok(path) | Ok(null if cancelled)
  saveFile() {
    return call("save_file");
  },

  // Opens "open" dialog, loads JSON, replaces state. -> Ok(n_shifts) | Ok(null)
  loadFile() {
    return call("load_file");
  },

  // Opens multi-select CSV dialog, imports and adds.
  // -> { added: u32, files: u32, errors: Vec<String> } | null
  importCsv() {
    return call("import_csv");
  },

  // Opens destination folder dialog and starts PDF export.
  // Progress arrives via EVENT (see onExportProgress), not via return.
  // -> Ok(dest_path) | Ok(null if cancelled)
  exportPdf({ period, keepTyp }) {
    return call("export_pdf", { period, keepTyp });
  },
};

/* -------------------------------------------------------------------------
   Backend events (Tauri emit). Used for export progress.
   The Rust backend does: app.emit("export_progress", { current, total, message })
   ------------------------------------------------------------------------- */
export const Events = {
  // callback({ current, total, message }); returns an unsubscribe function.
  async onExportProgress(callback) {
    const { listen } = window.__TAURI__.event;
    return await listen("export_progress", (e) => callback(e.payload));
  },
  // callback({ success, path, error }); called once when export finishes.
  async onExportComplete(callback) {
    const { listen } = window.__TAURI__.event;
    return await listen("export_complete", (e) => callback(e.payload));
  },
};
