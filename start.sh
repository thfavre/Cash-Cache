#!/usr/bin/env bash
# Start Cash-Cache (FastAPI backend + Vite frontend)

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Find suitable python executable
if command -v python3.12 >/dev/null 2>&1; then
    PY_CMD="python3.12"
elif command -v python3 >/dev/null 2>&1; then
    PY_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PY_CMD="python"
else
    echo "Error: Python 3 not found in PATH."
    exit 1
fi

echo "Starting backend on http://127.0.0.1:8000 ($PY_CMD) ..."
$PY_CMD -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

sleep 2

echo "Starting frontend on http://localhost:5173 ..."
(cd "$ROOT_DIR/frontend" && npm run dev) &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

cleanup() {
    echo ""
    echo "Stopping servers..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    # Also kill process tree if needed
    pkill -P "$BACKEND_PID" 2>/dev/null || true
    pkill -P "$FRONTEND_PID" 2>/dev/null || true
    echo "Servers stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo ""
echo "=================================================="
echo " 💸 Cash-Cache is running!"
echo "    Dashboard:  http://localhost:5173"
echo "    API Docs:   http://localhost:8000/docs"
echo "=================================================="
echo "Press CTRL+C to stop both servers."
echo ""

# Wait indefinitely until signal
wait
