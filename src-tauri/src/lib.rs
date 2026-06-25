use csv::ReaderBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub mod export;

// =============================================================================
//  TYPES (must match the structures consumed by api.js)
// =============================================================================

//(id, start_time, end_time, subject, group)
type ShiftEntry = (u32, u32, u32, String, String);

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub careers: Vec<Career>,
    pub subjects: Vec<NameAndTag>,
    pub types: Vec<NameAndTag>,
    pub rooms: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Career {
    pub name: String,
    pub tag: String,
    pub prefix_digit: String,
    pub groups: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NameAndTag {
    pub name: String,
    pub tag: String,
}

//* What the form sends (src/api.js -> readForm). Everything arrives as text;
#[derive(Clone, Serialize, Deserialize)]
pub struct ShiftInput {
    pub career: String,
    pub year: String,
    pub group: String,
    pub subject: String,
    pub kind: String,
    pub day: String,
    pub schedule_type: String, // "estandar" | "personalizado"
    pub block: String,
    pub start_time: String,
    pub duration_hours: String,
    pub weeks_str: String,
    pub room: String,
}

/// A shift consumed by the table. Includes computed fields
/// (formatted `schedule` and `weeks_str`).
/// TODO a helper function to manage errors
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Shift {
    pub id: u32,
    pub career: String,
    pub year: u32,
    pub group: String,
    pub subject: String,
    pub kind: String,
    pub day: String,
    pub schedule_type: String,
    pub block: Option<u32>,
    pub start_time: String,
    pub duration_min: u32,
    pub weeks: Vec<u32>,
    pub room: String,
}

impl Shift {
    fn from_input(input: ShiftInput, id: u32) -> Result<Shift, String> {
        let new_shift = Shift {
            id: id,
            career: input.career,
            year: input
                .year
                .parse()
                .map_err(|_| "error parsing the year".to_string())?,
            group: input.group,
            subject: input.subject,
            kind: input.kind,
            day: input.day,
            block: if &input.schedule_type == "estandar" {
                Some(
                    input
                        .block
                        .parse()
                        .map_err(|_| "couldn't parse the block".to_string())?,
                )
            } else {
                None
            },
            schedule_type: input.schedule_type,
            start_time: input.start_time,
            duration_min: {
                let hours: u32 = input.duration_hours.parse().map_err(|_| {
                    format!(
                        "couldnt parse amount hours per shift: {}",
                        input.duration_hours
                    )
                })?;
                let mins = hours * 45 + (hours - 1) * 5;
                mins
            },
            weeks: deserialize_weeks(&input.weeks_str)?,
            room: input.room,
        };
        Ok(new_shift)
    }
}

/// Result of validating a shift WITHOUT inserting it.
#[derive(Serialize)]
pub struct ShiftValidation {
    pub valid: bool,
    pub error: Option<String>,
}

/// A structured conflict for the errors panel.
#[derive(Serialize)]
pub struct ConflictMessage {
    pub kind: String, // "room" | "group"
    pub ids: [u32; 2],
    pub groups: [String; 2],
    pub subjects: [String; 2],
    pub day: String,
    pub weeks: String,
    pub room: Option<String>,
}

#[derive(Serialize)]
pub struct ValidationResult {
    pub errors: Vec<ConflictMessage>,
    pub warnings: Vec<ConflictMessage>,
}

/// Return value of import_csv.
#[derive(Serialize)]
pub struct ImportResult {
    pub added: u32,
    pub files: u32,
    pub errors: Vec<String>,
}

// =============================================================================
//  GLOBAL STATE
// =============================================================================

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppState {
    // Path of the JSON "database". Not serialized; set at startup.
    #[serde(skip)]
    pub db_path: PathBuf,
    #[serde(default = "default_next_id")]
    pub next_id: u32,
    #[serde(default)]
    pub shifts: Vec<Shift>,
    #[serde(default = "default_config")]
    pub config: Config,
}

fn default_next_id() -> u32 {
    1
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            db_path: PathBuf::new(),
            next_id: 1,
            shifts: Vec::new(),
            config: default_config(),
        }
    }
}

impl AppState {
    /// Serializes the whole state to the JSON database (pretty-printed).
    /// Call this after every mutation.
    fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&self.db_path, json).map_err(|e| e.to_string())
    }
}

fn deserialize_weeks(weeks: &str) -> Result<Vec<u32>, String> {
    let weeks_cleaned = weeks.replace(' ', "");
    let mut weeks_parsed: Vec<u32> = Vec::new();
    for week in weeks_cleaned.split(',') {
        match week.split_once('-') {
            Some((a, b)) => {
                let start: u32 = a.parse().map_err(|_| format!("couldnt parse {a}"))?;
                let end: u32 = b.parse().map_err(|_| format!("couldnt parse {b}"))?;
                weeks_parsed.extend(start..=end);
            }
            None => {
                weeks_parsed.push(
                    week.parse()
                        .map_err(|_| format!("couldnt parse the week {week}"))?,
                );
            }
        }
    }
    Ok(weeks_parsed)
}

/// Reads the JSON database, falling back to defaults if missing or corrupt.
fn load_db(path: &Path) -> AppState {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        //TODO report a warning here
        Err(_) => AppState::default(),
    }
}

/// Initial config (same as the mock's, to start with real data).
fn default_config() -> Config {
    Config {
        careers: vec![
            Career {
                name: "Bioquímica".into(),
                tag: "BQ".into(),
                prefix_digit: "2".into(),
                groups: 2,
            },
            Career {
                name: "Biología".into(),
                tag: "BIO".into(),
                prefix_digit: "1".into(),
                groups: 2,
            },
            Career {
                name: "Microbiología".into(),
                tag: "MIC".into(),
                prefix_digit: "3".into(),
                groups: 2,
            },
        ],
        subjects: vec![
            NameAndTag {
                name: "Análisis Químico".into(),
                tag: "AQ".into(),
            },
            NameAndTag {
                name: "Mecánica".into(),
                tag: "MEC".into(),
            },
            NameAndTag {
                name: "CI y ED".into(),
                tag: "CIED".into(),
            },
            NameAndTag {
                name: "Química Orgánica".into(),
                tag: "QO".into(),
            },
        ],
        types: vec![
            NameAndTag {
                name: "C".into(),
                tag: "C".into(),
            },
            NameAndTag {
                name: "CP".into(),
                tag: "CP".into(),
            },
            NameAndTag {
                name: "L".into(),
                tag: "L".into(),
            },
        ],
        rooms: vec![
            "2C".into(),
            "3D".into(),
            "L-406".into(),
            "L-Física".into(),
            "F.Química".into(),
        ],
    }
}

// =============================================================================
//  COMMANDS — Config
// =============================================================================

#[tauri::command]
fn get_config(state: State<'_, Mutex<AppState>>) -> Config {
    state.lock().unwrap().config.clone()
}

#[tauri::command]
fn save_career(mut career: Career, state: State<'_, Mutex<AppState>>) -> Result<Config, String> {
    career.tag = career.tag.to_uppercase();
    let mut s = state.lock().unwrap();
    let name = career.name.clone();
    // Find by name first, then by tag as fallback (handles name edits).
    let idx = s
        .config
        .careers
        .iter()
        .position(|c| c.name == name || c.tag == career.tag);
    let old_name = idx.map(|i| s.config.careers[i].name.clone());
    match idx {
        Some(i) => s.config.careers[i] = career,
        None => s.config.careers.push(career),
    }
    // Propagate name change to shifts.
    if let Some(ref on) = old_name {
        if on != &name {
            for shift in &mut s.shifts {
                if shift.career == *on {
                    shift.career = name.clone();
                }
            }
        }
    }
    s.save()?;
    Ok(s.config.clone())
}

#[tauri::command]
fn delete_career(name: String, state: State<'_, Mutex<AppState>>) -> Result<Config, String> {
    let mut s = state.lock().unwrap();
    s.config.careers.retain(|c| c.name != name);
    s.save()?;
    Ok(s.config.clone())
}

#[tauri::command]
fn save_subject(mut entry: NameAndTag, state: State<'_, Mutex<AppState>>) -> Result<Config, String> {
    entry.tag = entry.tag.to_uppercase();
    let mut s = state.lock().unwrap();
    let name = entry.name.clone();
    let tag = entry.tag.clone();
    // Find by name first, fallback to tag (handles name edits while keeping tag).
    let idx = s
        .config
        .subjects
        .iter()
        .position(|i| i.name == name || i.tag == tag);
    let old_name = idx.map(|i| s.config.subjects[i].name.clone());
    match idx {
        Some(i) => s.config.subjects[i] = entry,
        None => s.config.subjects.push(entry),
    }
    // Propagate name change to shifts (shifts store subject name).
    if let Some(ref on) = old_name {
        if on != &name {
            for shift in &mut s.shifts {
                if shift.subject == *on {
                    shift.subject = name.clone();
                }
            }
        }
    }
    s.save()?;
    Ok(s.config.clone())
}

#[tauri::command]
fn save_type(mut entry: NameAndTag, state: State<'_, Mutex<AppState>>) -> Result<Config, String> {
    entry.tag = entry.tag.to_uppercase();
    let mut s = state.lock().unwrap();
    let tag = entry.tag.clone();
    let name = entry.name.clone();
    // Find by name (primary), fallback to tag.
    let idx = s
        .config
        .types
        .iter()
        .position(|i| i.name == name || i.tag == tag);
    let old_tag = idx.map(|i| s.config.types[i].tag.clone());
    match idx {
        Some(i) => s.config.types[i] = entry,
        None => s.config.types.push(entry),
    }
    // Propagate tag change to shifts (shifts store type tag).
    if let Some(ref ot) = old_tag {
        if ot != &tag {
            for shift in &mut s.shifts {
                if shift.kind == *ot {
                    shift.kind = tag.clone();
                }
            }
        }
    }
    s.save()?;
    Ok(s.config.clone())
}

#[tauri::command]
fn delete_subject(name: String, state: State<'_, Mutex<AppState>>) -> Result<Config, String> {
    let mut s = state.lock().unwrap();
    s.config.subjects.retain(|i| i.name != name);
    s.save()?;
    Ok(s.config.clone())
}

#[tauri::command]
fn delete_type(name: String, state: State<'_, Mutex<AppState>>) -> Result<Config, String> {
    let mut s = state.lock().unwrap();
    s.config.types.retain(|i| i.name != name);
    s.save()?;
    Ok(s.config.clone())
}

#[tauri::command]
fn save_room(room: String, state: State<'_, Mutex<AppState>>) -> Result<Config, String> {
    let mut s = state.lock().unwrap();
    if !room.is_empty() && !s.config.rooms.contains(&room) {
        s.config.rooms.push(room);
    }
    s.save()?;
    Ok(s.config.clone())
}

#[tauri::command]
fn delete_room(room: String, state: State<'_, Mutex<AppState>>) -> Result<Config, String> {
    let mut s = state.lock().unwrap();
    s.config.rooms.retain(|r| r != &room);
    s.save()?;
    Ok(s.config.clone())
}

/// Valid groups for (career, year): [prefixYear, prefixYear1, ...].
#[tauri::command]
fn group_options(career: String, year: String, state: State<'_, Mutex<AppState>>) -> Vec<String> {
    let s = state.lock().unwrap();
    let Some(career_match) = s.config.careers.iter().find(|c| c.name == career) else {
        return Vec::new();
    };
    let mut options = Vec::new();
    options.push(format!("{}{}", career_match.prefix_digit, year));
    for i in 1..=career_match.groups {
        options.push(format!("{}{}{}", career_match.prefix_digit, year, i));
    }
    options
}

// =============================================================================
//  COMMANDS — Shifts
// =============================================================================

fn parse_minutes(time: &str) -> Result<u32, String> {
    let parts: Vec<&str> = time.split(':').collect();
    if parts.len() != 2 {
        return Err(format!("formato HH:MM esperado, se recibió: {time}"));
    }
    let hours: u32 = parts[0]
        .parse()
        .map_err(|_| "horas inválidas".to_string())?;
    let mins: u32 = parts[1]
        .parse()
        .map_err(|_| "minutos inválidos".to_string())?;
    Ok(hours * 60 + mins)
}

#[tauri::command]
fn list_shifts(state: State<'_, Mutex<AppState>>) -> Vec<Shift> {
    state.lock().unwrap().shifts.clone()
}

#[tauri::command]
fn list_conflicts(state: State<'_, Mutex<AppState>>) -> Result<Vec<ConflictMessage>, String> {
    let s = state.lock().unwrap();
    let (room_map, group_map) = build_conflict_maps(&s.shifts)?;
    Ok(detect_conflicts(&room_map, &group_map))
}

fn build_conflict_maps(
    shifts: &[Shift],
) -> Result<
    (
        HashMap<(String, String), Vec<(ShiftEntry, Vec<u32>)>>,
        HashMap<(String, String), Vec<(ShiftEntry, Vec<u32>)>>,
    ),
    String,
> {
    let mut room_map: HashMap<(String, String), Vec<(ShiftEntry, Vec<u32>)>> = HashMap::new();
    let mut group_map: HashMap<(String, String), Vec<(ShiftEntry, Vec<u32>)>> = HashMap::new();

    for shift in shifts {
        let start = parse_minutes(&shift.start_time)?;
        let end = start + shift.duration_min;
        let entry = (
            shift.id,
            start,
            end,
            shift.subject.clone(),
            shift.group.clone(),
        );

        room_map
            .entry((shift.day.clone(), shift.room.clone()))
            .or_default()
            .push((entry.clone(), shift.weeks.clone()));

        group_map
            .entry((shift.day.clone(), shift.group.clone()))
            .or_default()
            .push((entry.clone(), shift.weeks.clone()));
    }

    Ok((room_map, group_map))
}

fn format_weeks(weeks: &[u32]) -> String {
    if weeks.is_empty() {
        return String::new();
    }
    let mut sorted = weeks.to_vec();
    sorted.sort();
    sorted.dedup();
    let mut parts = Vec::new();
    let mut start = sorted[0];
    let mut end = sorted[0];
    for &w in &sorted[1..] {
        if w == end + 1 {
            end = w;
        } else {
            if start == end {
                parts.push(start.to_string());
            } else {
                parts.push(format!("{}-{}", start, end));
            }
            start = w;
            end = w;
        }
    }
    if start == end {
        parts.push(start.to_string());
    } else {
        parts.push(format!("{}-{}", start, end));
    }
    parts.join(",")
}

fn detect_conflicts(
    room_map: &HashMap<(String, String), Vec<(ShiftEntry, Vec<u32>)>>,
    group_map: &HashMap<(String, String), Vec<(ShiftEntry, Vec<u32>)>>,
) -> Vec<ConflictMessage> {
    let mut conflicts = Vec::new();

    for ((day, room), entries) in room_map.iter() {
        for i in 0..entries.len() {
            for j in (i + 1)..entries.len() {
                let (a_entry, a_weeks) = &entries[i];
                let (b_entry, b_weeks) = &entries[j];
                let (_, a_start, a_end, _, _) = a_entry;
                let (_, b_start, b_end, _, _) = b_entry;
                if a_start.max(b_start) < a_end.min(b_end) {
                    let overlap: Vec<u32> = a_weeks
                        .iter()
                        .filter(|w| b_weeks.contains(w))
                        .copied()
                        .collect();
                    if !overlap.is_empty() {
                        conflicts.push(build_conflict(
                            a_entry,
                            b_entry,
                            "room",
                            day,
                            &overlap,
                            Some(room),
                        ));
                    }
                }
            }
        }
    }

    for ((day, _), entries) in group_map.iter() {
        for i in 0..entries.len() {
            for j in (i + 1)..entries.len() {
                let (a_entry, a_weeks) = &entries[i];
                let (b_entry, b_weeks) = &entries[j];
                let (_, a_start, a_end, _, _) = a_entry;
                let (_, b_start, b_end, _, _) = b_entry;
                if a_start.max(b_start) < a_end.min(b_end) {
                    let overlap: Vec<u32> = a_weeks
                        .iter()
                        .filter(|w| b_weeks.contains(w))
                        .copied()
                        .collect();
                    if !overlap.is_empty() {
                        conflicts.push(build_conflict(
                            a_entry, b_entry, "group", day, &overlap, None,
                        ));
                    }
                }
            }
        }
    }

    conflicts
}

fn build_conflict(
    a: &ShiftEntry,
    b: &ShiftEntry,
    kind: &str,
    day: &str,
    weeks: &[u32],
    room: Option<&String>,
) -> ConflictMessage {
    let (id_a, _, _, sub_a, grp_a) = a;
    let (id_b, _, _, sub_b, grp_b) = b;

    ConflictMessage {
        kind: kind.into(),
        ids: [*id_a, *id_b],
        groups: [grp_a.clone(), grp_b.clone()],
        subjects: [sub_a.clone(), sub_b.clone()],
        day: day.to_string(),
        weeks: format_weeks(weeks),
        room: room.cloned(),
    }
}

#[tauri::command]
fn add_shift(input_shift: ShiftInput, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    let new_shift = Shift::from_input(input_shift, s.next_id)?;
    s.next_id += 1;
    s.shifts.push(new_shift);
    s.save()?;
    Ok(())
}

#[tauri::command]
fn update_shift(
    id: u32,
    input_shift: ShiftInput,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let shift_to_update = Shift::from_input(input_shift, id)?;
    let mut s = state.lock().unwrap();
    s.shifts.retain(|sh| sh.id != id);
    s.shifts.push(shift_to_update);
    s.save()?;
    Ok(())
}

#[tauri::command]
fn delete_shift(id: u32, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    s.shifts.retain(|t| t.id != id);
    s.save()?;
    Ok(())
}

#[tauri::command]
fn clear_all(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    s.shifts.clear();
    s.next_id = 1;
    s.save()?;
    Ok(())
}

#[tauri::command]
fn validate_shift(_shift: ShiftInput, _state: State<'_, Mutex<AppState>>) -> ShiftValidation {
    // TODO: validate fields. For now mark everything as valid.
    ShiftValidation {
        valid: true,
        error: None,
    }
}

#[tauri::command]
fn validate_schedule(state: State<'_, Mutex<AppState>>) -> Result<ValidationResult, String> {
    let s = state.lock().unwrap();
    let (room_map, group_map) = build_conflict_maps(&s.shifts)?;
    let errors = detect_conflicts(&room_map, &group_map);
    Ok(ValidationResult {
        errors,
        warnings: Vec::new(),
    })
}

// =============================================================================
//  COMMANDS — File I/O
// =============================================================================

#[tauri::command]
async fn save_file(
    state: State<'_, Mutex<AppState>>,
    app: AppHandle,
) -> Result<Option<String>, String> {
    let Some(chosen_path) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name("horario.json")
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let s = state.lock().unwrap();
    let mut file_path: std::path::PathBuf = chosen_path.into_path().map_err(|e| e.to_string())?;
    if file_path.extension().and_then(|e| e.to_str()) != Some("json") {
        file_path.set_extension("json");
    }
    let json_content = serde_json::to_string_pretty(&*s).map_err(|e| e.to_string())?;
    std::fs::write(&file_path, json_content).map_err(|e| e.to_string())?;

    Ok(Some(file_path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn load_file(
    state: State<'_, Mutex<AppState>>,
    app: AppHandle,
) -> Result<Option<u32>, String> {
    let file_selected = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    let Some(file_selected) = file_selected else {
        return Ok(None);
    };
    let file_path: std::path::PathBuf = file_selected.into_path().map_err(|e| e.to_string())?;
    let json_content: String = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let loaded = serde_json::from_str::<AppState>(&json_content).map_err(|e| e.to_string())?;

    let mut s = state.lock().unwrap();
    s.shifts = loaded.shifts;
    s.config = loaded.config;
    s.next_id = loaded.next_id;

    s.save()?;
    Ok(Some(s.shifts.len() as u32))
}

#[tauri::command]
async fn import_csv(
    state: State<'_, Mutex<AppState>>,
    app: AppHandle,
) -> Result<Option<ImportResult>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("CSV", &["csv"])
        .blocking_pick_files();
    let Some(paths) = selected else {
        return Ok(None);
    };

    let mut s = state.lock().unwrap();
    let mut added: u32 = 0;
    let mut errors: Vec<String> = Vec::new();
    let n_files = paths.len() as u32;

    for file_path in paths {
        let path: PathBuf = match file_path.into_path() {
            Ok(p) => p,
            Err(e) => {
                errors.push(format!("Error al acceder al archivo: {}", e));
                continue;
            }
        };

        let mut rdr = match ReaderBuilder::new().has_headers(true).from_path(&path) {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("Error al leer {}: {}", path.display(), e));
                continue;
            }
        };

        for result in rdr.deserialize::<ShiftInput>() {
            let input = match result {
                Ok(i) => i,
                Err(e) => {
                    errors.push(format!("Error en {}: {}", path.display(), e));
                    continue;
                }
            };
            match Shift::from_input(input, s.next_id) {
                Ok(shift) => {
                    s.next_id += 1;
                    s.shifts.push(shift);
                    added += 1;
                }
                Err(e) => errors.push(format!("{}: {}", path.display(), e)),
            }
        }
    }

    s.save()?;

    Ok(Some(ImportResult {
        added,
        files: n_files,
        errors,
    }))
}

#[tauri::command]
async fn export_pdf(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    period: String,
    keep_typ: bool,
) -> Result<Option<String>, String> {
    let dir = app
        .dialog()
        .file()
        .set_title("Seleccionar carpeta donde se guardarán todos los archivos")
        .blocking_pick_folder();

    let Some(dir) = dir else {
        return Ok(None);
    };
    let dir_path: PathBuf = dir.into_path().map_err(|e| e.to_string())?;

    let (shifts, types, subjects) = {
        let s = state.lock().unwrap();
        if s.shifts.is_empty() {
            return Err("No hay turnos para exportar".into());
        }
        (s.shifts.clone(), s.config.types.clone(), s.config.subjects.clone())
    };

    // Create subfolder named after the period
    let dest_path = dir_path.join(&period);
    std::fs::create_dir_all(&dest_path)
        .map_err(|e| format!("Error al crear carpeta {dest_path:?}: {e}"))?;

    let path_str = dest_path.to_string_lossy().to_string();
    let path_clone = path_str.clone();

    // Spawn background thread so the frontend stays responsive
    std::thread::spawn(move || {
        let app_clone = app.clone();
        match export::run_export(&shifts, &dest_path, &period, keep_typ, &app_clone, &types, &subjects) {
            Ok(()) => {
                let _ = app.emit(
                    "export_complete",
                    serde_json::json!({
                        "success": true,
                        "path": path_clone,
                    }),
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "export_complete",
                    serde_json::json!({
                        "success": false,
                        "error": e,
                    }),
                );
            }
        }
    });

    Ok(Some(path_str))
}

// =============================================================================
//  STARTUP
// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // The JSON database lives next to the executable.
            let exe = std::env::current_exe()?;
            let db_path = exe
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("db.json");
            let mut state = load_db(&db_path);
            state.db_path = db_path;
            app.manage(Mutex::new(state));

            let window = app.get_webview_window("main").unwrap();
            if let Some(icon) = app.default_window_icon() {
                window.set_icon(icon.clone())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Config
            get_config,
            save_career,
            delete_career,
            save_subject,
            save_type,
            delete_subject,
            delete_type,
            save_room,
            delete_room,
            group_options,
            // Shifts
            list_shifts,
            list_conflicts,
            add_shift,
            update_shift,
            delete_shift,
            clear_all,
            validate_shift,
            validate_schedule,
            // I/O
            save_file,
            load_file,
            import_csv,
            export_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
