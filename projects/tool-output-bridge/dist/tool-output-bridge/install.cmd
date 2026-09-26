@echo off
node "%~dp0installer.mjs" install %*
exit /b %errorlevel%
