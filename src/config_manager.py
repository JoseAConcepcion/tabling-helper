import json
import os
import tkinter as tk
from tkinter import ttk

CONFIG_FILE = "config.json"
DEFAULT_CONFIG = {
    "carreras": [
        {"nombre": "Biología", "diminutivo": "BIO", "prefijo": "1", "grupos": 2},
        {"nombre": "BBM", "diminutivo": "BBM", "prefijo": "2", "grupos": 2},
        {"nombre": "Microbiología", "diminutivo": "MIC", "prefijo": "3", "grupos": 2},
    ],
    "asignaturas": [{"nombre": "Matemática", "diminutivo": "MAT"}],
    "tipos": [
        {"nombre": "Conferencia", "diminutivo": "C"},
        {"nombre": "Clase Práctica", "diminutivo": "CP"},
    ],
    "aulas": ["3A", "3B", "Lab1", "Lab2"],
}


class ConfigManager:
    def __init__(self):
        self.data = DEFAULT_CONFIG.copy()
        self.load()

    def load(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
            except:
                pass

    def save(self):
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2, ensure_ascii=False)

    def get_carreras_names(self):
        return [c["nombre"] for c in self.data.get("carreras", [])]

    def get_carrera_info(self, nombre):
        """Devuelve el diccionario con prefijo y grupos de una carrera dada."""
        for c in self.data.get("carreras", []):
            if c["nombre"] == nombre:
                return c
        return {"prefijo": "", "grupos": 2}  # Default seguro

    def get_asignaturas_names(self):
        return [a["nombre"] for a in self.data.get("asignaturas", [])]

    def get_tipos_names(self):
        return [t["nombre"] for t in self.data.get("tipos", [])]

    def get_aulas(self):
        return self.data.get("aulas", [])


class ConfigWindow(tk.Toplevel):
    def __init__(self, parent, config_manager, on_close_callback):
        super().__init__(parent)
        self.parent = parent
        self.title("Gestor de Configuración")
        self.geometry("750x500")
        self.config = config_manager
        self.on_close_callback = on_close_callback

        # Mantener siempre el focus en la ventana de config
        self.transient(parent)
        self.wm_attributes("-topmost", True)
        self.grab_set()
        self.focus_set()

        notebook = ttk.Notebook(self)
        notebook.pack(fill="both", expand=True, padx=10, pady=10)

        # Pestaña Carreras (Especial por tener más campos)
        frame_carreras = ttk.Frame(notebook)
        notebook.add(frame_carreras, text="Carreras")
        self.tree_carreras = self.crear_panel_carreras(frame_carreras)

        # Resto de pestañas
        frame_asignaturas = ttk.Frame(notebook)
        notebook.add(frame_asignaturas, text="Asignaturas")
        self.tree_asignaturas = self.crear_panel_arbol(frame_asignaturas, "asignaturas")

        frame_tipos = ttk.Frame(notebook)
        notebook.add(frame_tipos, text="Tipos de Clase")
        self.tree_tipos = self.crear_panel_arbol(frame_tipos, "tipos")

        frame_aulas = ttk.Frame(notebook)
        notebook.add(frame_aulas, text="Aulas")
        self.crear_panel_aulas(frame_aulas)

        self.cargar_datos()
        self.protocol("WM_DELETE_WINDOW", self.cerrar)

    def crear_panel_carreras(self, parent_frame):
        tree = ttk.Treeview(
            parent_frame,
            columns=("nombre", "diminutivo", "prefijo", "grupos"),
            show="headings",
        )
        tree.heading("nombre", text="Nombre")
        tree.heading("diminutivo", text="Dim.")
        tree.heading("prefijo", text="Prefijo")
        tree.heading("grupos", text="Grupos")
        tree.column("diminutivo", width=50)
        tree.column("prefijo", width=50)
        tree.column("grupos", width=50)
        tree.pack(side="left", fill="both", expand=True, padx=5, pady=5)

        panel = ttk.Frame(parent_frame)
        panel.pack(side="right", fill="y", padx=5, pady=5)

        ttk.Label(panel, text="Nombre:").pack(pady=2)
        entry_nom = ttk.Entry(panel)
        entry_nom.pack(pady=2)

        ttk.Label(panel, text="Diminutivo:").pack(pady=2)
        entry_dim = ttk.Entry(panel)
        entry_dim.pack(pady=2)

        ttk.Label(panel, text="Prefijo Num (Ej: 1):").pack(pady=2)
        entry_pref = ttk.Entry(panel)
        entry_pref.pack(pady=2)

        ttk.Label(panel, text="Grupos/Año (Ej: 2):").pack(pady=2)
        entry_grup = ttk.Entry(panel)
        entry_grup.pack(pady=2)

        ttk.Button(
            panel,
            text="Añadir",
            command=lambda: self.guardar_carrera(
                entry_nom, entry_dim, entry_pref, entry_grup
            ),
        ).pack(pady=5)
        ttk.Button(
            panel, text="Eliminar", command=lambda: self.eliminar_item("carreras", tree)
        ).pack(pady=5)
        return tree

    def crear_panel_arbol(self, parent_frame, tipo):
        tree = ttk.Treeview(
            parent_frame, columns=("nombre", "diminutivo"), show="headings"
        )
        tree.heading("nombre", text="Nombre")
        tree.heading("diminutivo", text="Diminutivo")
        tree.pack(side="left", fill="both", expand=True, padx=5, pady=5)

        panel = ttk.Frame(parent_frame)
        panel.pack(side="right", fill="y", padx=5, pady=5)

        ttk.Label(panel, text="Nombre:").pack(pady=2)
        entry_nom = ttk.Entry(panel)
        entry_nom.pack(pady=2)

        ttk.Label(panel, text="Diminutivo:").pack(pady=2)
        entry_dim = ttk.Entry(panel)
        entry_dim.pack(pady=2)

        ttk.Button(
            panel,
            text="Añadir",
            command=lambda: self.guardar_item(tipo, entry_nom, entry_dim),
        ).pack(pady=5)
        ttk.Button(
            panel, text="Eliminar", command=lambda: self.eliminar_item(tipo, tree)
        ).pack(pady=5)
        return tree

    def crear_panel_aulas(self, parent_frame):
        self.list_aulas = tk.Listbox(parent_frame)
        self.list_aulas.pack(side="left", fill="both", expand=True, padx=5, pady=5)
        panel = ttk.Frame(parent_frame)
        panel.pack(side="right", fill="y", padx=5, pady=5)
        ttk.Label(panel, text="Aula:").pack(pady=2)
        self.entry_aula = ttk.Entry(panel)
        self.entry_aula.pack(pady=2)
        ttk.Button(panel, text="Añadir", command=self.guardar_aula).pack(pady=5)
        ttk.Button(panel, text="Eliminar", command=self.eliminar_aula).pack(pady=5)

    def cargar_datos(self):
        self.tree_carreras.delete(*self.tree_carreras.get_children())
        for c in self.config.data.get("carreras", []):
            self.tree_carreras.insert(
                "",
                "end",
                values=(
                    c["nombre"],
                    c["diminutivo"],
                    c.get("prefijo", ""),
                    c.get("grupos", 2),
                ),
            )

        self.tree_asignaturas.delete(*self.tree_asignaturas.get_children())
        for a in self.config.data.get("asignaturas", []):
            self.tree_asignaturas.insert(
                "", "end", values=(a["nombre"], a["diminutivo"])
            )

        self.tree_tipos.delete(*self.tree_tipos.get_children())
        for t in self.config.data.get("tipos", []):
            self.tree_tipos.insert("", "end", values=(t["nombre"], t["diminutivo"]))

        self.list_aulas.delete(0, tk.END)
        for a in self.config.get_aulas():
            self.list_aulas.insert(tk.END, a)

    def guardar_carrera(self, e_nom, e_dim, e_pref, e_grup):
        nom = e_nom.get().strip()
        dim = e_dim.get().strip()
        pref = e_pref.get().strip()
        grup = e_grup.get().strip()
        if not nom or not dim:
            return

        carreras = self.config.data.setdefault("carreras", [])
        for c in carreras:
            if c["nombre"] == nom:
                c.update(
                    {
                        "diminutivo": dim,
                        "prefijo": pref,
                        "grupos": int(grup) if grup.isdigit() else 2,
                    }
                )
                self.config.save()
                self.cargar_datos()
                return

        carreras.append(
            {
                "nombre": nom,
                "diminutivo": dim,
                "prefijo": pref,
                "grupos": int(grup) if grup.isdigit() else 2,
            }
        )
        self.config.save()
        self.cargar_datos()

    def guardar_item(self, tipo, entry_nom, entry_dim):
        nom = entry_nom.get().strip()
        dim = entry_dim.get().strip()
        if not nom or not dim:
            return
        items = self.config.data.setdefault(tipo, [])
        for item in items:
            if item["nombre"] == nom:
                item["diminutivo"] = dim
                self.config.save()
                self.cargar_datos()
                return
        items.append({"nombre": nom, "diminutivo": dim})
        self.config.save()
        self.cargar_datos()

    def eliminar_item(self, tipo, tree):
        seleccion = tree.selection()
        if not seleccion:
            return
        nom = tree.item(seleccion[0])["values"][0]
        self.config.data[tipo] = [
            i for i in self.config.data[tipo] if i["nombre"] != nom
        ]
        self.config.save()
        self.cargar_datos()

    def guardar_aula(self):
        aula = self.entry_aula.get().strip()
        if aula and aula not in self.config.data.setdefault("aulas", []):
            self.config.data["aulas"].append(aula)
            self.config.save()
            self.cargar_datos()

    def eliminar_aula(self):
        seleccion = self.list_aulas.curselection()
        if seleccion:
            self.config.data["aulas"].remove(self.list_aulas.get(seleccion[0]))
            self.config.save()
            self.cargar_datos()

    def cerrar(self):
        if self.on_close_callback:
            self.on_close_callback()
        self.destroy()
