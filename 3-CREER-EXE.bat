@echo off
chcp 65001 >nul
title Flowey's Software Manager - Creation du .exe
cd /d "%~dp0"
rem --- l'icone de l'exe demande les droits administrateur (ou le Mode developpeur Windows) ---
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /v AllowDevelopmentWithoutDevLicense 2>nul | find "0x1" >nul
if not errorlevel 1 goto elevated
net session >nul 2>&1
if not errorlevel 1 goto elevated
echo.
echo  Windows va te demander l'autorisation (fenetre "Oui / Non") : clique sur OUI.
echo  C'est necessaire pour mettre ton logo sur l'application.
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b
:elevated
if not exist node_modules goto noinstall
if not exist node_modules\electron-updater goto noinstall
findstr /C:"COLLE" "src\config.js" >nul
if not errorlevel 1 goto noconfig
call node check-logo.js
if errorlevel 1 goto badlogo
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-icon.ps1"
if errorlevel 1 goto badlogo
findstr /C:"TON-PSEUDO-GITHUB" "package.json" >nul
if not errorlevel 1 goto askgh
:build
echo.
echo  Creation du fichier d'installation... (2 a 5 minutes)
echo.
call npm run dist
if errorlevel 1 goto fail
echo.
echo  OK ! Le fichier d'installation est dans le dossier "dist" qui va s'ouvrir.
start "" "%~dp0dist"
pause
exit /b
:askgh
echo.
echo  Mises a jour automatiques : entre ton pseudo GitHub - voir TUTO, partie E.
echo  Si tu n'as pas encore de compte GitHub, appuie juste sur Entree : l'app marchera,
echo  mais sans mises a jour automatiques.
echo.
set /p GHUSER=  Ton pseudo GitHub : 
if "%GHUSER%"=="" goto build
call node -e "const fs=require('fs');const f='package.json';fs.writeFileSync(f,fs.readFileSync(f,'utf8').split('TON-PSEUDO-GITHUB').join(process.argv[1].trim()))" "%GHUSER%"
echo  Pseudo enregistre : %GHUSER%
goto build
:noinstall
echo  Lance d'abord 1-INSTALLER.bat
pause
exit /b
:noconfig
echo.
echo  STOP : le fichier src\config.js n'est pas rempli.
echo  Colle d'abord l'URL et la cle Supabase dedans - voir TUTO, etape 4.
echo.
pause
exit /b
:fail
echo.
echo  ERREUR. Fais une capture de cette fenetre et envoie-la a Claude.
pause
exit /b
:badlogo
pause
exit /b
