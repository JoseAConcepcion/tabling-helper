import json
import os
import re
from datetime import datetime
from tkinter import END, StringVar, Text, Tk, filedialog, messagebox, ttk

# Configuración
SEMESTRE_MAX_SEMANAS = 16  # semanas del semestre

# Bloques estándar: hora de inicio y duración en minutos
BLOQUES_ESTANDAR = {
    1: {"inicio": "08:30", "fin": "10:05", "duracion_min": 95},  # 1h35
    2: {"inicio": "10:10", "fin": "11:45", "duracion_min": 95},
    3: {"inicio": "11:50", "fin": "13:25", "duracion_min": 95},
    4: {"inicio": "13:35", "fin": "15:10", "duracion_min": 95},
    5: {"inicio": "15:15", "fin": "16:50", "duracion_min": 95},
    6: {"inicio": "16:55", "fin": "18:30", "duracion_min": 95},
}

# Días de la semana
DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

# Listas precargadas (hardcodeadas) de carreras y aulas (ejemplo)
CARRERAS_PREDEF = ["Bioquimica", "Biologia", "Ingenieria Informatica", "Matematicas"]
AULAS_PREDEF = ["3A", "3B", "Lab1", "Lab2", "Aula Magna"]


class HorarioApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Gestor de Horarios - Facultad")
        self.root.geometry("1200x700")

        # Datos
        self.turnos = []  # lista de turnos (cada turno es un dict)
        self.prox_id = 1

        # Variable para controlar edición
        self.editando_id = None

        # Crear interfaz
        self.crear_widgets()

        # Cargar datos por defecto si existe archivo
        self.cargar_auto()

    def crear_widgets(self):
        # Frame superior para formulario
        frame_form = ttk.LabelFrame(self.root, text="Datos del turno", padding=10)
        frame_form.pack(fill="x", padx=10, pady=5)

        # Fila 1: Carrera, Año, Grupo, Asignatura
        ttk.Label(frame_form, text="Carrera:").grid(
            row=0, column=0, sticky="w", padx=5, pady=2
        )
        self.carrera_var = StringVar()
        self.carrera_combo = ttk.Combobox(
            frame_form, textvariable=self.carrera_var, values=CARRERAS_PREDEF, width=20
        )
        self.carrera_combo.grid(row=0, column=1, padx=5, pady=2)
        self.carrera_combo.bind("<KeyRelease>", self.actualizar_sugerencias_carrera)

        ttk.Label(frame_form, text="Año:").grid(
            row=0, column=2, sticky="w", padx=5, pady=2
        )
        self.anio_var = StringVar()
        self.anio_spin = ttk.Spinbox(
            frame_form, from_=1, to=4, textvariable=self.anio_var, width=5
        )
        self.anio_spin.grid(row=0, column=3, padx=5, pady=2)
        self.anio_var.set("1")

        ttk.Label(frame_form, text="Grupo:").grid(
            row=0, column=4, sticky="w", padx=5, pady=2
        )
        self.grupo_var = StringVar()
        self.grupo_entry = ttk.Entry(frame_form, textvariable=self.grupo_var, width=10)
        self.grupo_entry.grid(row=0, column=5, padx=5, pady=2)

        ttk.Label(frame_form, text="Asignatura:").grid(
            row=0, column=6, sticky="w", padx=5, pady=2
        )
        self.asignatura_var = StringVar()
        self.asignatura_entry = ttk.Entry(
            frame_form, textvariable=self.asignatura_var, width=20
        )
        self.asignatura_entry.grid(row=0, column=7, padx=5, pady=2)

        # Fila 2: Tipo, Día, Horario, Personalizado
        ttk.Label(frame_form, text="Tipo:").grid(
            row=1, column=0, sticky="w", padx=5, pady=2
        )
        self.tipo_var = StringVar()
        self.tipo_combo = ttk.Combobox(
            frame_form,
            textvariable=self.tipo_var,
            values=["C", "S", "PI", "T", "L"],
            width=5,
        )
        self.tipo_combo.grid(row=1, column=1, padx=5, pady=2)
        self.tipo_var.set("C")

        ttk.Label(frame_form, text="Día:").grid(
            row=1, column=2, sticky="w", padx=5, pady=2
        )
        self.dia_var = StringVar()
        self.dia_combo = ttk.Combobox(
            frame_form, textvariable=self.dia_var, values=DIAS, width=10
        )
        self.dia_combo.grid(row=1, column=3, padx=5, pady=2)
        self.dia_var.set(DIAS[0])

        ttk.Label(frame_form, text="Horario:").grid(
            row=1, column=4, sticky="w", padx=5, pady=2
        )
        self.horario_tipo_var = StringVar(value="estandar")
        frame_horario = ttk.Frame(frame_form)
        frame_horario.grid(row=1, column=5, columnspan=3, sticky="w", padx=5, pady=2)
        ttk.Radiobutton(
            frame_horario,
            text="Estándar",
            variable=self.horario_tipo_var,
            value="estandar",
            command=self.actualizar_campos_horario,
        ).pack(side="left")
        ttk.Radiobutton(
            frame_horario,
            text="Personalizado",
            variable=self.horario_tipo_var,
            value="personalizado",
            command=self.actualizar_campos_horario,
        ).pack(side="left")

        self.bloque_var = StringVar()
        self.bloque_combo = ttk.Combobox(
            frame_horario,
            textvariable=self.bloque_var,
            values=[str(i) for i in range(1, 7)],
            width=3,
            state="readonly",
        )
        self.bloque_combo.pack(side="left", padx=5)
        self.bloque_combo.set(1)
        self.bloque_combo.bind("<<ComboboxSelected>>", self.actualizar_info_bloque)

        self.hora_inicio_var = StringVar()
        self.hora_inicio_entry = ttk.Entry(
            frame_horario, textvariable=self.hora_inicio_var, width=10, state="disabled"
        )
        self.hora_inicio_entry.pack(side="left", padx=5)
        ttk.Label(frame_horario, text="(HH:MM)").pack(side="left")

        # Etiqueta para mostrar el rango del bloque estándar
        self.info_bloque_label = ttk.Label(frame_horario, text="", foreground="blue")
        self.info_bloque_label.pack(side="left", padx=5)

        ttk.Label(frame_form, text="Duración:").grid(
            row=1, column=8, sticky="w", padx=5, pady=2
        )
        self.duracion_var = StringVar()
        self.duracion_spin = ttk.Spinbox(
            frame_form,
            from_=1,
            to=6,
            textvariable=self.duracion_var,
            width=5,
            state="disabled",
        )
        self.duracion_spin.grid(row=1, column=9, padx=5, pady=2)
        self.duracion_var.set("1")
        # Etiqueta para duración fija en estándar
        self.duracion_fija_label = ttk.Label(
            frame_form, text="(1h 35min)", foreground="green"
        )
        self.duracion_fija_label.grid(row=1, column=10, sticky="w", padx=5, pady=2)

        # Fila 3: Semanas, Aula, Botones
        ttk.Label(frame_form, text="Semanas (ej. 5-8,10):").grid(
            row=2, column=0, columnspan=2, sticky="w", padx=5, pady=2
        )
        self.semanas_var = StringVar()
        self.semanas_entry = ttk.Entry(
            frame_form, textvariable=self.semanas_var, width=20
        )
        self.semanas_entry.grid(row=2, column=2, columnspan=2, padx=5, pady=2)

        ttk.Label(frame_form, text="Aula:").grid(
            row=2, column=4, sticky="w", padx=5, pady=2
        )
        self.aula_var = StringVar()
        self.aula_combo = ttk.Combobox(
            frame_form, textvariable=self.aula_var, values=AULAS_PREDEF, width=10
        )
        self.aula_combo.grid(row=2, column=5, padx=5, pady=2)
        self.aula_combo.bind("<KeyRelease>", self.actualizar_sugerencias_aula)

        # Botones de acción
        frame_botones = ttk.Frame(frame_form)
        frame_botones.grid(row=2, column=6, columnspan=4, pady=5)
        self.btn_agregar = ttk.Button(
            frame_botones, text="Agregar Turno", command=self.agregar_turno
        )
        self.btn_agregar.pack(side="left", padx=5)
        self.btn_editar = ttk.Button(
            frame_botones, text="Editar", command=self.iniciar_edicion, state="disabled"
        )
        self.btn_editar.pack(side="left", padx=5)
        self.btn_eliminar = ttk.Button(
            frame_botones,
            text="Eliminar",
            command=self.eliminar_turno,
            state="disabled",
        )
        self.btn_eliminar.pack(side="left", padx=5)
        self.btn_limpiar = ttk.Button(
            frame_botones, text="Limpiar Form", command=self.limpiar_formulario
        )
        self.btn_limpiar.pack(side="left", padx=5)

        # Frame principal con tabla y área de errores
        frame_principal = ttk.Frame(self.root)
        frame_principal.pack(fill="both", expand=True, padx=10, pady=5)

        # Tabla de turnos
        frame_tabla = ttk.LabelFrame(
            frame_principal, text="Turnos ingresados", padding=5
        )
        frame_tabla.pack(side="left", fill="both", expand=True)

        columnas = (
            "id",
            "carrera",
            "anio",
            "grupo",
            "asignatura",
            "tipo",
            "dia",
            "horario",
            "semanas",
            "aula",
        )
        self.tree = ttk.Treeview(
            frame_tabla, columns=columnas, show="headings", selectmode="browse"
        )
        self.tree.heading("id", text="ID")
        self.tree.heading("carrera", text="Carrera")
        self.tree.heading("anio", text="Año")
        self.tree.heading("grupo", text="Grupo")
        self.tree.heading("asignatura", text="Asignatura")
        self.tree.heading("tipo", text="Tipo")
        self.tree.heading("dia", text="Día")
        self.tree.heading("horario", text="Horario")
        self.tree.heading("semanas", text="Semanas")
        self.tree.heading("aula", text="Aula")

        self.tree.column("id", width=40)
        self.tree.column("carrera", width=120)
        self.tree.column("anio", width=50)
        self.tree.column("grupo", width=60)
        self.tree.column("asignatura", width=150)
        self.tree.column("tipo", width=50)
        self.tree.column("dia", width=80)
        self.tree.column("horario", width=120)
        self.tree.column("semanas", width=100)
        self.tree.column("aula", width=80)

        scroll_tabla = ttk.Scrollbar(
            frame_tabla, orient="vertical", command=self.tree.yview
        )
        self.tree.configure(yscrollcommand=scroll_tabla.set)
        self.tree.pack(side="left", fill="both", expand=True)
        scroll_tabla.pack(side="right", fill="y")

        self.tree.bind("<<TreeviewSelect>>", self.on_turno_seleccionado)

        # Área de errores
        frame_errores = ttk.LabelFrame(
            frame_principal, text="Errores y advertencias", padding=5
        )
        frame_errores.pack(side="right", fill="both", expand=True, padx=(5, 0))

        self.text_errores = Text(frame_errores, wrap="word", height=20, width=50)
        scroll_errores = ttk.Scrollbar(
            frame_errores, orient="vertical", command=self.text_errores.yview
        )
        self.text_errores.configure(yscrollcommand=scroll_errores.set)
        self.text_errores.pack(side="left", fill="both", expand=True)
        scroll_errores.pack(side="right", fill="y")

        # Botones globales
        frame_botones_global = ttk.Frame(self.root)
        frame_botones_global.pack(fill="x", padx=10, pady=5)

        ttk.Button(
            frame_botones_global, text="Validar horario", command=self.validar_horario
        ).pack(side="left", padx=5)
        ttk.Button(
            frame_botones_global,
            text="Guardar en archivo",
            command=self.guardar_archivo,
        ).pack(side="left", padx=5)
        ttk.Button(
            frame_botones_global,
            text="Cargar desde archivo",
            command=self.cargar_archivo,
        ).pack(side="left", padx=5)
        ttk.Button(
            frame_botones_global, text="Limpiar todo", command=self.limpiar_todo
        ).pack(side="left", padx=5)

        # Inicializar estado de campos
        self.actualizar_campos_horario()

    def actualizar_campos_horario(self):
        if self.horario_tipo_var.get() == "estandar":
            self.bloque_combo.config(state="readonly")
            self.hora_inicio_entry.config(state="disabled")
            self.duracion_spin.config(state="disabled")
            self.duracion_fija_label.config(text="(1h 35min)")
            self.actualizar_info_bloque()
        else:
            self.bloque_combo.config(state="disabled")
            self.hora_inicio_entry.config(state="normal")
            self.duracion_spin.config(state="normal")
            self.duracion_fija_label.config(text="")
            self.info_bloque_label.config(text="")

    def actualizar_info_bloque(self, event=None):
        try:
            bloque = int(self.bloque_var.get())
            info = BLOQUES_ESTANDAR[bloque]
            self.info_bloque_label.config(text=f"{info['inicio']} - {info['fin']}")
        except:
            self.info_bloque_label.config(text="")

    def actualizar_sugerencias_carrera(self, event):
        texto = self.carrera_var.get()
        if texto:
            sugerencias = [c for c in CARRERAS_PREDEF if texto.lower() in c.lower()]
            self.carrera_combo["values"] = (
                sugerencias if sugerencias else CARRERAS_PREDEF
            )
        else:
            self.carrera_combo["values"] = CARRERAS_PREDEF

    def actualizar_sugerencias_aula(self, event):
        texto = self.aula_var.get()
        if texto:
            sugerencias = [a for a in AULAS_PREDEF if texto.lower() in a.lower()]
            self.aula_combo["values"] = sugerencias if sugerencias else AULAS_PREDEF
        else:
            self.aula_combo["values"] = AULAS_PREDEF

    def parsear_semanas(self, cadena):
        """Convierte '5-8,10' en lista de enteros [5,6,7,8,10]"""
        semanas = []
        if not cadena.strip():
            return []
        partes = cadena.split(",")
        for parte in partes:
            parte = parte.strip()
            if "-" in parte:
                inicio, fin = parte.split("-")
                try:
                    inicio = int(inicio)
                    fin = int(fin)
                    if inicio <= fin:
                        semanas.extend(range(inicio, fin + 1))
                    else:
                        raise ValueError
                except:
                    raise ValueError(f"Formato de rango inválido: {parte}")
            else:
                try:
                    semanas.append(int(parte))
                except:
                    raise ValueError(f"Número de semana inválido: {parte}")
        # Filtrar semanas fuera de rango
        semanas = [s for s in semanas if 1 <= s <= SEMESTRE_MAX_SEMANAS]
        return sorted(set(semanas))

    def obtener_hora_inicio(self):
        if self.horario_tipo_var.get() == "estandar":
            try:
                bloque = int(self.bloque_var.get())
                return BLOQUES_ESTANDAR[bloque]["inicio"]
            except:
                return "00:00"
        else:
            return self.hora_inicio_var.get().strip()

    def obtener_duracion_minutos(self):
        """Devuelve la duración en minutos"""
        if self.horario_tipo_var.get() == "estandar":
            try:
                bloque = int(self.bloque_var.get())
                return BLOQUES_ESTANDAR[bloque]["duracion_min"]
            except:
                return 95  # valor por defecto
        else:
            # Personalizado: duración en horas enteras convertidas a minutos
            try:
                horas = int(self.duracion_var.get())
                return horas * 60
            except:
                return 60

    def validar_campos(self):
        # Validar campos obligatorios
        if not self.carrera_var.get().strip():
            messagebox.showerror("Error", "La carrera es obligatoria")
            return False
        if not self.anio_var.get().strip():
            messagebox.showerror("Error", "El año es obligatorio")
            return False
        try:
            anio = int(self.anio_var.get())
            if anio < 1 or anio > 4:
                raise ValueError
        except:
            messagebox.showerror("Error", "Año debe ser 1-4")
            return False
        if not self.grupo_var.get().strip():
            messagebox.showerror("Error", "El grupo es obligatorio")
            return False
        if not self.asignatura_var.get().strip():
            messagebox.showerror("Error", "La asignatura es obligatoria")
            return False
        if not self.tipo_var.get().strip():
            messagebox.showerror("Error", "El tipo es obligatorio")
            return False
        if self.dia_var.get() not in DIAS:
            messagebox.showerror("Error", "Seleccione un día válido")
            return False
        if self.horario_tipo_var.get() == "estandar":
            try:
                bloque = int(self.bloque_var.get())
                if bloque not in BLOQUES_ESTANDAR:
                    raise ValueError
            except:
                messagebox.showerror("Error", "Seleccione un bloque válido (1-6)")
                return False
        else:
            # Validar formato hora HH:MM
            hora = self.hora_inicio_var.get().strip()
            if not re.match(r"^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$", hora):
                messagebox.showerror(
                    "Error", "Formato de hora inválido. Use HH:MM (ej. 14:15)"
                )
                return False
            # Validar duración personalizada
            try:
                duracion = int(self.duracion_var.get())
                if duracion < 1 or duracion > 6:
                    raise ValueError
            except:
                messagebox.showerror("Error", "Duración debe ser entero entre 1 y 6")
                return False
        # Semanas (puede estar vacío? asumo que no)
        if not self.semanas_var.get().strip():
            messagebox.showerror("Error", "Debe especificar las semanas")
            return False
        try:
            semanas = self.parsear_semanas(self.semanas_var.get())
            if not semanas:
                messagebox.showerror("Error", "No hay semanas válidas en el rango 1-16")
                return False
        except ValueError as e:
            messagebox.showerror("Error", str(e))
            return False
        if not self.aula_var.get().strip():
            messagebox.showerror("Error", "El aula es obligatoria")
            return False
        return True

    def obtener_datos_turno(self):
        # Devuelve un dict con los datos del formulario (sin id)
        hora_inicio = self.obtener_hora_inicio()
        duracion_min = self.obtener_duracion_minutos()
        semanas = self.parsear_semanas(self.semanas_var.get())
        return {
            "carrera": self.carrera_var.get().strip(),
            "anio": int(self.anio_var.get()),
            "grupo": self.grupo_var.get().strip(),
            "asignatura": self.asignatura_var.get().strip(),
            "tipo": self.tipo_var.get().strip(),
            "dia": self.dia_var.get(),
            "horario_tipo": self.horario_tipo_var.get(),
            "bloque": int(self.bloque_var.get())
            if self.horario_tipo_var.get() == "estandar"
            else None,
            "hora_inicio": hora_inicio,
            "duracion_min": duracion_min,  # guardamos en minutos
            "semanas": semanas,
            "aula": self.aula_var.get().strip(),
        }

    def agregar_turno(self):
        if not self.validar_campos():
            return
        datos = self.obtener_datos_turno()
        if self.editando_id is not None:
            # Actualizar turno existente
            for i, t in enumerate(self.turnos):
                if t["id"] == self.editando_id:
                    datos["id"] = self.editando_id
                    self.turnos[i] = datos
                    break
            self.editando_id = None
            self.btn_agregar.config(text="Agregar Turno")
            self.btn_editar.config(state="disabled")
            self.btn_eliminar.config(state="disabled")
        else:
            # Nuevo turno
            datos["id"] = self.prox_id
            self.prox_id += 1
            self.turnos.append(datos)
        self.actualizar_tabla()
        self.limpiar_formulario()
        messagebox.showinfo("Éxito", "Turno guardado")

    def iniciar_edicion(self):
        seleccion = self.tree.selection()
        if not seleccion:
            return
        item = self.tree.item(seleccion[0])
        turno_id = item["values"][0]
        # Buscar turno
        turno = next((t for t in self.turnos if t["id"] == turno_id), None)
        if turno:
            self.cargar_en_formulario(turno)
            self.editando_id = turno_id
            self.btn_agregar.config(text="Actualizar Turno")
            self.btn_editar.config(state="disabled")
            self.btn_eliminar.config(state="disabled")

    def eliminar_turno(self):
        seleccion = self.tree.selection()
        if not seleccion:
            return
        item = self.tree.item(seleccion[0])
        turno_id = item["values"][0]
        if messagebox.askyesno("Confirmar", "¿Eliminar este turno?"):
            self.turnos = [t for t in self.turnos if t["id"] != turno_id]
            self.actualizar_tabla()
            self.limpiar_formulario()
            self.editando_id = None
            self.btn_agregar.config(text="Agregar Turno")
            self.btn_editar.config(state="disabled")
            self.btn_eliminar.config(state="disabled")

    def on_turno_seleccionado(self, event):
        # Habilitar botones de edición/eliminación
        if self.tree.selection():
            self.btn_editar.config(state="normal")
            self.btn_eliminar.config(state="normal")
        else:
            self.btn_editar.config(state="disabled")
            self.btn_eliminar.config(state="disabled")

    def cargar_en_formulario(self, turno):
        self.carrera_var.set(turno["carrera"])
        self.anio_var.set(turno["anio"])
        self.grupo_var.set(turno["grupo"])
        self.asignatura_var.set(turno["asignatura"])
        self.tipo_var.set(turno["tipo"])
        self.dia_var.set(turno["dia"])
        self.horario_tipo_var.set(turno["horario_tipo"])
        if turno["horario_tipo"] == "estandar":
            self.bloque_var.set(turno["bloque"])
            self.hora_inicio_var.set("")
            # La duración se muestra fija, no se carga
        else:
            self.bloque_var.set("1")
            self.hora_inicio_var.set(turno["hora_inicio"])
            # Convertir minutos a horas para el spinbox (asumimos horas enteras)
            horas = turno["duracion_min"] // 60
            self.duracion_var.set(str(horas))
        self.actualizar_campos_horario()
        # Semanas
        semanas_str = self.lista_a_cadena_semanas(turno["semanas"])
        self.semanas_var.set(semanas_str)
        self.aula_var.set(turno["aula"])

    def lista_a_cadena_semanas(self, lista):
        # Convierte [5,6,7,8,10] a "5-8,10"
        if not lista:
            return ""
        rangos = []
        inicio = lista[0]
        fin = lista[0]
        for s in lista[1:]:
            if s == fin + 1:
                fin = s
            else:
                if inicio == fin:
                    rangos.append(str(inicio))
                else:
                    rangos.append(f"{inicio}-{fin}")
                inicio = fin = s
        if inicio == fin:
            rangos.append(str(inicio))
        else:
            rangos.append(f"{inicio}-{fin}")
        return ",".join(rangos)

    def limpiar_formulario(self):
        self.carrera_var.set("")
        self.anio_var.set("1")
        self.grupo_var.set("")
        self.asignatura_var.set("")
        self.tipo_var.set("C")
        self.dia_var.set(DIAS[0])
        self.horario_tipo_var.set("estandar")
        self.bloque_var.set("1")
        self.hora_inicio_var.set("")
        self.duracion_var.set("1")
        self.semanas_var.set("")
        self.aula_var.set("")
        self.actualizar_campos_horario()
        self.editando_id = None
        self.btn_agregar.config(text="Agregar Turno")

    def actualizar_tabla(self):
        # Limpiar tabla
        for row in self.tree.get_children():
            self.tree.delete(row)
        # Insertar turnos
        for t in self.turnos:
            # Crear representación de horario para mostrar
            if t["horario_tipo"] == "estandar":
                bloque = t["bloque"]
                info = BLOQUES_ESTANDAR[bloque]
                horario_str = f"Bloque {bloque} ({info['inicio']} - {info['fin']})"
            else:
                # Convertir minutos a horas para mostrar
                horas = t["duracion_min"] // 60
                minutos = t["duracion_min"] % 60
                if minutos == 0:
                    duracion_str = f"{horas}h"
                else:
                    duracion_str = f"{horas}h{minutos:02d}"
                horario_str = f"{t['hora_inicio']} +{duracion_str}"
            semanas_str = self.lista_a_cadena_semanas(t["semanas"])
            self.tree.insert(
                "",
                "end",
                values=(
                    t["id"],
                    t["carrera"],
                    t["anio"],
                    t["grupo"],
                    t["asignatura"],
                    t["tipo"],
                    t["dia"],
                    horario_str,
                    semanas_str,
                    t["aula"],
                ),
            )

    def hora_a_minutos(self, hora_str):
        """Convierte HH:MM a minutos desde las 0:00"""
        h, m = map(int, hora_str.split(":"))
        return h * 60 + m

    def calcular_rango_minutos(self, turno):
        """Devuelve (inicio_minutos, fin_minutos) para un turno"""
        inicio = self.hora_a_minutos(turno["hora_inicio"])
        fin = inicio + turno["duracion_min"]
        return inicio, fin

    def turnos_solapan(self, t1, t2):
        """Verifica si dos turnos se solapan en horario y día/semana"""
        if t1["dia"] != t2["dia"]:
            return False
        # Semanas comunes
        semanas_comunes = set(t1["semanas"]) & set(t2["semanas"])
        if not semanas_comunes:
            return False
        # Rangos horarios
        ini1, fin1 = self.calcular_rango_minutos(t1)
        ini2, fin2 = self.calcular_rango_minutos(t2)
        if max(ini1, ini2) < min(fin1, fin2):
            return True
        return False

    def validar_horario(self):
        errores = []
        advertencias = []
        n = len(self.turnos)
        for i in range(n):
            for j in range(i + 1, n):
                t1 = self.turnos[i]
                t2 = self.turnos[j]
                if not self.turnos_solapan(t1, t2):
                    continue
                # Hay solapamiento en día y semana y horario
                # Calcular semanas comunes para usar en los mensajes
                semanas_comunes = sorted(set(t1["semanas"]) & set(t2["semanas"]))
                semanas_str = ",".join(map(str, semanas_comunes))

                # Conflicto de aula
                if t1["aula"] == t2["aula"]:
                    errores.append(
                        f"Conflicto de aula: {t1['carrera']} {t1['anio']}° {t1['grupo']} - "
                        f"{t1['asignatura']} ({t1['tipo']}) y {t2['carrera']} {t2['anio']}° {t2['grupo']} - "
                        f"{t2['asignatura']} ({t2['tipo']}) en {t1['dia']} semana {semanas_str} aula {t1['aula']}"
                        f"\n"
                    )

                # Conflicto de grupo (misma carrera, mismo año, mismo grupo)
                if (
                    t1["carrera"] == t2["carrera"]
                    and t1["anio"] == t2["anio"]
                    and t1["grupo"] == t2["grupo"]
                ):
                    errores.append(
                        f"Conflicto de grupo: {t1['carrera']} {t1['anio']}° {t1['grupo']} - "
                        f"{t1['asignatura']} ({t1['tipo']}) y {t2['asignatura']} ({t2['tipo']}) "
                        f"en {t1['dia']} semana {semanas_str}"
                    )

                # Advertencia: misma carrera, mismo año, grupos diferentes, misma aula
                if (
                    t1["carrera"] == t2["carrera"]
                    and t1["anio"] == t2["anio"]
                    and t1["grupo"] != t2["grupo"]
                    and t1["aula"] == t2["aula"]
                ):
                    advertencias.append(
                        f"Advertencia: Aula compartida misma carrera/año: {t1['carrera']} {t1['anio']}° "
                        f"{t1['grupo']} y {t2['grupo']} en {t1['dia']} semana {semanas_str} aula {t1['aula']}"
                    )

        # Mostrar en el área de texto
        self.text_errores.delete(1.0, END)
        if errores:
            self.text_errores.insert(END, "ERRORES:\n" + "\n".join(errores) + "\n\n")
        if advertencias:
            self.text_errores.insert(END, "ADVERTENCIAS:\n" + "\n".join(advertencias))
        if not errores and not advertencias:
            self.text_errores.insert(END, "No se encontraron conflictos.")

        # Guardar en log
        with open("errores.log", "a", encoding="utf-8") as f:
            f.write(f"\n--- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---\n")
            if errores:
                f.write("ERRORES:\n" + "\n".join(errores) + "\n")
            if advertencias:
                f.write("ADVERTENCIAS:\n" + "\n".join(advertencias) + "\n")
            if not errores and not advertencias:
                f.write("Sin conflictos.\n")

    def guardar_archivo(self):
        filename = filedialog.asksaveasfilename(
            defaultextension=".json", filetypes=[("JSON files", "*.json")]
        )
        if filename:
            data = {"prox_id": self.prox_id, "turnos": self.turnos}
            with open(filename, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            messagebox.showinfo("Guardado", f"Datos guardados en {filename}")

    def cargar_archivo(self):
        filename = filedialog.askopenfilename(filetypes=[("JSON files", "*.json")])
        if filename:
            try:
                with open(filename, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.prox_id = data.get("prox_id", 1)
                self.turnos = data.get("turnos", [])
                self.actualizar_tabla()
                self.limpiar_formulario()
                messagebox.showinfo("Cargado", f"Datos cargados desde {filename}")
            except Exception as e:
                messagebox.showerror("Error", f"No se pudo cargar el archivo: {e}")

    def cargar_auto(self):
        # Intenta cargar horario.json si existe
        if os.path.exists("horario.json"):
            try:
                with open("horario.json", "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.prox_id = data.get("prox_id", 1)
                self.turnos = data.get("turnos", [])
                self.actualizar_tabla()
            except:
                pass

    def limpiar_todo(self):
        if messagebox.askyesno("Confirmar", "¿Borrar todos los turnos?"):
            self.turnos = []
            self.prox_id = 1
            self.actualizar_tabla()
            self.limpiar_formulario()
            self.text_errores.delete(1.0, END)


if __name__ == "__main__":
    root = Tk()
    app = HorarioApp(root)
    root.mainloop()
