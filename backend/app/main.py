from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, finanzas, notificaciones, parcelas, produccion, users

app = FastAPI(
    title="Los Lirios API",
    description="Agricultural management system",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(parcelas.router)
app.include_router(finanzas.router)
app.include_router(produccion.router)
app.include_router(notificaciones.router)


@app.get("/", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "los-lirios-api"}
