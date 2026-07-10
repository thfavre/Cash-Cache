from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from ..database import get_db
from ..models import Setting

router = APIRouter(prefix="/settings", tags=["settings"])


class ThemeFavoritesBody(BaseModel):
    favorites: list[str]


@router.get("/theme-favorites")
def get_theme_favorites(db: Session = Depends(get_db)):
    row = db.query(Setting).filter(Setting.key == "theme_favorites").first()
    return {"favorites": row.value if row else []}


@router.put("/theme-favorites")
def set_theme_favorites(body: ThemeFavoritesBody, db: Session = Depends(get_db)):
    row = db.query(Setting).filter(Setting.key == "theme_favorites").first()
    if row:
        row.value = body.favorites
    else:
        row = Setting(key="theme_favorites", value=body.favorites)
        db.add(row)
    db.commit()
    return {"favorites": body.favorites}
