"""Structured logging configuration for audit trails and monitoring."""
import logging
import structlog
import json
from pythonjsonlogger import jsonlogger
import sys

def configure_logging(log_level: str = "INFO"):
    """Configure structured logging with JSON output."""
    
    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer()
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    
    # Setup root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level))
    
    # JSON formatter for stdout
    handler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        '%(timestamp)s %(level)s %(name)s %(message)s'
    )
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

def log_audit_event(
    event: str,
    user_id: str = None,
    resource_id: str = None,
    action: str = None,
    details: dict = None,
    status: str = "success"
):
    """Log security-relevant events for audit trail."""
    logger = structlog.get_logger()
    logger.info(
        "audit_event",
        event=event,
        user_id=user_id,
        resource_id=resource_id,
        action=action,
        details=details or {},
        status=status,
    )
