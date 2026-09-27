@echo off
chcp 65001 >nul
title Flowey's Software Manager - Installation
cd /d "%~dp0"
echo.
echo  ==============================================
echo    BOOST MANAGER - Installation (1 a 3 minutes)
echo  ==============================================
echo.
where npm >nul 2>nul
if errorlevel 1 goto nonode
call npm install
if errorlevel 1 goto fail
echo.
echo  OK ! Installation terminee.
echo  Etape suivante : double-clique sur 2-TESTER.bat
echo.
pause
exit /b
:nonode
echo  ERREUR : Node.js n'est pas installe.
echo  Installe-le depuis https://nodejs.org - version LTS - puis redemarre le PC.
echo.
pause
exit /b
:fail
echo.
echo  ERREUR pendant l'installation. Fais une capture de cette fenetre et envoie-la a Claude.
echo.
pause
