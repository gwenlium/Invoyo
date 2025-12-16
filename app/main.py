"""FastAPI application initialization, middleware, and error handling."""
import logging
from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from .config import get_settings
from .database import init_db
from .logging_config import configure_logging
from .routers import documents, health
from . import auth

# Configure logging
settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)

# Initialize app
app = FastAPI(
    title="Invoyo API",
    version="1.0.0",
    description="Store, parse, and track invoices with OCR extraction"
)

# =====================
# RATE LIMITING
# =====================
if settings.rate_limit_enabled:
    limiter = Limiter(key_func=get_remote_address)
    app.state.limiter = limiter
    documents.set_limiter(limiter)
else:
    logger.info("Rate limiting disabled (RATE_LIMIT_ENABLED=false)")
    
    # No-op limiter for decorator compatibility
    class NoOpLimiter:
        def limit(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator
    
    documents.set_limiter(NoOpLimiter())

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request, exc):
    """Handle rate limit exceeded."""
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": "Rate limit exceeded. Please try again later."}
    )

# =====================
# STARTUP & SHUTDOWN
# =====================
@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    try:
        init_db()
        logger.info("Database initialized successfully")
        
        # Handle enum migration if needed
        from .database import engine
        try:
            conn = engine.raw_connection()
            try:
                original_isolation = conn.isolation_level
                conn.set_isolation_level(0)
                try:
                    cursor = conn.cursor()
                    try:
                        required_values = ['paid', 'unpaid', 'archived', 'unarchived', 'saved']
                        for value in required_values:
                            try:
                                cursor.execute(f"ALTER TYPE documentstatus ADD VALUE IF NOT EXISTS '{value}';")
                            except Exception as e:
                                error_msg = str(e).lower()
                                if "already exists" not in error_msg and "duplicate" not in error_msg:
                                    if "does not exist" not in error_msg:
                                        logger.debug(f"Enum value '{value}': {e}")
                    except Exception as e:
                        logger.debug(f"Enum migration: {e}")
                    finally:
                        cursor.close()
                finally:
                    conn.set_isolation_level(original_isolation)
            finally:
                conn.close()
        except Exception as e:
            logger.debug(f"Enum setup: {e}")
                    
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}", exc_info=True)

# =====================
# ROUTERS
# =====================
app.include_router(health.router)
app.include_router(documents.router)
app.include_router(auth.router)
