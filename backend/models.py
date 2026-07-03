from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Date, DateTime, ForeignKey, JSON, UniqueConstraint
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
    budgets = relationship("Budget", back_populates="category")


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

    account = relationship("Account", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")


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


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("category_id", "month", name="uq_budget_cat_month"),)

    id = Column(Integer, primary_key=True, index=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    month = Column(String, nullable=False)   # YYYY-MM
    amount_limit = Column(Float, nullable=False)

    category = relationship("Category", back_populates="budgets")
