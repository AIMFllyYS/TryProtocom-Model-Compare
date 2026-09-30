@echo off
rem Bench Workbench 一键启动。仓库已附带构建产物，只需 Node.js 即可运行网页版。
rem 用法：Start-Workbench.cmd            启动网页版 http://127.0.0.1:41873 并打开浏览器
rem       Start-Workbench.cmd desktop    启动桌面版（Electron：原生 DevTools、移动端模拟；首次需安装依赖）
rem       Start-Workbench.cmd rebuild    重新构建后启动
rem       Start-Workbench.cmd pet        召唤桌面宠物（右下角状态精灵，需要已 npm install）
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Bench Workbench
if "%WB_PORT%"=="" set "WB_PORT=41873"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] 未找到 Node.js。请安装 Node.js 20 或更新版本：https://nodejs.org/
  pause
  exit /b 1
)

set "NEEDBUILD="
set "NEEDDEPS="
if /i "%~1"=="rebuild" set "NEEDBUILD=1"
if not exist "workbench\dist\index.html" set "NEEDBUILD=1"
if not exist "workbench\dist-node\server.cjs" set "NEEDBUILD=1"
if /i "%~1"=="desktop" if not exist "workbench\desktop\app\main.cjs" set "NEEDBUILD=1"
if defined NEEDBUILD set "NEEDDEPS=1"
if /i "%~1"=="desktop" if not exist "workbench\node_modules\electron\dist\electron.exe" set "NEEDDEPS=1"

if defined NEEDDEPS if not exist "workbench\node_modules\vite" (
  echo [*] 安装依赖（只需一次）...
  pushd workbench
  call npm install --no-audit --no-fund
  if errorlevel 1 ( popd & echo [x] 依赖安装失败 & pause & exit /b 1 )
  popd
)
if defined NEEDBUILD (
  echo [*] 构建工作台...
  pushd workbench
  call npm run build
  if errorlevel 1 ( popd & echo [x] 构建失败 & pause & exit /b 1 )
  popd
)

if /i "%~1"=="desktop" (
  if exist "workbench\release\Bench-Workbench-1.0.0-portable.exe" (
    start "" "workbench\release\Bench-Workbench-1.0.0-portable.exe"
  ) else (
    start "" "workbench\node_modules\electron\dist\electron.exe" workbench
  )
  exit /b 0
)

if /i "%~1"=="pet" (
  rem 桌面宠物：确保服务在运行，再通过服务召唤（宠物是独立的轻量 Electron 小窗）
  node "workbench\dist-node\wb.cjs" pet
  exit /b %errorlevel%
)

node -e "fetch('http://127.0.0.1:%WB_PORT%/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
if not errorlevel 1 (
  echo [√] 工作台已在运行，打开浏览器：http://127.0.0.1:%WB_PORT%
  start "" "http://127.0.0.1:%WB_PORT%"
  exit /b 0
)

echo [*] 启动 Bench Workbench（关闭此窗口或按 Ctrl+C 退出）
node "workbench\dist-node\server.cjs" --open
if errorlevel 1 pause
