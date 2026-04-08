.PHONY: all install lint test

all: lint test

install:
	uv pip install -e .[dev]

lint:
	uv run flake8 main.py tables_stractor.py

test:
	@echo "No tests found."
