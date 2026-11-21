@echo off
cd /d "%~dp0"
python -m pip show Flask python-dotenv requests reportlab >nul 2>&1
if errorlevel 1 (
  echo Instale as dependencias: python -m pip install -r requirements.txt
  pause
  exit /b 1
)
python app.py
pause
