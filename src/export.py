import hashlib
import os
from datetime import datetime, timedelta

from weasyprint import CSS, HTML

# Bloques por defecto para asegurar que siempre aparezcan
BLOQUES_ESTANDAR = [
    {"inicio": "08:30", "fin": "10:05"},
    {"inicio": "10:10", "fin": "11:45"},
    {"inicio": "11:50", "fin": "13:25"},
    {"inicio": "13:35", "fin": "15:10"},
    {"inicio": "15:15", "fin": "16:50"},
    {"inicio": "16:55", "fin": "18:30"},
]

DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]


def calcular_hora_fin(inicio_str, duracion_min):
    """Calcula la hora de fin dada una hora de inicio y una duración."""
    formato = "%H:%M"
    inicio_dt = datetime.strptime(inicio_str, formato)
    fin_dt = inicio_dt + timedelta(minutes=duracion_min)
    return fin_dt.strftime(formato)


def generar_color_pastel(texto):
    """Genera un color pastel (HSL) consistente basado en el nombre de la asignatura."""
    # Usamos MD5 para obtener un hash consistente de la cadena
    hash_obj = hashlib.md5(texto.encode("utf-8"))
    hash_int = int(hash_obj.hexdigest(), 16)
    # Rango de Hue de 0 a 360, Saturación al 70%, Luminosidad al 85% para tonos pastel legibles
    hue = hash_int % 360
    return f"hsl({hue}, 70%, 85%)"


def exportar_horarios_pdf(turnos, ruta_salida, guardar_html=False):
    """Genera las tablas agrupadas por Carrera/Año y las exporta a PDF."""

    # 1. Agrupar los turnos por (Carrera, Año)
    grupos = {}
    for t in turnos:
        carrera = t.get("carrera", "Desconocida")
        anio = t.get("anio", 1)
        clave = (carrera, anio)
        if clave not in grupos:
            grupos[clave] = []
        grupos[clave].append(t)

    # 2. Generar el contenido HTML
    html_content = """
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Horarios</title>
        <style>
            @page {
                size: A4 landscape;
                margin: 1.5cm;
            }
            body { font-family: Arial, sans-serif; font-size: 12px; }
            .salto-pagina { page-break-before: always; }
            .titulo-grupo { background-color: #333; color: white; padding: 10px; text-align: center; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; table-layout: fixed; }
            th, td { border: 1px solid #aaa; padding: 8px; vertical-align: top; }
            th { background-color: #eee; text-align: center; }
            .col-hora { width: 12%; text-align: center; font-weight: bold; vertical-align: middle; }
            .celda-dia { display: flex; flex-direction: column; gap: 5px; height: 100%; }
            .turno-card {
                border-radius: 4px; border: 1px solid rgba(0,0,0,0.1); padding: 5px; box-shadow: 1px 1px 3px rgba(0,0,0,0.1);
            }
            .turno-asig { font-weight: bold; font-size: 13px; }
            .turno-detalles { font-size: 11px; color: #333; margin-top: 3px; }
        </style>
    </head>
    <body>
    """

    primer_grupo = True
    for (carrera, anio), lista_turnos in grupos.items():
        if not primer_grupo:
            html_content += '<div class="salto-pagina"></div>'
        primer_grupo = False

        html_content += f'<h2 class="titulo-grupo">{carrera} - Año {anio}</h2>\n'
        html_content += '<table>\n<thead><tr><th class="col-hora">Horario</th>'
        for dia in DIAS:
            html_content += f"<th>{dia}</th>"
        html_content += "</tr></thead>\n<tbody>\n"

        # 3. Recopilar todos los intervalos de tiempo (Estandar + Personalizados) de este grupo
        intervalos = set()
        for b in BLOQUES_ESTANDAR:
            intervalos.add((b["inicio"], b["fin"]))

        for t in lista_turnos:
            inicio = t.get("hora_inicio")
            if t.get("horario_tipo") != "estandar":
                duracion = t.get("duracion_min", 90)
                fin = calcular_hora_fin(inicio, duracion)
                intervalos.add((inicio, fin))
            else:
                # Si es estándar, nos aseguramos que el bloque exacto esté en la lista
                # (aunque ya deberíamos tenerlos todos cargados)
                pass

        # Ordenar los intervalos por hora de inicio, luego por hora de fin
        intervalos = sorted(list(intervalos), key=lambda x: (x[0], x[1]))

        # 4. Construir las filas de la tabla
        for inicio, fin in intervalos:
            html_content += f'<tr>\n<td class="col-hora">{inicio}<br>-<br>{fin}</td>\n'

            for dia in DIAS:
                # Buscar qué turnos caen exactamente en este día y en este intervalo
                turnos_celda = []
                for t in lista_turnos:
                    t_inicio = t.get("hora_inicio")

                    if t.get("horario_tipo") == "estandar":
                        # Buscamos en los bloques estándar si coinciden
                        for b in BLOQUES_ESTANDAR:
                            if (
                                b["inicio"] == inicio
                                and b["fin"] == fin
                                and b["inicio"] == t_inicio
                            ):
                                if t.get("dia") == dia:
                                    turnos_celda.append(t)
                                break
                    else:
                        t_fin = calcular_hora_fin(t_inicio, t.get("duracion_min", 90))
                        if t.get("dia") == dia and t_inicio == inicio and t_fin == fin:
                            turnos_celda.append(t)

                # Renderizar la celda con sub-elementos si hay varios (Solapamiento / Subceldas)
                html_content += '<td><div class="celda-dia">'
                for t in turnos_celda:
                    asig = t.get("asignatura", "N/A")
                    color = generar_color_pastel(asig)
                    semanas_str = ",".join(map(str, t.get("semanas", [])))

                    html_content += f"""
                    <div class="turno-card" style="background-color: {color};">
                        <div class="turno-asig">{asig} ({t.get("tipo", "")})</div>
                        <div class="turno-detalles">
                            🎓 Gpo: {t.get("grupo", "-")} | 🏫 Aula: {t.get("aula", "-")} <br>
                            📅 Sem: {semanas_str}
                        </div>
                    </div>
                    """
                html_content += "</div></td>\n"
            html_content += "</tr>\n"

        html_content += "</tbody></table>\n"

    html_content += """
    </body>
    </html>
    """

    # 5. Opcional: Guardar el HTML puro
    if guardar_html:
        ruta_html = ruta_salida.rsplit(".", 1)[0] + ".html"
        with open(ruta_html, "w", encoding="utf-8") as f:
            f.write(html_content)

    # 6. Generar el PDF
    try:
        HTML(string=html_content).write_pdf(ruta_salida)
        return True, "Exportación exitosa."
    except Exception as e:
        return False, str(e)
