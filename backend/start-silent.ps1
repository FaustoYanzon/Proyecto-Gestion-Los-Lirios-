# Inicia uvicorn en background sin ventana visible.
# Para agregar al Task Scheduler de Windows:
#   Programa: powershell.exe
#   Argumentos: -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\claude-projects\los-lirios\backend\start-silent.ps1"
#   Disparador: Al iniciar sesion

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$uvicorn = Join-Path $backendDir "venv\Scripts\uvicorn.exe"

Start-Process -FilePath $uvicorn `
    -ArgumentList "app.main:app", "--host", "0.0.0.0", "--port", "8000" `
    -WorkingDirectory $backendDir `
    -WindowStyle Hidden
