"""
Structured JSON logger for AWS Lambda.

Provides CloudWatch Logs compatible JSON output with essential fields.
"""

import logging
import json
import sys
from datetime import datetime, timezone
from typing import Any


class JsonFormatter(logging.Formatter):
    """
    Custom formatter that outputs log records as JSON.

    Each log entry includes:
    - timestamp: ISO 8601 format with timezone
    - level: Log level name (INFO, ERROR, etc.)
    - name: Logger name
    - message: Log message
    """

    def format(self, record: logging.LogRecord) -> str:
        """
        Format a log record as JSON string.

        Args:
            record: LogRecord instance from Python's logging module

        Returns:
            JSON string with structured log data
        """
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "name": record.name,
            "message": record.getMessage(),
        }

        return json.dumps(log_entry)


class StructuredLogger:
    """
    Wrapper around Python's logging.Logger with JSON output.

    Provides standard logging methods (info, warning, error, debug)
    with automatic JSON formatting.
    """

    def __init__(self, name: str, level: int = logging.INFO):
        """
        Initialize the structured logger.

        Args:
            name: Logger name (typically module name)
            level: Logging level (default: INFO)
        """
        self._logger = logging.getLogger(name)
        self._logger.setLevel(level)
        self._logger.handlers.clear()  # Remove existing handlers

        # Create console handler with JSON formatter
        # Explicitly output to stdout (default is stderr)
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        self._logger.addHandler(handler)

    def info(self, msg: str, extra: dict[str, Any] | None = None) -> None:
        """Log an info message."""
        self._logger.info(msg, extra=extra)

    def warning(self, msg: str, extra: dict[str, Any] | None = None) -> None:
        """Log a warning message."""
        self._logger.warning(msg, extra=extra)

    def error(self, msg: str, extra: dict[str, Any] | None = None) -> None:
        """Log an error message."""
        self._logger.error(msg, extra=extra)

    def debug(self, msg: str, extra: dict[str, Any] | None = None) -> None:
        """Log a debug message."""
        self._logger.debug(msg, extra=extra)


def setup_logger(name: str = "lights-out", level: int = logging.INFO) -> StructuredLogger:
    """
    Create and configure a structured logger.

    Args:
        name: Logger name (default: "lights-out")
        level: Logging level (default: INFO)

    Returns:
        StructuredLogger instance ready to use

    Example:
        >>> logger = setup_logger("my-module")
        >>> logger.info("Application started")
        {"timestamp": "2025-12-10T10:00:00+00:00", "level": "INFO", ...}
    """
    return StructuredLogger(name, level)
