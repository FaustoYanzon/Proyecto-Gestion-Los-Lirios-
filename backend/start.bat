@echo off
cd /d "%~dp0"
call venv\Scripts\activate.bat
echo Iniciando servidor Los Lirios SA...
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pause
