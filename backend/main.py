import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .database import engine, get_db, Base
from .models import Account, Transaction, Category, Budget
from .routes import transactions, categories, stats, budgets, predictions, history
from .parser import run_import

DATA_DIR = str(Path(__file__).parent.parent / "data")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database schema is migrated
    from sqlalchemy import text
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE categories ADD COLUMN is_savings BOOLEAN DEFAULT 0 NOT NULL"))
            print("Successfully migrated categories table: added is_savings column.")
    except Exception as e:
        # Column already exists or table doesn't exist yet
        pass

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

        # Seed existing category state
        from .categorizer import seed_default_categories
        seed_default_categories(db)

        invest_cat = db.query(Category).filter(Category.name == "Investissements").first()
        if invest_cat and not invest_cat.is_savings:
            invest_cat.is_savings = True
            db.commit()
            print("Set is_savings=True for existing Investissements category.")
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
app.include_router(history.router)


@app.post("/import")
def reimport(db: Session = Depends(get_db)):
    """Re-parse all XML files (use after dropping DB or adding new files)."""
    result = run_import(DATA_DIR, db)
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
