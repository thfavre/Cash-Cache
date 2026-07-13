from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Date, DateTime, ForeignKey, JSON
)
from sqlalchemy.orm import relationship
from .database import Base


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    iban = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    currency = Column(String, default="CHF")
    opening_balance = Column(Float, default=0.0)
    closing_balance = Column(Float, default=0.0)

    transactions = relationship("Transaction", back_populates="account")


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    color = Column(String, default="#6B7280")
    icon = Column(String, default="❓")
    rules = Column(JSON, default=list)
    is_savings = Column(Boolean, default=False, nullable=False)
    is_ignored = Column(Boolean, default=False, nullable=False)

    transactions = relationship("Transaction", back_populates="category")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    value_date = Column(Date)
    amount = Column(Float, nullable=False)
    is_credit = Column(Boolean, nullable=False)
    description = Column(String)       # AddtlNtryInf — primary display text
    counterparty = Column(String)      # Cdtr or Dbtr name
    counterparty_iban = Column(String)
    remittance_info = Column(String)   # Ustrd or Strd/AddtlRmtInf
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    tx_code = Column(String)           # e.g. PMNT/RCDT/DMCT
    bank_ref = Column(String, unique=True, nullable=False)  # AcctSvcrRef (unique per bank)
    uetr = Column(String, index=True)  # UUID for cross-account transfer matching
    is_reversal = Column(Boolean, default=False)
    is_internal = Column(Boolean, default=False)
    import_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)

    account = relationship("Account", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")
    import_batch = relationship("ImportBatch", back_populates="transactions")


class HistoryEntry(Base):
    """
    Log of categorization actions (rule edits, single/bulk assignments) that
    can be reverted. `payload` holds whatever the revert logic for `action`
    needs — see backend/history.py.
    """
    __tablename__ = "history_entries"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    action = Column(String, nullable=False)   # "edit_rules" | "assign" | "recategorize"
    summary = Column(String, nullable=False)
    payload = Column(JSON, nullable=False)
    reverted = Column(Boolean, default=False)


class Setting(Base):
    """Small key-value store for user preferences that should survive
    clearing browser storage (e.g. theme favorites)."""
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(JSON, nullable=False)


class Budget(Base):
    __tablename__ = "budgets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)              # optional label shown on the card
    amount_limit = Column(Float, nullable=False)

    period_type = Column(String, nullable=False, default="monthly")   # daily|weekly|monthly|annual|custom
    period_days = Column(Integer, nullable=True)        # only used when period_type == "custom"
    start_date = Column(Date, nullable=False)           # anchor date the period(s) are computed from
    recurring = Column(Boolean, default=True, nullable=False)

    target_type = Column(String, nullable=False, default="category")  # category|merchant
    category_ids = Column(JSON, default=list)          # 1-2 category ids, used when target_type == "category"
    merchant_patterns = Column(JSON, default=list)      # 1-2 free-text patterns, used when target_type == "merchant"


class ImportBatch(Base):
    """One user-initiated file upload. Lets the Import page show what was
    imported and delete exactly the transactions that came from one file."""
    __tablename__ = "import_batches"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)      # original uploaded filename
    stored_path = Column(String, nullable=False)    # relative path under data/uploads/
    kind = Column(String, nullable=False)            # "camt" | "revolut" | "generic_csv"
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    transactions = relationship("Transaction", back_populates="import_batch")


class BankProfile(Base):
    """A saved column-mapping for a generic (non-CAMT, non-Revolut) CSV
    format, so the same bank's export doesn't need remapping every time."""
    __tablename__ = "bank_profiles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    header_signature = Column(JSON, nullable=False)  # sorted list of CSV column headers
    mapping = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
