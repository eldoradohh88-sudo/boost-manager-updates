@echo off
chcp 65001 >nul
title Flowey's Software Manager - Publier une mise a jour
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
if not exist node_modules\electron-updater goto noinstall
call node check-logo.js
if errorlevel 1 goto badlogo
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-icon.ps1"
if errorlevel 1 goto badlogo
findstr /C:"TON-PSEUDO-GITHUB" "package.json" >nul
if not errorlevel 1 goto nogh
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set CUR=%%v
for /f "delims=" %%o in ('node -p "require('./package.json').build.publish[0].owner"') do set OWNER=%%o
echo.
echo  ==============================================
echo    PUBLIER UNE MISE A JOUR
echo  ==============================================
echo.
echo  Version actuelle : %CUR%
echo  Choisis un numero plus grand, par exemple : 2.2.1
echo.
set /p NEW=  Nouvelle version : 
if "%NEW%"=="" exit /b
call npm version %NEW% --no-git-tag-version --allow-same-version >nul
if errorlevel 1 goto badversion
echo.
echo  Creation de la version %NEW%... (2 a 5 minutes)
call npm run dist
if errorlevel 1 goto fail
start "" "%~dp0dist"
start "" "https://github.com/%OWNER%/boost-manager-updates/releases/new?tag=v%NEW%&title=Version%%20%NEW%"
echo.
echo  ==============================================
echo   DERNIERE ETAPE, dans la page GitHub qui s'ouvre :
echo  ==============================================
echo   1. Glisse ces 3 fichiers du dossier "dist" dans la zone
echo      "Attach binaries" en bas de la page :
echo        - Flowey-Software-Manager-Setup-%NEW%.exe
echo        - Flowey-Software-Manager-Setup-%NEW%.exe.blockmap
echo        - latest.yml
echo   2. Attends que les 3 fichiers soient envoyes.
echo   3. Clique sur le bouton vert "Publish release".
echo.
echo  C'est tout : les apps de ton equipe se mettront a jour toutes seules.
echo.
pause
exit /b
:badversion
echo  Numero de version invalide. Exemple valide : 2.2.1
pause
exit /b
:nogh
echo.
set /p GHUSER=  Ton pseudo GitHub (le meme que d'habitude) : 
if "%GHUSER%"=="" goto nogh
call node -e "const fs=require('fs');const f='package.json';fs.writeFileSync(f,fs.readFileSync(f,'utf8').split('TON-PSEUDO-GITHUB').join(process.argv[1].trim()))" "%GHUSER%"
echo  Pseudo enregistre : %GHUSER%
goto :elevated
:noinstall
echo  Lance d'abord 1-INSTALLER.bat
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
