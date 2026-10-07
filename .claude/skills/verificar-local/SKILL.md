---
name: verificar-local
description: Probar un cambio de Los Lirios en local con click real antes de commitear/deployar (backend uvicorn + web npm + Claude in Chrome). Usar después de implementar y antes de commit/deploy.
---

# Verificar en local

Regla del proyecto: se prueba en local ANTES de commit/push/deploy.

1. Backend: `cd backend && ./venv/Scripts/python.exe -m uvicorn app.main:app --reload` (puerto 8000), en background.
2. Web: `cd frontend && npm run dev`, en background. Esperar a que responda (`curl -sf http://localhost:3000`).
3. Login con una cuenta local (login por `username`, no email). No leer ni imprimir `.env`.
4. Con Claude in Chrome (o el MCP de Playwright para flujos repetibles): recorrer el flujo cambiado como lo haría el usuario — crear/editar/borrar, estados vacíos, error de validación — y mirar consola y red (`read_console_messages`, `read_network_requests`).
5. Mobile: `npx tsc --noEmit`; para UI nativa pedirle al usuario que pruebe en Expo Go/dev build.
6. Reportar qué se probó y qué NO. Apagar los procesos que se levantaron.
