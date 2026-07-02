# Start Finance Dashboard (backend + frontend)

$root = $PSScriptRoot

Write-Host "Starting backend on http://localhost:8000 ..."
$backend = Start-Process -FilePath "py" -ArgumentList "-3.12 -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload" -WorkingDirectory $root -PassThru
Write-Host "Backend PID: $($backend.Id)"

Start-Sleep -Seconds 3

Write-Host "Starting frontend on http://localhost:5173 ..."
$frontend = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -WorkingDirectory "$root\frontend" -PassThru
Write-Host "Frontend PID: $($frontend.Id)"

Write-Host ""
Write-Host "Finance Dashboard is running!"
Write-Host "  -> Open http://localhost:5173 in your browser"
Write-Host ""
Write-Host "Press CTRL+C or close this window to stop."

try {
    while ($true) { Start-Sleep -Seconds 5 }
} finally {
    $backend | Stop-Process -Force -ErrorAction SilentlyContinue
    $frontend | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "Servers stopped."
}
