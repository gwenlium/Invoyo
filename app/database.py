"""Database connection and session management."""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool
from .config import get_settings
from .models import Base  # Import Base from models package
import logging

logger = logging.getLogger(__name__)

settings = get_settings()


def _create_engine(database_url: str):
    if database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        if ":memory:" in database_url:
            return create_engine(
                database_url,
                connect_args=connect_args,
                poolclass=StaticPool,
                echo=settings.environment == "development",
            )

        return create_engine(
            database_url,
            connect_args=connect_args,
            echo=settings.environment == "development",
        )

    return create_engine(
        database_url,
        pool_size=settings.database_pool_size,
        pool_timeout=settings.database_pool_timeout,
        pool_recycle=settings.database_pool_recycle,
        pool_pre_ping=True,  # Test connections before using them
        echo=settings.environment == "development",  # Log SQL in dev
    )

# Create engine
engine = _create_engine(settings.database_url)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db() -> Session:
    """Database session dependency."""
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        db.rollback()
        logger.error(f"Database session error: {e}")
        raise
    finally:
        db.close()

def init_db():
    """Initialize database tables."""
    # Base is already imported at the top
    Base.metadata.create_all(bind=engine)
