import hashlib
import os
from datetime import datetime, timedelta

from weasyprint import HTML

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
    """Convierte [1,2,3,5] en '1-3, 5'."""
    if not semanas:
        return ""
    semanas = sorted(list(set(semanas)))
    rangos = []
    if not semanas:
        return ""

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
    hash_obj = hashlib.md5(texto.encode("utf-8"))
    hue = int(hash_obj.hexdigest(), 16) % 360
    return f"hsl({hue}, 70%, 85%)"


def calcular_hora_fin(inicio_str, duracion_min):
    formato = "%H:%M"
    inicio_dt = datetime.strptime(inicio_str, formato)
    fin_dt = inicio_dt + timedelta(minutes=duracion_min)
    return fin_dt.strftime(formato)


def obtener_estilos_css():
    return """
    <style>
        @page { size: A4 landscape; margin: 1cm; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11px; margin: 0; color: #333; }

        /* Título simplificado: texto más grande y en negritas */
        .titulo { font-size: 16px; font-weight: bold; text-align: center; margin: 10px 0 20px 0; }

        table { width: 100%; border-collapse: collapse; table-layout: fixed; page-break-inside: avoid; }
        th, td { border: 1px solid #bdc3c7; padding: 6px; text-align: center; overflow: hidden; }
        th { background-color: #ecf0f1; color: #2c3e50; font-weight: bold; }
        .col-hora { width: 80px; font-weight: bold; background-color: #f9f9f9; }
        .celda-flex { display: flex; flex-direction: column; gap: 4px; min-height: 50px; }
        .card { border: 1px solid rgba(0,0,0,0.1); border-radius: 3px; padding: 4px; text-align: left; }
        .card-asig { font-weight: bold; border-bottom: 1px solid rgba(0,0,0,0.05); margin-bottom: 2px; }
        .card-tipo { font-style: italic; font-size: 0.9em; float: right; }
        .card-meta { font-size: 0.85em; color: #444; }
        .salto-semana { page-break-after: always; }
        h3 { font-size: 13px; text-align: center; margin-top: 0; color: #555; }
    </style>
    """


def generar_tabla_html(turnos_grupo, titulo_adicional="", semana_filtro=None):
    """Genera el bloque <table> para un conjunto de turnos."""
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


def exportar_todo(turnos, directorio_base):
    estructura = {}
    for t in turnos:
        anio = f"{t.get('anio', 1)}er año"
        carrera = t.get("carrera", "General")
        grupo = t.get("grupo", "G1")

        estructura.setdefault(anio, {}).setdefault(carrera, {}).setdefault(
            grupo, []
        ).append(t)

    for anio, carreras in estructura.items():
        for carrera, grupos in carreras.items():
            ruta_carpeta = os.path.join(directorio_base, anio, carrera)
            os.makedirs(ruta_carpeta, exist_ok=True)

            for grupo, turnos_grupo in grupos.items():
                # 1. Horario Completo del Grupo
                html_comp = f"<html><head>{obtener_estilos_css()}</head><body>"
                html_comp += f"<div class='titulo'>Horario Consolidado: {carrera} - {anio} - Grupo {grupo}</div>"
                html_comp += generar_tabla_html(turnos_grupo)
                html_comp += "</body></html>"

                pdf_completo_nombre = f"Horario completo grupo {grupo}.pdf"
                HTML(string=html_comp).write_pdf(
                    os.path.join(ruta_carpeta, pdf_completo_nombre)
                )

                # 2. Horario por Semanas (1 a 16) - Ahora incluye el grupo en el nombre del archivo
                html_sem = f"<html><head>{obtener_estilos_css()}</head><body>"
                html_sem += f"<div class='titulo'>Horario por Semanas: {carrera} - {anio} - Grupo {grupo}</div>"

                for s in range(1, 17):
                    html_sem += f"<div class='{'salto-semana' if s < 16 else ''}'>"
                    html_sem += generar_tabla_html(
                        turnos_grupo, f"Semana {s}", semana_filtro=s
                    )
                    html_sem += "</div>"

                html_sem += "</body></html>"

                pdf_semanas_nombre = f"Horario por semanas grupo {grupo}.pdf"
                HTML(string=html_sem).write_pdf(
                    os.path.join(ruta_carpeta, pdf_semanas_nombre)
                )

    return True
