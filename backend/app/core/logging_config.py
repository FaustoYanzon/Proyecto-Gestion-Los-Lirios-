import logging
import sys


def configure_logging(level: str = "INFO") -> None:
    """Root logger -> stdout. Railway captures stdout/stderr as-is, so no
    handler/formatter wiring beyond this is needed for the pilot."""
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
