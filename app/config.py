from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "Invoice Processor"
    environment: str = "production" # Default to prod if not set
    ocr_api_key: str                # No default = REQUIRED. App will fail if missing.
    database_url: str

    class Config:
        # Tells Pydantic to read from the .env file
        env_file = ".env"

# Create a global instance
settings = Settings()