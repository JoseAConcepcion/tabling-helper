use crate::{NameAndTag, Shift};
use chrono::{Duration, NaiveTime};
use md5::{Digest, Md5};
use std::collections::{HashMap, HashSet};
use std::fs;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

const BLOQUES_ESTANDAR: &[(&str, &str)] = &[
    ("08:30", "10:05"),
    ("10:10", "11:45"),
    ("11:50", "13:25"),
    ("13:35", "15:10"),
    ("15:15", "16:50"),
    ("16:55", "18:30"),
];

const DIAS: &[&str] = &["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

fn acortar_semanas(semanas: &[u32]) -> String {
    if semanas.is_empty() {
        return String::new();
    }
    let mut s = semanas.to_vec();
    s.sort_unstable();
    s.dedup();

    let mut rangos = Vec::new();
    let mut inicio = s[0];
    let mut anterior = s[0];

    for &curr in s.iter().skip(1) {
        if curr != anterior + 1 {
            if inicio == anterior {
                rangos.push(inicio.to_string());
            } else {
                rangos.push(format!("{}-{}", inicio, anterior));
            }
            inicio = curr;
        }
        anterior = curr;
    }
    if inicio == anterior {
        rangos.push(inicio.to_string());
    } else {
        rangos.push(format!("{}-{}", inicio, anterior));
    }

    rangos.join(", ")
}

fn hue_to_rgb(p: f64, q: f64, mut t: f64) -> f64 {
    if t < 0.0 {
        t += 1.0;
    }
    if t > 1.0 {
        t -= 1.0;
    }
    if t < 1.0 / 6.0 {
        return p + (q - p) * 6.0 * t;
    }
    if t < 1.0 / 2.0 {
        return q;
    }
    if t < 2.0 / 3.0 {
        return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    }
    p
}

fn hls_to_rgb(h: f64, l: f64, s: f64) -> (u8, u8, u8) {
    let (r, g, b) = if s == 0.0 {
        (l, l, l)
    } else {
        let q = if l < 0.5 {
            l * (1.0 + s)
        } else {
            l + s - l * s
        };
        let p = 2.0 * l - q;
        (
            hue_to_rgb(p, q, h + 1.0 / 3.0),
            hue_to_rgb(p, q, h),
            hue_to_rgb(p, q, h - 1.0 / 3.0),
        )
    };
    (
        (r * 255.0).round() as u8,
        (g * 255.0).round() as u8,
        (b * 255.0).round() as u8,
    )
}

fn generar_color_pastel(texto: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(texto.as_bytes());
    let result = hasher.finalize();

    let mut arr = [0u8; 16];
    arr.copy_from_slice(&result);
    let hash_int = u128::from_be_bytes(arr);
    let hue = (hash_int % 360) as f64 / 360.0;

    let (r, g, b) = hls_to_rgb(hue, 0.75, 0.85);
    format!("#{:02x}{:02x}{:02x}", r, g, b)
}

fn calcular_hora_fin(inicio_str: &str, duracion_min: u32) -> String {
    let time = NaiveTime::parse_from_str(inicio_str, "%H:%M").unwrap();
    let end_time = time + Duration::minutes(duracion_min as i64);
    end_time.format("%H:%M").to_string()
}

fn generar_etiquetas_intervalos(intervalos: &[(String, String)]) -> HashMap<String, String> {
    let std_map: HashMap<(&str, &str), usize> = BLOQUES_ESTANDAR
        .iter()
        .enumerate()
        .map(|(i, (ini, fin))| ((*ini, *fin), i + 1))
        .collect();
    let mut etiquetas = HashMap::new();
    let mut last_std = 0usize;
    let mut sub_count = 1usize;

    for (ini, fin) in intervalos {
        if let Some(&label) = std_map.get(&(ini.as_str(), fin.as_str())) {
            etiquetas.insert(format!("{ini}-{fin}"), label.to_string());
            last_std = label;
            sub_count = 1;
        } else {
            etiquetas.insert(format!("{ini}-{fin}"), format!("{last_std}.{sub_count}"));
            sub_count += 1;
        }
    }
    etiquetas
}

fn find_typst() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let mut path = std::env::current_exe().ok()?;
        path.pop();
        path.push("typst.exe");
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = if cfg!(target_os = "windows") {
                dir.join("typst.exe")
            } else {
                dir.join("typst")
            };
            if candidate.is_file() {
                Some(candidate.to_string_lossy().to_string())
            } else {
                None
            }
        })
    })
}

fn ordinal_year(year: u32) -> String {
    match year {
        1 => "1er año".to_string(),
        2 => "2do año".to_string(),
        3 => "3er año".to_string(),
        4 => "4to año".to_string(),
        _ => format!("{year}er año"), //change later, throw error or should depend on the config
    }
}

fn emit_progress(app: &AppHandle, current: u32, total: u32, message: &str) {
    let _ = app.emit(
        "export_progress",
        serde_json::json!({
            "current": current,
            "total": total,
            "message": message,
        }),
    );
}

fn escribir_preambulo_typst() -> String {
    let mut out = String::new();
    out.push_str("#set page(\"a4\", flipped: true, margin: (x: 1.2cm, y: 1cm))\n");
    out.push_str("#set text(font: \"Liberation Sans\", size: 8.5pt, fill: rgb(\"#333333\"))\n\n");

    // Card for group schedule
    out.push_str("#let card_grupo(color, asig, tipo, aula, semanas) = block(\n");
    out.push_str("  fill: rgb(color).lighten(60%),\n");
    out.push_str("  stroke: 0.5pt + rgb(\"#cccccc\"),\n");
    out.push_str("  width: 100%,\n");
    out.push_str("  inset: (x: 4pt, y: 3pt),\n");
    out.push_str("  radius: 3pt\n");
    out.push_str(")[");
    out.push_str(
        "  #text(weight: \"bold\", size: 8.5pt)[#asig] #text(size: 7.5pt, style: \"italic\")[[#tipo]]",
    );
    out.push_str("  #v(1pt)\n");
    out.push_str("  #text(size: 7pt, fill: rgb(\"#444444\"))[Aula: #aula | Sem: #semanas]\n");
    out.push_str("]\n\n");

    // Card for master table
    out.push_str("#let card_master(texto, color) = block(\n");
    out.push_str("  fill: rgb(color).lighten(40%),\n");
    out.push_str("  stroke: 0.5pt + rgb(\"#cccccc\"),\n");
    out.push_str("  width: 100%,\n");
    out.push_str("  inset: 3pt,\n");
    out.push_str("  radius: 3pt\n");
    out.push_str(")[#text(weight: \"bold\", size: 7.5pt, fill: rgb(\"#333333\"))[#texto]]\n\n");

    out.push_str("#let titulo(texto) = {\n");
    out.push_str("  block(fill: rgb(\"#2c3e50\"), inset: 12pt, radius: 4pt, width: 100%)[\n");
    out.push_str("    #align(center)[#text(size: 14pt, weight: \"bold\", fill: white)[#texto]]\n");
    out.push_str("  ]\n");
    out.push_str("  v(8pt)\n");
    out.push_str("}\n\n");

    out
}

/// Build the set of intervalos for a group table (all standard + non-standard used by these shifts)
fn build_intervalos_grupo(turnos: &[Shift]) -> Vec<(String, String)> {
    let mut intervalos_set = HashSet::new();
    for &(ini, fin) in BLOQUES_ESTANDAR {
        intervalos_set.insert((ini.to_string(), fin.to_string()));
    }
    for t in turnos {
        let fin = if t.schedule_type == "estandar" {
            BLOQUES_ESTANDAR
                .iter()
                .find(|b| b.0 == t.start_time)
                .map(|b| b.1.to_string())
                .unwrap_or_default()
        } else {
            calcular_hora_fin(&t.start_time, t.duration_min)
        };
        intervalos_set.insert((t.start_time.clone(), fin));
    }
    let mut intervalos: Vec<_> = intervalos_set.into_iter().collect();
    intervalos.sort_by(|a, b| a.0.cmp(&b.0));
    intervalos
}

/// Build the set of intervalos for a master table (only intervals used by shifts matching `dia`)
fn build_intervalos_master(turnos: &[Shift], dia: &str) -> Vec<(String, String)> {
    let mut intervalos_set = HashSet::new();
    for &(ini, fin) in BLOQUES_ESTANDAR {
        intervalos_set.insert((ini.to_string(), fin.to_string()));
    }
    for t in turnos {
        if t.day == *dia {
            let fin = if t.schedule_type == "estandar" {
                BLOQUES_ESTANDAR
                    .iter()
                    .find(|b| b.0 == t.start_time)
                    .map(|b| b.1.to_string())
                    .unwrap_or_default()
            } else {
                calcular_hora_fin(&t.start_time, t.duration_min)
            };
            intervalos_set.insert((t.start_time.clone(), fin));
        }
    }
    let mut intervalos: Vec<_> = intervalos_set.into_iter().collect();
    intervalos.sort_by(|a, b| a.0.cmp(&b.0));
    intervalos
}

fn generar_tabla_grupo_typst(turnos: &[Shift], semana_filtro: Option<u32>, types: &[NameAndTag], subjects: &[NameAndTag]) -> String {
    let intervalos = build_intervalos_grupo(turnos);
    let mut t = String::new();

    let cols = std::iter::once("80pt".to_string())
        .chain(std::iter::repeat("1fr".to_string()).take(DIAS.len()))
        .collect::<Vec<_>>()
        .join(", ");

    t.push_str(&format!(
        "#table(\n  columns: ({}),\n  align: center + horizon,\n  stroke: 0.5pt + rgb(\"#bdc3c7\"),\n  fill: (col, row) => if row == 0 {{ rgb(\"#ecf0f1\") }} else if calc.even(row) {{ rgb(\"#ffffff\") }} else {{ rgb(\"#f9f9f9\") }},\n  inset: 4pt,\n",
        cols
    ));

    t.push_str("  [#text(weight: \"bold\", fill: rgb(\"#2c3e50\"))[Hora]],");
    for d in DIAS {
        t.push_str(&format!(
            "  [#text(weight: \"bold\", fill: rgb(\"#2c3e50\"))[{d}]],"
        ));
    }
    t.push_str("\n");

    for (ini, fin) in &intervalos {
        t.push_str(&format!(
            "  [#text(weight: \"bold\", fill: rgb(\"#2c3e50\"))[{ini}-{fin}]],"
        ));

        for d in DIAS {
            let mut celdas: Vec<String> = Vec::new();

            for turno in turnos {
                if turno.day == *d && turno.start_time == *ini {
                    let t_fin = if turno.schedule_type == "estandar" {
                        BLOQUES_ESTANDAR
                            .iter()
                            .find(|b| b.0 == turno.start_time)
                            .map(|b| b.1.to_string())
                            .unwrap_or_default()
                    } else {
                        calcular_hora_fin(&turno.start_time, turno.duration_min)
                    };

                    if t_fin == *fin {
                        if semana_filtro.is_none() || turno.weeks.contains(&semana_filtro.unwrap())
                        {
                            let subj_tag = subject_tag(&turno.subject, subjects);
                            let color = generar_color_pastel(&subj_tag);
                            let semanas_txt = acortar_semanas(&turno.weeks);

                            let kind = kind_tag(&turno.kind, types);
                            celdas.push(format!(
                                "#card_grupo(\"{}\", \"{}\", \"{}\", \"{}\", \"{}\")",
                                color,
                                subj_tag.replace('"', "\\\""),
                                kind,
                                turno.room.replace('"', "\\\""),
                                semanas_txt
                            ));
                        }
                    }
                }
            }

            if celdas.is_empty() {
                t.push_str(" [],");
            } else {
                t.push_str(&format!(" [{}],", celdas.join("\n")));
            }
        }
        t.push_str("\n");
    }
    t.push_str(")\n");
    t
}

fn generar_tabla_master_typst(
    turnos: &[Shift],
    dia: &str,
    aulas: &[String],
    mostrar_semanas: bool,
    types: &[NameAndTag],
    subjects: &[NameAndTag],
) -> String {
    let intervalos = build_intervalos_master(turnos, dia);
    let etiquetas = generar_etiquetas_intervalos(&intervalos);

    let mut t = String::new();

    t.push_str(&format!(
        "#text(weight: \"bold\", size: 11pt)[{}]\n",
        dia.to_uppercase()
    ));
    t.push_str("#v(4pt)\n");

    let cols = std::iter::once("90pt".to_string())
        .chain(std::iter::repeat("1fr".to_string()).take(intervalos.len()))
        .collect::<Vec<_>>()
        .join(", ");

    t.push_str(&format!(
        "#table(\n  columns: ({}),\n  align: center + horizon,\n  stroke: 0.5pt + rgb(\"#bdc3c7\"),\n  fill: (col, row) => if row == 0 {{ rgb(\"#ecf0f1\") }} else if calc.even(row) {{ rgb(\"#ffffff\") }} else {{ rgb(\"#f9f9f9\") }},\n  inset: 4pt,\n",
        cols
    ));

    t.push_str("  [#text(weight: \"bold\", fill: rgb(\"#2c3e50\"))[AULA]],");
    for (ini, fin) in &intervalos {
        let label = etiquetas
            .get(&format!("{ini}-{fin}"))
            .cloned()
            .unwrap_or_default();
        t.push_str(&format!(
            "  [#text(weight: \"bold\", fill: rgb(\"#2c3e50\"))[Turno {label}\\\n#text(size: 7pt, weight: \"regular\")[{ini} - {fin}]]],"
        ));
    }
    t.push_str("\n");

    for aula in aulas {
        t.push_str(&format!(
            "  [#text(weight: \"bold\", fill: rgb(\"#2c3e50\"))[{aula}]],"
        ));

        for (ini, fin) in &intervalos {
            let mut celdas: Vec<String> = Vec::new();

            for turno in turnos {
                if turno.day == *dia && turno.room == *aula && turno.start_time == *ini {
                    let t_fin = if turno.schedule_type == "estandar" {
                        BLOQUES_ESTANDAR
                            .iter()
                            .find(|b| b.0 == turno.start_time)
                            .map(|b| b.1.to_string())
                            .unwrap_or_default()
                    } else {
                        calcular_hora_fin(&turno.start_time, turno.duration_min)
                    };

                    if t_fin == *fin {
                        let subj_tag = subject_tag(&turno.subject, subjects);
                        let color = generar_color_pastel(&subj_tag);
                        let kind = kind_tag(&turno.kind, types);
                        let texto = if mostrar_semanas {
                            let sems = acortar_semanas(&turno.weeks);
                            format!("{} {} (Sem: {})", turno.group, subj_tag, sems)
                        } else {
                            format!("{} {} [{}]", turno.group, subj_tag, kind)
                        };

                        celdas.push(format!(
                            "#card_master(\"{}\", \"{}\")",
                            texto.replace('"', "\\\""),
                            color
                        ));
                    }
                }
            }

            if celdas.is_empty() {
                t.push_str(" [],");
            } else {
                t.push_str(&format!(" [{}],", celdas.join("\n")));
            }
        }
        t.push_str("\n");
    }
    t.push_str(")\n");
    t
}

fn compile_typ_to_pdf(
    typst_cmd: &str,
    content: &str,
    pdf_path: &Path,
    keep_typ: bool,
) -> Result<(), String> {
    let typ_path = pdf_path.with_extension("typ");
    fs::write(&typ_path, content).map_err(|e| format!("Error al escribir {typ_path:?}: {e}"))?;

    let mut cmd = Command::new(typst_cmd);
    cmd.args([
        "compile",
        &typ_path.to_string_lossy(),
        &pdf_path.to_string_lossy(),
    ]);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }

    let status = cmd
        .status()
        .map_err(|e| format!("Error al ejecutar Typst: {e}"))?;

    if !status.success() {
        return Err(format!("Typst falló al compilar {}", pdf_path.display()));
    }

    if !keep_typ {
        let _ = fs::remove_file(&typ_path);
    }

    Ok(())
}

/// Maps a kind name to its tag (diminutivo) if found; otherwise returns the original.
fn kind_tag(kind: &str, types: &[NameAndTag]) -> String {
    types
        .iter()
        .find(|t| t.name == kind || t.tag == kind)
        .map(|t| t.tag.clone())
        .unwrap_or_else(|| kind.to_string())
}

/// Maps a subject name to its tag (diminutivo) if found; otherwise returns the original.
fn subject_tag(subject: &str, subjects: &[NameAndTag]) -> String {
    subjects
        .iter()
        .find(|s| s.name == subject || s.tag == subject)
        .map(|s| s.tag.clone())
        .unwrap_or_else(|| subject.to_string())
}

/// Generates the Typst legend section: types and subjects side by side.
fn generar_leyenda(
    used_types: &[&NameAndTag],
    used_subjects: &[&NameAndTag],
) -> String {
    fn table_typst(title: &str, items: &[&NameAndTag]) -> String {
        let mut o = String::new();
        o.push_str(&format!("#text(weight: \"bold\", size: 9pt)[{title}]\n"));
        o.push_str("#table(\n  columns: (auto, 1fr),\n  align: left,\n  stroke: 0.5pt + rgb(\"#cccccc\"),\n  fill: (col, row) => if row == 0 { rgb(\"#ecf0f1\") } else if calc.even(row) { rgb(\"#ffffff\") } else { rgb(\"#f9f9f9\") },\n  inset: 4pt,\n");
        o.push_str("  [#text(weight: \"bold\", size: 8pt, fill: rgb(\"#2c3e50\"))[Dim.]], [#text(weight: \"bold\", size: 8pt, fill: rgb(\"#2c3e50\"))[Nombre]],\n");
        for item in items {
            o.push_str(&format!("  [{}], [{}],\n", item.tag, item.name));
        }
        o.push_str(")\n");
        o
    }

    let mut out = String::new();
    out.push_str("#pagebreak()\n");
    out.push_str("#titulo(\"Leyenda\")\n\n");
    out.push_str("#grid(\n  columns: (1fr, 1fr),\n  column-gutter: 16pt,\n  align: top,\n");
    out.push_str(&format!("  [{}],", table_typst("Tipos de clase", used_types)));
    out.push_str(&format!("  [{}],", table_typst("Asignaturas", used_subjects)));
    out.push_str(")\n");
    out
}

/// Collects unique types and subjects present in a slice of shifts, sorted by tag.
fn collect_used_items<'a>(
    shifts: &[Shift],
    all_types: &'a [NameAndTag],
    all_subjects: &'a [NameAndTag],
) -> (Vec<&'a NameAndTag>, Vec<&'a NameAndTag>) {
    let mut type_set: HashSet<&str> = HashSet::new();
    let mut subj_set: HashSet<&str> = HashSet::new();
    for shift in shifts {
        type_set.insert(&shift.kind);
        subj_set.insert(&shift.subject);
    }
    let mut used_types: Vec<&NameAndTag> = all_types
        .iter()
        .filter(|t| type_set.contains(t.name.as_str()) || type_set.contains(t.tag.as_str()))
        .collect();
    used_types.sort_by(|a, b| a.tag.cmp(&b.tag));
    let mut used_subjects: Vec<&NameAndTag> = all_subjects
        .iter()
        .filter(|s| subj_set.contains(s.name.as_str()) || subj_set.contains(s.tag.as_str()))
        .collect();
    used_subjects.sort_by(|a, b| a.tag.cmp(&b.tag));
    (used_types, used_subjects)
}

/// Main entry point for PDF export.
pub fn run_export(
    shifts: &[Shift],
    dest_dir: &Path,
    _period: &str,
    keep_typ: bool,
    app: &AppHandle,
    types: &[NameAndTag],
    subjects: &[NameAndTag],
) -> Result<(), String> {
    let typst_cmd = find_typst().ok_or_else(|| {
        "No se encontró Typst en su Sistema. Verifique que tiene el ejecutable en la misma carpeta de la aplicación."
            .to_string()
    })?;

    // Group shifts by year → career → group
    // 2-char groups (e.g. "21") expand to sub-groups (e.g. "211", "212")
    // based on existing 3-char groups with the same prefix in that (year, career).

    // First pass: collect all group names per (year, career)
    let mut all_groups: HashMap<(u32, String), HashSet<String>> = HashMap::new();
    for shift in shifts {
        all_groups
            .entry((shift.year, shift.career.clone()))
            .or_default()
            .insert(shift.group.clone());
    }

    // Build expansion map: (year, career, 2-char prefix) → [suffix digits]
    let mut expansion: HashMap<(u32, String, String), Vec<u32>> = HashMap::new();
    for ((year, career), groups) in &all_groups {
        for g in groups {
            if g.len() == 3 {
                let prefix: String = g.chars().take(2).collect();
                let suffix: u32 = g
                    .chars()
                    .skip(2)
                    .next()
                    .and_then(|c| c.to_digit(10))
                    .unwrap_or(0);
                expansion
                    .entry((*year, career.clone(), prefix))
                    .or_default()
                    .push(suffix);
            }
        }
    }

    // Second pass: build structure with expansion
    let mut structure: HashMap<u32, HashMap<String, HashMap<String, Vec<Shift>>>> = HashMap::new();
    for shift in shifts {
        let g = &shift.group;
        if g.len() == 2 {
            if let Some(suffixes) = expansion.get(&(shift.year, shift.career.clone(), g.clone())) {
                for &suffix in suffixes {
                    let sub_g = format!("{g}{suffix}");
                    structure
                        .entry(shift.year)
                        .or_default()
                        .entry(shift.career.clone())
                        .or_default()
                        .entry(sub_g)
                        .or_default()
                        .push(shift.clone());
                }
            } else {
                // No 3-char sub-groups found, use 2-char as-is
                structure
                    .entry(shift.year)
                    .or_default()
                    .entry(shift.career.clone())
                    .or_default()
                    .entry(g.clone())
                    .or_default()
                    .push(shift.clone());
            }
        } else {
            structure
                .entry(shift.year)
                .or_default()
                .entry(shift.career.clone())
                .or_default()
                .entry(g.clone())
                .or_default()
                .push(shift.clone());
        }
    }

    // Collect all jobs: (typ_content, pdf_path)
    let mut jobs: Vec<(String, std::path::PathBuf)> = Vec::new();

    // All rooms from all shifts (used in every document's legend)
    let mut aulas: Vec<String> = shifts.iter().map(|s| s.room.clone()).collect();
    aulas.sort();
    aulas.dedup();

    let mut sorted_years: Vec<u32> = structure.keys().cloned().collect();
    sorted_years.sort();

    for year in sorted_years {
        let careers = structure.remove(&year).unwrap();
        let mut sorted_careers: Vec<String> = careers.keys().cloned().collect();
        sorted_careers.sort();
        let year_str = ordinal_year(year);

        for career_name in &sorted_careers {
            let groups = &careers[career_name];
            let mut sorted_groups: Vec<String> = groups.keys().cloned().collect();
            sorted_groups.sort();

            let career_dir = dest_dir.join(&year_str).join(career_name);
            fs::create_dir_all(&career_dir)
                .map_err(|e| format!("Error al crear directorio {career_dir:?}: {e}"))?;

            for group in &sorted_groups {
                let turnos_grupo = &groups[group];
                let (used_types, used_subjects) = collect_used_items(turnos_grupo, types, subjects);

                // Horario completo
                let mut typ = escribir_preambulo_typst();
                typ.push_str(&format!(
                    "#titulo(\"Horario Consolidado: {career_name} - {year_str} - Grupo {group}\")\n",
                ));
                typ.push_str(&generar_tabla_grupo_typst(turnos_grupo, None, types, subjects));
                typ.push_str(&generar_leyenda(&used_types, &used_subjects));
                let path = career_dir.join(format!("Horario completo grupo {group}.pdf"));
                jobs.push((typ, path));

                // Horario por semanas
                let mut typ = escribir_preambulo_typst();
                typ.push_str(&format!(
                    "#titulo(\"Horario por Semanas: {career_name} - {year_str} - Grupo {group}\")\n",
                ));
                for s in 1..=16 {
                    typ.push_str("#pagebreak()\n");
                    typ.push_str(&format!("#titulo(\"Semana {s}\")\n"));
                    typ.push_str(&generar_tabla_grupo_typst(turnos_grupo, Some(s), types, subjects));
                }
                typ.push_str(&generar_leyenda(&used_types, &used_subjects));
                let path = career_dir.join(format!("Horario por semanas grupo {group}.pdf"));
                jobs.push((typ, path));
            }
        }
    }

    // Master jobs
    // Horario General Aulas.pdf (consolidated)
    {
        let mut typ = escribir_preambulo_typst();
        let (used_types, used_subjects) = collect_used_items(shifts, types, subjects);
        for (i, dia) in DIAS.iter().enumerate() {
            typ.push_str("#titulo(\"Horario General de Aulas (Consolidado)\")\n");
            typ.push_str(&generar_tabla_master_typst(shifts, dia, &aulas, true, types, subjects));
            if i < DIAS.len() - 1 {
                typ.push_str("#pagebreak()\n\n");
            }
        }
        typ.push_str(&generar_leyenda(&used_types, &used_subjects));
        jobs.push((typ, dest_dir.join("Horario General Aulas.pdf")));
    }

    // Horario Aulas por Semanas.pdf
    {
        let mut typ = escribir_preambulo_typst();
        let (used_types, used_subjects) = collect_used_items(shifts, types, subjects);
        for s in 1..=16 {
            let turnos_semana: Vec<Shift> = shifts
                .iter()
                .filter(|t| t.weeks.contains(&s))
                .cloned()
                .collect();
            if turnos_semana.is_empty() {
                continue;
            }
            for (i, dia) in DIAS.iter().enumerate() {
                typ.push_str(&format!(
                    "#titulo(\"Horario General de Aulas - Semana {s}\")\n"
                ));
                typ.push_str(&generar_tabla_master_typst(
                    &turnos_semana,
                    dia,
                    &aulas,
                    false,
                    types,
                    subjects,
                ));
                if i < DIAS.len() - 1 {
                    typ.push_str("#pagebreak()\n\n");
                }
            }
            if s < 16 {
                typ.push_str("#pagebreak()\n\n");
            }
        }
        typ.push_str(&generar_leyenda(&used_types, &used_subjects));
        jobs.push((typ, dest_dir.join("Horario Aulas por Semanas.pdf")));
    }

    // Parallel compilation phase
    let total = jobs.len() as u32;
    emit_progress(app, 0, total, "Compilando PDFs…");

    let completed = AtomicU32::new(0);
    let errors = Mutex::new(Vec::new());

    std::thread::scope(|s| {
        for (typ_content, pdf_path) in &jobs {
            let completed = &completed;
            let errors = &errors;
            s.spawn(|| {
                if let Err(e) = compile_typ_to_pdf(&typst_cmd, typ_content, pdf_path, keep_typ) {
                    errors.lock().unwrap().push(e);
                }
                let c = completed.fetch_add(1, Ordering::SeqCst) + 1;
                emit_progress(app, c, total, &format!("Compilando {c}/{total}…"));
            });
        }
    });

    let errs = errors.into_inner().unwrap();
    if !errs.is_empty() {
        return Err(format!("Errores al compilar:\n  {}", errs.join("\n  ")));
    }

    emit_progress(app, total, total, "¡Finalizado!");
    Ok(())
}
