"""Application configuration using environment variables."""
import os
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Application
    app_name: str = "Invoice Processor"
    environment: str = "development"  # development, staging, production
    api_version: str = "v1"
    
    # Database
    database_url: str = "postgresql://user:password@localhost:5432/invoiceprocessor"
    database_pool_size: int = 10
    database_pool_timeout: int = 30
    database_pool_recycle: int = 3600
    
    # Security
    secret_key: str = "your-secret-key-change-in-production"  # MUST be in .env
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    
    # OCR
    ocr_api_key: str = ""
    
    # File upload
    max_upload_size_mb: int = 50
    upload_directory: str = "uploads"
    
    # Redis (for caching, rate limiting, Celery)
    redis_url: str = "redis://localhost:6379/0"
    
    # Celery
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"
    
    # Rate limiting
    rate_limit_requests: int = 100
    rate_limit_window_seconds: int = 60
    
    # Logging
    log_level: str = "INFO"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False

@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance. Use dependency injection in FastAPI."""
    return Settings()
