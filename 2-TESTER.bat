@echo off
chcp 65001 >nul
title Flowey's Software Manager - Test
cd /d "%~dp0"
if not exist node_modules goto noinstall
echo  Ouverture de l'application... (ferme cette fenetre pour quitter l'app)
call npm start
exit /b
:noinstall
echo  Lance d'abord 1-INSTALLER.bat
pause
