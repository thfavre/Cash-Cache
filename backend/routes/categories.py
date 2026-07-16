from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..database import get_db
from ..models import Category
from ..history import log_history

router = APIRouter(prefix="/categories", tags=["categories"])


class CategoryOut(BaseModel):
    id: int
    name: str
    color: str
    icon: str
    rules: list[str]
    is_savings: bool
    is_ignored: bool

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str
    color: str = "#6B7280"
    icon: str = "❓"
    rules: list[str] = []
    is_savings: bool = False
    is_ignored: bool = False


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    rules: Optional[list[str]] = None
    is_savings: Optional[bool] = None
    is_ignored: Optional[bool] = None


@router.get("", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(Category).order_by(Category.name).all()


@router.post("", response_model=CategoryOut)
def create_category(body: CategoryCreate, db: Session = Depends(get_db)):
    cat = Category(**body.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/{cat_id}", response_model=CategoryOut)
def update_category(cat_id: int, body: CategoryUpdate, db: Session = Depends(get_db)):
    from ..models import Transaction
    from ..categorizer import categorize
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    previous_rules = list(cat.rules or [])
    previous_is_ignored = cat.is_ignored
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(cat, field, value)

    if body.is_ignored is not None and body.is_ignored != previous_is_ignored:
        # Toggling the ignore flag retroactively updates already-assigned transactions
        db.query(Transaction).filter(Transaction.category_id == cat_id).update(
            {"is_internal": body.is_ignored}
        )

    db.commit()
    db.refresh(cat)

    removed = []
    if body.rules is not None and list(body.rules) != previous_rules:
        added = [r for r in body.rules if r not in previous_rules]
        removed = [r for r in previous_rules if r not in body.rules]
        bits = []
        if added:
            bits.append(f"+{', '.join(added)}")
        if removed:
            bits.append(f"-{', '.join(removed)}")
        log_history(
            db, action="edit_rules",
            summary=f"Mots-clés modifiés pour {cat.name} ({' '.join(bits)})",
            payload={"category_id": cat.id, "previous_rules": previous_rules},
        )

    if removed:
        # Re-evaluate transactions currently in this category: any that were only
        # matched by a now-removed keyword must fall through to whatever they still
        # match (another category, or "Non catégorisé").
        all_categories = db.query(Category).all()
        affected_txs = db.query(Transaction).filter(
            Transaction.category_id == cat_id,
            Transaction.is_reversal == False,
        ).all()
        changes = []
        for tx in affected_txs:
            new_cat_id = categorize(tx, all_categories)
            if new_cat_id != cat_id:
                changes.append({"tx_id": tx.id, "previous_category_id": cat_id, "new_category_id": new_cat_id})
                tx.category_id = new_cat_id
        if changes:
            db.commit()
            log_history(
                db, action="recategorize",
                summary=f"{len(changes)} transaction(s) déplacée(s) hors de {cat.name} suite à la suppression de mot(s)-clé(s)",
                payload={"category_id": cat.id, "changes": changes},
            )

    return cat


@router.delete("/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    from ..models import Budget, Transaction
    db.query(Transaction).filter(Transaction.category_id == cat_id).update({"category_id": None})

    # Drop the deleted category out of any budget that targets it — otherwise
    # the budget silently stops matching any transaction (its target becomes
    # unresolvable) and its card renders with a blank label forever.
    for budget in db.query(Budget).filter(Budget.target_type == "category").all():
        if cat_id not in (budget.category_ids or []):
            continue
        remaining = [c for c in budget.category_ids if c != cat_id]
        if remaining:
            budget.category_ids = remaining
        else:
            db.delete(budget)

    db.delete(cat)
    db.commit()
    return {"ok": True}


class RulePreviewIn(BaseModel):
    rule: str


@router.post("/preview-rule")
def preview_rule(body: RulePreviewIn, db: Session = Depends(get_db)):
    """
    Dry-run a single rule (no "re:" prefix required detection is shared with
    recategorize's matcher) against all active transactions, without saving
    anything — lets the UI show "N transactions concernées" before the user
    commits to adding the rule.
    """
    from ..models import Account, Transaction
    from ..categorizer import _normalize, rule_match_len
    rule = body.rule.strip()
    if not rule:
        return {"count": 0, "transactions": []}

    txs = db.query(Transaction).filter(
        Transaction.is_reversal == False,
        Transaction.is_internal == False,
        Transaction.account.has(Account.is_active == True),
    ).all()

    matched = []
    for tx in txs:
        search = _normalize(" | ".join(filter(None, [
            tx.description or "", tx.counterparty or "", tx.remittance_info or ""
        ])))
        if rule_match_len(rule, search) is not None:
            matched.append(tx)

    return {
        "count": len(matched),
        "transactions": [
            {
                "id": tx.id,
                "date": tx.date,
                "description": tx.description,
                "counterparty": tx.counterparty,
                "amount": tx.amount,
                "is_credit": tx.is_credit,
            }
            # Cap the payload — the count above is still the true total,
            # this is just enough rows for a compact preview list.
            for tx in matched[:200]
        ],
    }


@router.post("/{cat_id}/recategorize")
def recategorize(cat_id: int, db: Session = Depends(get_db)):
    """
    Apply this category's rules to ALL non-internal, non-reversal transactions.
    Returns how many were newly assigned to this category.
    """
    from ..models import Account, Transaction
    from ..categorizer import _normalize, rule_match_len
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if not cat.rules:
        return {"updated": 0}

    txs = db.query(Transaction).filter(
        Transaction.is_reversal == False,
        Transaction.is_internal == False,
        Transaction.account.has(Account.is_active == True),
    ).all()

    changes = []
    changed_txs = []
    for tx in txs:
        search = _normalize(" | ".join(filter(None, [
            tx.description or "", tx.counterparty or "", tx.remittance_info or ""
        ])))
        for rule in cat.rules:
            if rule_match_len(rule, search) is not None:
                if tx.category_id != cat_id:
                    changes.append({"tx_id": tx.id, "previous_category_id": tx.category_id})
                    changed_txs.append(tx)
                    tx.category_id = cat_id
                if cat.is_ignored:
                    tx.is_internal = True
                break

    db.commit()

    if changes:
        log_history(
            db, action="recategorize",
            summary=f"{len(changes)} transaction(s) recatégorisée(s) vers {cat.name}",
            payload={"category_id": cat.id, "changes": changes},
        )

    return {
        "updated": len(changes),
        "transactions": [
            {
                "id": tx.id,
                "date": tx.date,
                "description": tx.description,
                "counterparty": tx.counterparty,
                "amount": tx.amount,
                "is_credit": tx.is_credit,
            }
            for tx in changed_txs
        ],
    }
