"""Test package initializer.

Ensures the FastAPI application module in `app/main.py` can be imported
as `main` inside tests (matching the existing `from main import app` statement
in `test_main.py`). If you prefer explicit package imports, you can instead
change tests to use `from app.main import app` and remove this path tweak.
"""

import os
import sys

# Absolute path to the project root (folder containing `app/` and `tests/`).
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_BASE_DIR, os.pardir))
_APP_DIR = os.path.join(_PROJECT_ROOT, "app")

# Prepend the `app` directory to sys.path so `from main import app` works.
if _APP_DIR not in sys.path:
	sys.path.insert(0, _APP_DIR)

__all__ = []

