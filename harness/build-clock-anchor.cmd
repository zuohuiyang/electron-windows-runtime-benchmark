@echo off
rem Run from an x64 MSVC Developer Command Prompt. No fixed VS installation path.
pushd "%~dp0"
cl.exe /nologo /O2 /MT /EHsc /W4 clock-anchor.cc /Fe:clock-anchor.exe
set "bench_build_exit=%errorlevel%"
popd
exit /b %bench_build_exit%
