use chrono::{Duration, NaiveTime};
use md5::{Digest, Md5};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::process::Command;

const BLOQUES_ESTANDAR: &[(&str, &str)] = &[
    ("08:30", "10:05"),
    ("10:10", "11:45"),
    ("11:50", "13:25"),
    ("13:35", "15:10"),
    ("15:15", "16:50"),
    ("16:55", "18:30"),
];

const DIAS: &[&str] = &["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

#[derive(Debug, Deserialize, Clone)]
struct Turno {
    id: Option<u32>,
    carrera: String,
    anio: u32,
    grupo: String,
    asignatura: String,
    tipo: String,
    dia: String,
    #[serde(default)]
    semanas: Vec<u32>,
    aula: String,
    horario_tipo: String,
    bloque: Option<u32>,
    hora_inicio: String,
    duracion_min: u32,
}

#[derive(Debug, Deserialize, Clone)]
struct DatosHorario {
    prox_id: Option<u32>,
    turnos: Vec<Turno>,
}

#[derive(Hash, Eq, PartialEq, Ord, PartialOrd, Clone)]
struct Intervalo {
    inicio: String,
    fin: String,
}

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

    // Reducimos un poco la luminosidad base para que el borde izquierdo resalte bien
    let (r, g, b) = hls_to_rgb(hue, 0.65, 0.80);
    format!("#{:02x}{:02x}{:02x}", r, g, b)
}

fn calcular_hora_fin(inicio_str: &str, duracion_min: u32) -> String {
    let time = NaiveTime::parse_from_str(inicio_str, "%H:%M").unwrap();
    let end_time = time + Duration::minutes(duracion_min as i64);
    end_time.format("%H:%M").to_string()
}

fn generar_tabla_master_typst(
    turnos_filtrados: &[Turno],
    dia: &str,
    aulas: &[String],
    intervalos: &[Intervalo],
    mostrar_semanas: bool,
) -> String {
    let mut t = String::new();

    let cols = std::iter::once("65pt".to_string())
        .chain(std::iter::repeat("1fr".to_string()).take(aulas.len()))
        .collect::<Vec<_>>()
        .join(", ");

    // Configuración avanzada de la tabla con estilos en función de filas/columnas
    t.push_str(&format!(
        "#table(\n  columns: ({}),\n  align: center + horizon,\n  stroke: 0.5pt + rgb(\"#cbd5e1\"),\n  fill: (col, row) => if row == 0 {{ rgb(\"#1e293b\") }} else if calc.even(row) {{ rgb(\"#f8fafc\") }} else {{ rgb(\"#ffffff\") }},\n  inset: 5pt,\n", 
        cols
    ));

    // Encabezados con texto blanco
    t.push_str("  [#text(fill: white, weight: \"bold\")[Hora]]");
    for aula in aulas {
        t.push_str(&format!(", [#text(fill: white, weight: \"bold\")[{aula}]]"));
    }
    t.push_str(",\n");

    for intv in intervalos {
        // Formato limpio para la columna de horas
        t.push_str(&format!(
            "  [#text(weight: \"medium\", fill: rgb(\"#475569\"))[{}\n{}]],",
            intv.inicio, intv.fin
        ));

        for aula in aulas {
            let mut celdas = Vec::new();

            for turno in turnos_filtrados {
                if turno.dia == *dia && turno.aula == *aula && turno.hora_inicio == intv.inicio {
                    let fin_calc = if turno.horario_tipo == "estandar" {
                        BLOQUES_ESTANDAR
                            .iter()
                            .find(|b| b.0 == turno.hora_inicio)
                            .map(|b| b.1.to_string())
                            .unwrap_or_default()
                    } else {
                        calcular_hora_fin(&turno.hora_inicio, turno.duracion_min)
                    };

                    if fin_calc == intv.fin {
                        let color = generar_color_pastel(&turno.asignatura);

                        let identificador = if turno.grupo.len() == 2 {
                            format!("Año {}", turno.grupo)
                        } else {
                            format!("Gr: {}", turno.grupo)
                        };

                        let meta = if mostrar_semanas {
                            format!(
                                "{} | Sem: {}",
                                identificador,
                                acortar_semanas(&turno.semanas)
                            )
                        } else {
                            identificador
                        };

                        celdas.push(format!(
                            "#card(\"{}\", \"{}\", \"{}\", \"{}\")",
                            color, turno.asignatura, turno.tipo, meta
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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let file = fs::read_to_string("Test.json")?;
    let data: DatosHorario = serde_json::from_str(&file)?;

    let mut aulas: Vec<String> = data.turnos.iter().map(|t| t.aula.clone()).collect();
    aulas.sort();
    aulas.dedup();

    let mut intervalos_set = HashSet::new();
    for &(ini, fin) in BLOQUES_ESTANDAR {
        intervalos_set.insert(Intervalo {
            inicio: ini.to_string(),
            fin: fin.to_string(),
        });
    }

    for t in &data.turnos {
        let fin = if t.horario_tipo == "estandar" {
            BLOQUES_ESTANDAR
                .iter()
                .find(|b| b.0 == t.hora_inicio)
                .map(|b| b.1.to_string())
                .unwrap_or_default()
        } else {
            calcular_hora_fin(&t.hora_inicio, t.duracion_min)
        };
        intervalos_set.insert(Intervalo {
            inicio: t.hora_inicio.clone(),
            fin,
        });
    }

    let mut intervalos: Vec<Intervalo> = intervalos_set.into_iter().collect();
    intervalos.sort();

    let mut out = String::new();
    // Configuración global de página y márgenes óptimos
    out.push_str("#set page(\"a4\", flipped: true, margin: (x: 1.2cm, y: 1cm))\n");
    out.push_str("#set text(font: \"Liberation Sans\", size: 8.5pt, fill: rgb(\"#1e293b\"))\n\n");

    // Macro de la tarjeta con estilo moderno: fondo claro + borde izquierdo acentuado
    // Macro de la tarjeta con estilo moderno: fondo claro + borde izquierdo acentuado
    out.push_str("#let card(color, asig, tipo, meta) = block(\n");
    out.push_str("  fill: rgb(color).lighten(85%),\n");
    out.push_str("  stroke: (left: 3.5pt + rgb(color), rest: 0.5pt + rgb(\"#e2e8f0\")),\n");
    out.push_str("  width: 100%,\n");
    out.push_str("  inset: (x: 6pt, y: 5pt),\n");
    out.push_str("  radius: (right: 3pt)\n"); // <-- Se elimina la coma final
    out.push_str(")[#align(left)[ \n"); // <-- Aplicamos la alineación internamente
    out.push_str("  #text(weight: \"bold\", size: 9pt, fill: rgb(\"#0f172a\"))[#asig]\n");
    out.push_str("  #v(2pt)\n");
    out.push_str("  #text(size: 7.5pt, fill: rgb(\"#475569\"))[[#tipo]  #meta]\n");
    out.push_str("]]\n\n");

    // Estilo para los títulos de sección
    out.push_str("#let titulo(texto) = {\n");
    out.push_str("  text(size: 14pt, weight: \"bold\", fill: rgb(\"#0f172a\"))[#texto]\n");
    out.push_str("  v(8pt)\n");
    out.push_str("}\n\n");

    // Generar Consolidado
    for (i, dia) in DIAS.iter().enumerate() {
        out.push_str(&format!(
            "#titulo(\"Horario General de Aulas (Consolidado) — {}\")\n",
            dia
        ));
        out.push_str(&generar_tabla_master_typst(
            &data.turnos,
            dia,
            &aulas,
            &intervalos,
            true,
        ));
        out.push_str("#pagebreak()\n\n");
    }

    // Generar Semanas 1 a 16
    for s in 1..=16 {
        let turnos_semana: Vec<Turno> = data
            .turnos
            .iter()
            .filter(|t| t.semanas.contains(&s))
            .cloned()
            .collect();

        for (i, dia) in DIAS.iter().enumerate() {
            out.push_str(&format!(
                "#titulo(\"Horario General de Aulas — Semana {} — {}\")\n",
                s, dia
            ));
            out.push_str(&generar_tabla_master_typst(
                &turnos_semana,
                dia,
                &aulas,
                &intervalos,
                false,
            ));

            if !(s == 16 && i == DIAS.len() - 1) {
                out.push_str("#pagebreak()\n\n");
            }
        }
    }

    fs::write("reporte.typ", &out)?;
    println!("Archivo reporte.typ actualizado con diseño premium.");
    println!("Compilando PDF usando el binario empaquetado...");

    // Obtenemos la ruta del ejecutable actual para buscar typst.exe en su misma carpeta
    let mut ruta_typst = std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("."));
    ruta_typst.pop(); // Quitamos el nombre de nuestra app, nos quedamos con la carpeta
    ruta_typst.push("typst.exe"); // Apuntamos al typst.exe local

    // Si el typst.exe local no existe (por si estás probando en Linux nativo con cargo run),
    // usamos el "typst" del sistema como plan de respaldo.
    let comando = if ruta_typst.exists() {
        ruta_typst.to_string_lossy().into_owned()
    } else {
        "typst".to_string()
    };

    let status = Command::new(comando)
        .args(["compile", "reporte.typ", "reporte.pdf"])
        .status()?;

    if status.success() {
        println!("¡Éxito! El 'reporte.pdf' se ha generado correctamente usando el binario local.");
    } else {
        println!("Error en la ejecución de Typst.");
    }

    Ok(())
}
