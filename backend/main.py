import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, get_db, Base
from .models import Account, Transaction, Category, Budget
from .routes import transactions, categories, stats, budgets, history, settings, future, import_data
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
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE categories ADD COLUMN is_ignored BOOLEAN DEFAULT 0 NOT NULL"))
            print("Successfully migrated categories table: added is_ignored column.")
    except Exception as e:
        # Column already exists or table doesn't exist yet
        pass

    # import_batches/bank_profiles are new tables, created below by create_all.
    # transactions.import_batch_id is a new column on an existing table.
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN import_batch_id INTEGER"))
            print("Successfully migrated transactions table: added import_batch_id column.")
    except Exception as e:
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

        internal_cat = db.query(Category).filter(Category.name == "Virements internes").first()
        if internal_cat and not internal_cat.is_ignored:
            internal_cat.is_ignored = True
            db.commit()
            print("Set is_ignored=True for existing Virements internes category.")
    finally:
        db.close()
    yield


app = FastAPI(title="Personal Finance API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                    "http://localhost:5174", "http://127.0.0.1:5174",
                    "http://localhost:5175", "http://127.0.0.1:5175"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transactions.router)
app.include_router(categories.router)
app.include_router(stats.router)
app.include_router(budgets.router)
app.include_router(future.router)
app.include_router(history.router)
app.include_router(settings.router)
app.include_router(import_data.router)


@app.get("/health")
def health():
    return {"status": "ok"}
