import logging
from collections.abc import Awaitable, Callable

import sentry_sdk
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api import alertas, arca, auth, clima, finanzas, kpis, notificaciones, parcelas, precios_tarea, presupuestos, produccion, termografo, trabajadores, users
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging_config import configure_logging

configure_logging(settings.LOG_LEVEL)
logger = logging.getLogger("app")

if settings.SENTRY_DSN:
    sentry_sdk.init(dsn=settings.SENTRY_DSN, environment=settings.ENVIRONMENT.value)

app = FastAPI(
    title="Los Lirios API",
    description="Agricultural management system",
    version="0.1.0",
    # Interactive docs are disabled in production to avoid exposing the full
    # API surface. Controlled by ENVIRONMENT / DOCS_ENABLED in config.
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

# Wire slowapi. The middleware enforces the per-route decorators and the
# exception handler returns a clean 429 instead of a 500.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Attach baseline security headers to every response.

    These are defense-in-depth defaults. TLS termination and HSTS are expected
    to be handled by the reverse proxy in front of the app; HSTS is only sent in
    production to avoid pinning HTTPS during local development.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Safety net for anything not already raised as an HTTPException in a
    router. Starlette resolves handlers by the most specific exception class,
    so HTTPException/RequestValidationError keep using FastAPI's own handlers
    -- this only catches what would otherwise fail silently."""
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(alertas.router)
app.include_router(arca.router)
app.include_router(auth.router)
app.include_router(clima.router)
app.include_router(users.router)
app.include_router(parcelas.router)
app.include_router(finanzas.router)
app.include_router(presupuestos.router)
app.include_router(precios_tarea.router)
app.include_router(kpis.router)
app.include_router(produccion.router)
app.include_router(termografo.router)
app.include_router(trabajadores.router)
app.include_router(notificaciones.router)


@app.get("/", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "los-lirios-api"}
