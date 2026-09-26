@echo off
node "%~dp0installer.mjs" uninstall %*
exit /b %errorlevel%
