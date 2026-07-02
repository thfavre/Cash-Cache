from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..database import get_db
from ..models import Category

router = APIRouter(prefix="/categories", tags=["categories"])


class CategoryOut(BaseModel):
    id: int
    name: str
    color: str
    icon: str
    rules: list[str]

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str
    color: str = "#6B7280"
    icon: str = "❓"
    rules: list[str] = []


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    rules: Optional[list[str]] = None


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
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(cat, field, value)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    # Unlink transactions from this category
    from ..models import Transaction
    db.query(Transaction).filter(Transaction.category_id == cat_id).update({"category_id": None})
    db.delete(cat)
    db.commit()
    return {"ok": True}
