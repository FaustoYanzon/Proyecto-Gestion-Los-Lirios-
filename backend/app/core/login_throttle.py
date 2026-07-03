"""In-memory per-username failed-login throttle.

Complements the per-IP slowapi limit: an attacker spraying one password across
many IPs would slip past IP limits, but every failure lands on the same
username. We count *failures only* in a sliding time window and reject further
attempts once the threshold is hit, until the oldest failure ages out.

Design notes / edge cases:
- Sliding window (not a hard lock): the throttle auto-heals as timestamps
  expire, so a legitimate user is never locked out permanently. This bounds the
  account-lockout DoS a per-username throttle otherwise enables.
- Storage is process-local (like slowapi's default). Correct for a single
  worker. For multi-worker/multi-host, back this with Redis instead.
- Usernames are normalized (trim + lowercase) so casing can't split counters.
- Successful login clears the counter for that username.
"""
from __future__ import annotations

import asyncio
import time

from app.core.config import settings

# username -> list of monotonic failure timestamps within the window
_failures: dict[str, list[float]] = {}
_lock = asyncio.Lock()


def _normalize(username: str) -> str:
    return username.strip().lower()


def _prune(timestamps: list[float], now: float) -> list[float]:
    window = settings.LOGIN_FAILURE_WINDOW_SECONDS
    return [ts for ts in timestamps if now - ts < window]


async def is_locked(username: str) -> bool:
    """Return True if this username currently exceeds the failure threshold."""
    key = _normalize(username)
    now = time.monotonic()
    async with _lock:
        recent = _prune(_failures.get(key, []), now)
        if recent:
            _failures[key] = recent
        else:
            _failures.pop(key, None)
        return len(recent) >= settings.LOGIN_MAX_FAILURES


async def record_failure(username: str) -> None:
    """Register a failed attempt for this username."""
    key = _normalize(username)
    now = time.monotonic()
    async with _lock:
        recent = _prune(_failures.get(key, []), now)
        recent.append(now)
        _failures[key] = recent


async def reset(username: str) -> None:
    """Clear the failure counter after a successful login."""
    key = _normalize(username)
    async with _lock:
        _failures.pop(key, None)
