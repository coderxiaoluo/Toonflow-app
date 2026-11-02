@echo off
setlocal
cd /d "%~dp0"

where bun >nul 2>&1
if errorlevel 1 (
  echo 未找到 bun，请先安装 Bun 并加入 PATH。
  pause
  exit /b 1
)

call :portOpen 3000
if errorlevel 1 start "Toonflow Server" cmd /k bun run dev:server

call :portOpen 5173
if errorlevel 1 start "Toonflow Web" cmd /k bun run dev:web

set /a tries=0
:waitWeb
call :portOpen 5173
if not errorlevel 1 goto open
set /a tries+=1
if %tries% geq 90 (
  echo 网页在 90 秒内没有起来，请看 Toonflow Web 窗口里的报错。
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitWeb

:open
start "" "http://localhost:5173/#/home"
exit /b 0

:portOpen
powershell -NoProfile -Command "try { $client = New-Object System.Net.Sockets.TcpClient; $client.Connect('127.0.0.1', %1); $client.Close(); exit 0 } catch { exit 1 }"
exit /b
