import hashlib
import os
import colorsys
from datetime import datetime, timedelta

from xhtml2pdf import pisa

# Configuración base
BLOQUES_ESTANDAR = [
    {"inicio": "08:30", "fin": "10:05"},
    {"inicio": "10:10", "fin": "11:45"},
    {"inicio": "11:50", "fin": "13:25"},
    {"inicio": "13:35", "fin": "15:10"},
    {"inicio": "15:15", "fin": "16:50"},
    {"inicio": "16:55", "fin": "18:30"},
]
DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]


def acortar_semanas(semanas):
    if not semanas:
        return ""
    semanas = sorted(list(set(semanas)))
    rangos = []
    inicio = semanas[0]
    anterior = semanas[0]

    for s in semanas[1:] + [None]:
        if s != anterior + 1:
            if inicio == anterior:
                rangos.append(str(inicio))
            else:
                rangos.append(f"{inicio}-{anterior}")
            inicio = s
        anterior = s
    return ", ".join(rangos)


def generar_color_pastel(texto):
    """Genera colores pasteles en formato HEX, compatible con xhtml2pdf"""
    hash_obj = hashlib.md5(texto.encode("utf-8"))
    hue = (int(hash_obj.hexdigest(), 16) % 360) / 360.0
    # Ligereza 85% (0.85), Saturación 70% (0.7)
    r, g, b = colorsys.hls_to_rgb(hue, 0.85, 0.70)
    return f"#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}"


def calcular_hora_fin(inicio_str, duracion_min):
    formato = "%H:%M"
    inicio_dt = datetime.strptime(inicio_str, formato)
    fin_dt = inicio_dt + timedelta(minutes=duracion_min)
    return fin_dt.strftime(formato)


def generar_etiquetas_intervalos(intervalos):
    """Genera nomenclatura 1, 2, 3 para estandar y 1.1, 1.2 para personalizados"""
    std_map = {
        (b["inicio"], b["fin"]): str(i + 1) for i, b in enumerate(BLOQUES_ESTANDAR)
    }
    etiquetas = {}
    last_std = 0
    sub_count = 1

    for ini, fin in intervalos:
        if (ini, fin) in std_map:
            label = std_map[(ini, fin)]
            etiquetas[(ini, fin)] = label
            last_std = int(label)
            sub_count = 1
        else:
            etiquetas[(ini, fin)] = f"{last_std}.{sub_count}"
            sub_count += 1

    return etiquetas


def obtener_estilos_css():
    """Estilos adaptados a las limitaciones de xhtml2pdf (CSS 2.1)"""
    return """
    <style>
        @page { size: a4 landscape; margin: 1cm; }
        body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 11px; margin: 0; color: #333; }

        .titulo {
            background-color: #2c3e50;
            color: white;
            padding: 15px;
            text-align: center;
            font-size: 16px;
            font-weight: bold;
            margin: 0 0 15px 0;
            display: block;
            page-break-after: avoid;
            border-radius: 4px;
        }

        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #bdc3c7; padding: 6px; text-align: center; overflow: hidden; vertical-align: top; }
        th { background-color: #ecf0f1; color: #2c3e50; font-weight: bold; }

        .col-hora { width: 80px; font-weight: bold; background-color: #f9f9f9; vertical-align: middle; }
        .col-aula { width: 90px; font-weight: bold; background-color: #f9f9f9; vertical-align: middle; }

        /* Eliminado flexbox, se usa block con margins para simular el gap */
        .celda-flex { display: block; width: 100%; }
        .card { 
            border: 1px solid #cccccc; 
            border-radius: 3px; 
            padding: 4px; 
            text-align: left; 
            margin-bottom: 4px; 
        }
        .card-asig { font-weight: bold; border-bottom: 1px solid #dddddd; margin-bottom: 2px; padding-bottom: 2px; }
        .card-tipo { font-style: italic; font-size: 0.9em; float: right; }
        .card-meta { font-size: 0.85em; color: #444; }

        .card-master { 
            border: 1px solid #cccccc; 
            border-radius: 3px; 
            padding: 5px; 
            font-size: 0.9em; 
            text-align: center; 
            font-weight: bold;
            margin-bottom: 4px;
        }
        
        h3 { font-size: 14px; text-align: left; margin-bottom: 5px; color: #2c3e50; border-bottom: 1px solid #2c3e50; padding-bottom: 3px;}
        .dia-container { margin-bottom: 20px; page-break-inside: avoid; }
    </style>
    """


def generar_pdf_desde_html(html_content, ruta_salida):
    """Función auxiliar para generar PDF con xhtml2pdf"""
    with open(ruta_salida, "w+b") as result_file:
        pisa_status = pisa.CreatePDF(html_content, dest=result_file)
    return pisa_status.err


def generar_tabla_html(turnos_grupo, titulo_adicional="", semana_filtro=None):
    """Genera la tabla normal para un grupo específico"""
    intervalos = set((b["inicio"], b["fin"]) for b in BLOQUES_ESTANDAR)
    for t in turnos_grupo:
        if t.get("horario_tipo") != "estandar":
            inicio = t.get("hora_inicio")
            fin = calcular_hora_fin(inicio, t.get("duracion_min", 90))
            intervalos.add((inicio, fin))

    intervalos = sorted(list(intervalos), key=lambda x: x[0])

    html = ""
    if titulo_adicional:
        html += f"<h3>{titulo_adicional}</h3>"

    html += "<table><thead><tr><th class='col-hora'>Hora</th>"
    for d in DIAS:
        html += f"<th>{d}</th>"
    html += "</tr></thead><tbody>"

    for ini, fin in intervalos:
        html += f"<tr><td class='col-hora'>{ini}-{fin}</td>"
        for dia in DIAS:
            html += "<td><div class='celda-flex'>"
            for t in turnos_grupo:
                t_ini = t.get("hora_inicio")
                t_fin = (
                    calcular_hora_fin(t_ini, t.get("duracion_min", 90))
                    if t.get("horario_tipo") != "estandar"
                    else next(
                        b["fin"] for b in BLOQUES_ESTANDAR if b["inicio"] == t_ini
                    )
                )

                if t.get("dia") == dia and t_ini == ini and t_fin == fin:
                    if semana_filtro is None or semana_filtro in t.get("semanas", []):
                        asig = t.get("asignatura", "S/A")
                        color = generar_color_pastel(asig)
                        semanas_txt = acortar_semanas(t.get("semanas", []))
                        html += f"""
                        <div class="card" style="background-color: {color}">
                            <div class="card-asig">
                                {asig} <span class="card-tipo">[{t.get("tipo", "")}]</span>
                            </div>
                            <div class="card-meta">
                                Aula: {t.get("aula", "S/A")} | Sem: {semanas_txt}
                            </div>
                        </div>
                        """
            html += "</div></td>"
        html += "</tr>"
    html += "</tbody></table>"
    return html


def generar_tabla_master_html(turnos_filtrados, dia, aulas, mostrar_semanas=False):
    """Genera la tabla general de Aulas vs Horarios para un Día específico"""
    intervalos = set()
    for b in BLOQUES_ESTANDAR:
        intervalos.add((b["inicio"], b["fin"]))

    for t in turnos_filtrados:
        if t.get("dia") == dia:
            ini = t.get("hora_inicio")
            if t.get("horario_tipo") == "estandar":
                fin = next(b["fin"] for b in BLOQUES_ESTANDAR if b["inicio"] == ini)
            else:
                fin = calcular_hora_fin(ini, t.get("duracion_min", 90))
            intervalos.add((ini, fin))

    intervalos = sorted(list(intervalos), key=lambda x: (x[0], x[1]))
    etiquetas = generar_etiquetas_intervalos(intervalos)

    html = f"<div class='dia-container'><h3>{dia.upper()}</h3>"
    html += "<table><thead><tr><th class='col-aula'>AULA</th>"

    for ini, fin in intervalos:
        lbl = etiquetas[(ini, fin)]
        html += f"<th>Turno {lbl}<br><span style='font-weight:normal; font-size:0.9em'>{ini} - {fin}</span></th>"
    html += "</tr></thead><tbody>"

    for aula in aulas:
        html += f"<tr><td class='col-aula'>{aula}</td>"
        for ini, fin in intervalos:
            turnos_celda = []
            for t in turnos_filtrados:
                if t.get("dia") == dia and t.get("aula") == aula:
                    t_ini = t.get("hora_inicio")
                    if t.get("horario_tipo") == "estandar":
                        t_fin = next(
                            b["fin"] for b in BLOQUES_ESTANDAR if b["inicio"] == t_ini
                        )
                    else:
                        t_fin = calcular_hora_fin(t_ini, t.get("duracion_min", 90))

                    if t_ini == ini and t_fin == fin:
                        turnos_celda.append(t)

            html += "<td><div class='celda-flex'>"
            for t in turnos_celda:
                color = generar_color_pastel(t.get("asignatura", ""))

                if mostrar_semanas:
                    sems = acortar_semanas(t.get("semanas", []))
                    texto = f"{t.get('grupo')} {t.get('asignatura')} (Sem: {sems})"
                else:
                    texto = f"{t.get('grupo')} {t.get('asignatura')} [{t.get('tipo')}]"

                html += f"<div class='card-master' style='background-color: {color}'>{texto}</div>"
            html += "</div></td>"
        html += "</tr>"
    html += "</tbody></table></div>"
    return html


def exportar_todo(turnos, directorio_base, progress_callback=None, config=None):
    estructura = {}
    for t in turnos:
        anio = f"{t.get('anio', 1)}er año"
        carrera = t.get("carrera", "General")
        g_str = str(t.get("grupo", "G1"))

        if len(g_str) == 2 and config:
            info = config.get_carrera_info(carrera)
            max_g = int(info.get("grupos", 2))
            for i in range(1, max_g + 1):
                sub_g = f"{g_str}{i}"
                estructura.setdefault(anio, {}).setdefault(carrera, {}).setdefault(
                    sub_g, []
                ).append(t)
        else:
            estructura.setdefault(anio, {}).setdefault(carrera, {}).setdefault(
                g_str, []
            ).append(t)

    aulas_todas = sorted(
        list(set(t.get("aula", "S/A") for t in turnos if t.get("aula")))
    )

    total_pdfs = 2
    for carreras in estructura.values():
        for grupos in carreras.values():
            total_pdfs += len(grupos) * 2

    pdf_actual = 0

    # 1. GENERAR PDFs POR GRUPOS
    for anio, carreras in estructura.items():
        for carrera, grupos in carreras.items():
            ruta_carpeta = os.path.join(directorio_base, anio, carrera)
            os.makedirs(ruta_carpeta, exist_ok=True)

            for grupo, turnos_grupo in grupos.items():
                if progress_callback:
                    progress_callback(
                        pdf_actual,
                        total_pdfs,
                        f"Generando: {carrera} (G{grupo}) - Completo",
                    )
                
                html_comp = f"<html><head>{obtener_estilos_css()}</head><body>"
                html_comp += f"<div class='titulo'>Horario Consolidado: {carrera} - {anio} - Grupo {grupo}</div>"
                html_comp += generar_tabla_html(turnos_grupo)
                html_comp += "</body></html>"
                
                generar_pdf_desde_html(
                    html_comp, 
                    os.path.join(ruta_carpeta, f"Horario completo grupo {grupo}.pdf")
                )
                pdf_actual += 1

                if progress_callback:
                    progress_callback(
                        pdf_actual,
                        total_pdfs,
                        f"Generando: {carrera} (G{grupo}) - Semanas",
                    )
                
                html_sem = f"<html><head>{obtener_estilos_css()}</head><body>"
                html_sem += f"<div class='titulo'>Horario por Semanas: {carrera} - {anio} - Grupo {grupo}</div>"
                for s in range(1, 17):
                    html_sem += generar_tabla_html(turnos_grupo, f"Semana {s}", semana_filtro=s)
                    if s < 16:
                        html_sem += "<pdf:nextpage />"
                html_sem += "</body></html>"
                
                generar_pdf_desde_html(
                    html_sem, 
                    os.path.join(ruta_carpeta, f"Horario por semanas grupo {grupo}.pdf")
                )
                pdf_actual += 1

    # 2. GENERAR PDFs MASTER (AULAS)
    if progress_callback:
        progress_callback(
            pdf_actual, total_pdfs, "Generando Sábana General de Aulas..."
        )

    html_master_comp = f"<html><head>{obtener_estilos_css()}</head><body>"
    for i, dia in enumerate(DIAS):
        html_master_comp += "<div class='titulo'>Horario General de Aulas (Consolidado)</div>"
        html_master_comp += generar_tabla_master_html(
            turnos, dia, aulas_todas, mostrar_semanas=True
        )
        if i < len(DIAS) - 1:
            html_master_comp += "<pdf:nextpage />"
    html_master_comp += "</body></html>"
    
    generar_pdf_desde_html(
        html_master_comp, 
        os.path.join(directorio_base, "Horario General Aulas.pdf")
    )
    pdf_actual += 1

    if progress_callback:
        progress_callback(
            pdf_actual, total_pdfs, "Generando Sábana de Aulas por Semanas..."
        )

    html_master_sem = f"<html><head>{obtener_estilos_css()}</head><body>"
    for s in range(1, 17):
        turnos_semana = [t for t in turnos if s in t.get("semanas", [])]
        for i, dia in enumerate(DIAS):
            html_master_sem += f"<div class='titulo'>Horario General de Aulas - Semana {s}</div>"
            html_master_sem += generar_tabla_master_html(
                turnos_semana, dia, aulas_todas, mostrar_semanas=False
            )
            if i < len(DIAS) - 1:
                html_master_sem += "<pdf:nextpage />"

        if s < 16:
            html_master_sem += "<pdf:nextpage />"

    html_master_sem += "</body></html>"
    
    generar_pdf_desde_html(
        html_master_sem, 
        os.path.join(directorio_base, "Horario Aulas por Semanas.pdf")
    )
    pdf_actual += 1

    if progress_callback:
        progress_callback(total_pdfs, total_pdfs, "¡Finalizado!")
    return True