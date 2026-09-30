@echo off
rem Bench Workbench CLI：在仓库根目录运行 wb <命令>，例如 wb status / wb run new OpenAI/GPT-6.1-Sol T05 / wb check <ref> --json
setlocal
chcp 65001 >nul
if not exist "%~dp0workbench\dist-node\wb.cjs" (
  echo [x] CLI 尚未构建：先双击 Start-Workbench.cmd，或在 workbench\ 下运行 npm install ^&^& npm run build
  exit /b 1
)
node "%~dp0workbench\dist-node\wb.cjs" %*
