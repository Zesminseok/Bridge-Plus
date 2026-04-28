@echo off
REM BRIDGE+ / Pro DJ Link Bridge / TCNet 잔여 프로세스 + 포트 정리 (Windows)
REM 사용법: 더블클릭 또는 cmd 에서 cleanup-win.bat 실행
REM         관리자 권한 권장 (우클릭 → "관리자 권한으로 실행")

setlocal enabledelayedexpansion
chcp 65001 >nul

echo ═══ BRIDGE+ / TCNet 정리 시작 ═══
echo.

echo [1/3] 관련 프로세스 종료...
for %%P in ("BRIDGE+.exe" "BRIDGE+ 0.9.3-stub.exe" "ProDJLinkBridge.exe" "Pro DJ Link Bridge.exe" "Electron.exe" "rekordbox.exe") do (
    taskkill /F /IM %%~P /T >nul 2>&1
    if !errorlevel! == 0 echo   ▸ %%~P 종료됨
)

REM 부분 매칭으로 BRIDGE+ 모든 빌드 잡기
for /f "tokens=2 delims=," %%P in ('tasklist /FO CSV /NH ^| findstr /I "BRIDGE+"') do (
    set "pid=%%~P"
    taskkill /F /PID !pid! /T >nul 2>&1
    echo   ▸ PID !pid! 종료됨
)

echo.
echo [2/3] 포트 점유 프로세스 종료...
set "PORTS=60000 60001 60002 50000 50001 50002 50003 50004 50005 50006 50007 12523 12524"

for %%P in (%PORTS%) do (
    REM UDP 포트 확인
    for /f "tokens=5" %%A in ('netstat -ano -p UDP ^| findstr ":%%P "') do (
        set "pid=%%A"
        if "!pid!" NEQ "0" if "!pid!" NEQ "" (
            taskkill /F /PID !pid! /T >nul 2>&1
            if !errorlevel! == 0 echo   ▸ port %%P (UDP) PID !pid! 종료
        )
    )
    REM TCP 포트 확인 (dbserver)
    for /f "tokens=5" %%A in ('netstat -ano -p TCP ^| findstr ":%%P "') do (
        set "pid=%%A"
        if "!pid!" NEQ "0" if "!pid!" NEQ "" (
            taskkill /F /PID !pid! /T >nul 2>&1
            if !errorlevel! == 0 echo   ▸ port %%P (TCP) PID !pid! 종료
        )
    )
)

echo.
echo [3/3] 정리 후 점유 확인...
set "remaining=0"
for %%P in (%PORTS%) do (
    netstat -ano -p UDP | findstr ":%%P " >nul 2>&1
    if !errorlevel! == 0 (
        echo   ⚠ UDP port %%P 아직 점유:
        netstat -ano -p UDP ^| findstr ":%%P "
        set /a remaining+=1
    )
    netstat -ano -p TCP | findstr ":%%P " >nul 2>&1
    if !errorlevel! == 0 (
        echo   ⚠ TCP port %%P 아직 점유:
        netstat -ano -p TCP ^| findstr ":%%P "
        set /a remaining+=1
    )
)

echo.
if "!remaining!" == "0" (
    echo ✅ 정리 완료 — 모든 BRIDGE+/TCNet/PDJL 포트 해제됨
) else (
    echo ⚠️ !remaining! 개 포트가 여전히 점유 중.
    echo    관리자 권한으로 다시 실행하면 잡힐 수 있습니다.
)
echo ═════════════════════════════════
echo.
pause
