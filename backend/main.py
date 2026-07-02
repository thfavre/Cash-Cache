import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .database import engine, get_db, Base
from .models import Account, Transaction, Category, Budget
from .routes import transactions, categories, stats, budgets, predictions
from .parser import run_import

DATA_DIR = str(Path(__file__).parent.parent / "data")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = next(get_db())
    try:
        # Auto-import on first run (when DB is empty)
        if db.query(Account).count() == 0:
            print(f"First run — importing data from {DATA_DIR} ...")
            result = run_import(DATA_DIR, db)
            print(f"Imported: {result}")
        else:
            print("Database already populated — skipping auto-import.")
    finally:
        db.close()
    yield


app = FastAPI(title="Personal Finance API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transactions.router)
app.include_router(categories.router)
app.include_router(stats.router)
app.include_router(budgets.router)
app.include_router(predictions.router)


@app.post("/import")
def reimport(db: Session = Depends(get_db)):
    """Re-parse all XML files (use after dropping DB or adding new files)."""
    result = run_import(DATA_DIR, db)
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
