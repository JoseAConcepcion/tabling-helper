import json
import os

CONFIG_FILE = "config.json"

DEFAULT_CONFIG = {
    "carreras": {"Ingeniería Informática": "IF", "Licenciatura en Matemáticas": "MAT"},
    "aulas": ["Aula 1", "Aula 2", "Laboratorio L1"],
}


def load_config():
    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(data):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
