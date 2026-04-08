import re

from docx2python import docx2python
from docx2python.iterators import iter_tables


def extract_data_from_tables(path_to_doc):
    result = docx2python(path_to_doc, duplicate_merged_cells=True)
    group_tables = []
    group_tables_no_dupes = []

    for table in iter_tables(result.document):
        # ! esto es tronco de parche para sacar las tablas
        # ! esta biblioteca es la mas consistente devuelve
        # ! una estructura pesada de parsear
        if len(table) < 2 or len(table[0]) < 2:
            continue

        n_rows = len(table)
        n_cols = max(len(row) for row in table) if table else 0

        matrix = [["" for _ in range(n_cols)] for _ in range(n_rows)]

        for i, row in enumerate(table):
            for j, cell in enumerate(row):
                if isinstance(cell, list):
                    raw_text = "\n".join(cell)
                else:
                    raw_text = str(cell)
                formatted_text = re.sub(
                    r"\s+", " ", raw_text.replace("\n", " ")
                ).strip()
                matrix[i][j] = formatted_text

        group_tables.append(matrix)

    for idx, matrix in enumerate(group_tables):
        days_set = list(dict.fromkeys(matrix[0]))
        hours_set = list(dict.fromkeys(fila[0] for fila in matrix))

        cell_data = {
            (day, hour): set() for day in days_set for hour in hours_set
        }

        for i in range(1, len(matrix)):
            hour_val = matrix[i][0]
            for j in range(1, len(matrix[0])):
                day_val = matrix[0][j]
                value = matrix[i][j]
                if value != "" and value is not None:
                    cell_data[(day_val, hour_val)].add(value)

        matrix_no_dupes = [
            ["" for _ in range(len(days_set))] for _ in range(len(hours_set))
        ]

        for i in range(len(hours_set)):
            matrix_no_dupes[i][0] = hours_set[i]
        for j in range(len(days_set)):
            matrix_no_dupes[0][j] = days_set[j]

        for i in range(1, len(hours_set)):
            for j in range(1, len(days_set)):
                key = (days_set[j], hours_set[i])
                conjunto = cell_data.get(key, set())
                matrix_no_dupes[i][j] = (
                    " / ".join(sorted(conjunto)) if conjunto else ""
                )

        group_tables_no_dupes.append(matrix_no_dupes)

    return group_tables_no_dupes
