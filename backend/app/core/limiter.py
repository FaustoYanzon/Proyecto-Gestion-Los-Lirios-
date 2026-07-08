from slowapi import Limiter
from slowapi.util import get_remote_address

# Single shared limiter instance, isolated in its own module so both main.py
# (wiring) and the routers (decorators) can import it without a circular import.
#
# Default storage is in-process memory: correct for a single-worker deployment.
# To scale across workers/hosts, pass storage_uri="redis://..." here so the
# counters stay consistent.
limiter = Limiter(key_func=get_remote_address)
