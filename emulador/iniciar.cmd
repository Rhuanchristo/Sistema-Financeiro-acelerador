@echo off
rem Liga os emuladores locais do Firebase (site em http://localhost:5050, painel em http://localhost:4000).
rem Depois de ligado, rode em outro terminal: node emulador\seed.mjs
cd /d "%~dp0.."
if exist "C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot\bin\java.exe" set "PATH=C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot\bin;%PATH%"
npx --yes firebase-tools@15.34.2 emulators:start --project demo-financeiro
