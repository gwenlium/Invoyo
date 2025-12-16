"""Invoyo application package.

Exposes the FastAPI `app` instance defined in `main.py` and provides a
`create_app` factory for compatibility with ASGI servers or tooling that
expects a callable returning an application instance.
"""

from fastapi import FastAPI

# Re-export the application instance from `main.py`.
from .main import app as app

def create_app() -> FastAPI:
	"""Return the FastAPI application instance.

	If later you need dynamic initialization (e.g. dependency wiring,
	configuration loading), extend this function instead of importing
	`app` directly.
	"""
	return app

__all__ = ["app", "create_app"]

