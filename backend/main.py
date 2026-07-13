import os
from contextlib import asynccontextmanager
from datetime import date
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

    # Budget table redesign: recurring periods (daily/weekly/monthly/annual/custom)
    # and category-or-merchant targets, replacing the old single category_id+month row.
    # The legacy table has a UNIQUE(category_id, month) constraint that SQLite won't
    # let us drop a column out from under, so migrate by rebuilding the table rather
    # than incremental ALTERs. Each statement runs in its own transaction (SQLite's
    # driver implicitly commits around DDL, so a single wrapped transaction can't be
    # relied on for atomicity here) and every step is written to be safely re-runnable
    # in case the process is interrupted partway through.
    import json as _json

    def _table_cols(name: str) -> set[str]:
        with engine.begin() as conn:
            return {row[1] for row in conn.execute(text(f"PRAGMA table_info({name})")).fetchall()}

    def _table_exists(name: str) -> bool:
        with engine.begin() as conn:
            return conn.execute(
                text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:n"), {"n": name}
            ).first() is not None

    try:
        budgets_cols = _table_cols("budgets")
        needs_rebuild = bool(budgets_cols) and "category_id" in budgets_cols
        legacy_source = "budgets_legacy" if _table_exists("budgets_legacy") else ("budgets" if needs_rebuild else None)

        if legacy_source:
            source_cols = _table_cols(legacy_source)
            wanted_cols = ["id", "category_id", "month", "amount_limit", "name", "period_type", "period_days",
                           "start_date", "recurring", "target_type", "category_ids", "merchant_patterns"]
            select_list = ", ".join(c if c in source_cols else f"NULL AS {c}" for c in wanted_cols)
            with engine.begin() as conn:
                old_rows = conn.execute(text(f"SELECT {select_list} FROM {legacy_source}")).fetchall()

            if legacy_source == "budgets":
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE budgets RENAME TO budgets_legacy"))

            with engine.begin() as conn:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS budgets (
                        id INTEGER NOT NULL PRIMARY KEY,
                        name VARCHAR,
                        amount_limit FLOAT NOT NULL,
                        period_type VARCHAR NOT NULL DEFAULT 'monthly',
                        period_days INTEGER,
                        start_date DATE NOT NULL,
                        recurring BOOLEAN NOT NULL DEFAULT 1,
                        target_type VARCHAR NOT NULL DEFAULT 'category',
                        category_ids JSON,
                        merchant_patterns JSON
                    )
                """))
            with engine.begin() as conn:
                conn.execute(text("DROP INDEX IF EXISTS ix_budgets_id"))
                conn.execute(text("CREATE INDEX ix_budgets_id ON budgets (id)"))

            with engine.begin() as conn:
                for row in old_rows:
                    already_migrated = row.category_ids is not None
                    cat_ids = row.category_ids if already_migrated else _json.dumps(
                        [row.category_id] if row.category_id else []
                    )
                    start_date = row.start_date or (f"{row.month}-01" if row.month else date.today().isoformat())
                    conn.execute(
                        text(
                            "INSERT OR IGNORE INTO budgets (id, name, amount_limit, period_type, period_days, "
                            "start_date, recurring, target_type, category_ids, merchant_patterns) VALUES "
                            "(:id, :name, :amount_limit, :period_type, :period_days, :start_date, :recurring, "
                            ":target_type, :cat_ids, :merchant_patterns)"
                        ),
                        {
                            "id": row.id,
                            "name": row.name,
                            "amount_limit": row.amount_limit,
                            "period_type": row.period_type or "monthly",
                            "period_days": row.period_days,
                            "start_date": start_date,
                            "recurring": row.recurring if row.recurring is not None else 1,
                            "target_type": row.target_type or "category",
                            "cat_ids": cat_ids,
                            "merchant_patterns": row.merchant_patterns if already_migrated else "[]",
                        },
                    )

            with engine.begin() as conn:
                conn.execute(text(f"DROP TABLE IF EXISTS {legacy_source}"))

            print(f"Successfully migrated {len(old_rows)} legacy budget row(s) to the new period/target schema.")
    except Exception as e:
        print(f"Budget table migration skipped: {e}")

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


app = FastAPI(title="Cash-Cache API", lifespan=lifespan)

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
