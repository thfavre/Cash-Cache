"""
Rule-based transaction categorizer.
Each category has a list of keyword strings; matching is case-insensitive
and checked against (description, counterparty, remittance_info).
"""
from __future__ import annotations
from typing import Optional
from sqlalchemy.orm import Session


DEFAULT_CATEGORIES = [
    {
        "name": "Salaire",
        "color": "#22C55E",
        "icon": "💼",
        "rules": [
            "ETAT DE VAUD", "Working Bicycle", "versement salaire",
            "Crédit salaire", "DPT DES FINANCES",
        ],
    },
    {
        "name": "Alimentation",
        "color": "#F97316",
        "icon": "🛒",
        "rules": [
            "MIGROS", "COOP", "LIDL", "ALDI", "DENNER", "MANOR",
            "VOLG", "SPAR", "USEGO", "AVEC", "K-KIOSK",
        ],
    },
    {
        "name": "Transport",
        "color": "#3B82F6",
        "icon": "🚆",
        "rules": [
            "SBB MOBILE", "SBB AG", "CFF", "BLS", "POSTCAR",
            "TPF", "TPN", "UNIRESO", "MOBILITY", "TPG", "TRAVYS",
        ],
    },
    {
        "name": "Restaurants",
        "color": "#EF4444",
        "icon": "🍽️",
        "rules": [
            "RESTAURANT", "PIZZERIA", "KEBAB", "BURGER",
            "MCDONALD", "SUSHI", "BRASSERIE", "TRATTORIA",
        ],
    },
    {
        "name": "Bars & Sorties",
        "color": "#8B5CF6",
        "icon": "🍺",
        "rules": ["BAR ", " BAR", "PUB ", "LOUNGE", "NIGHTCLUB"],
    },
    {
        "name": "Shopping",
        "color": "#EC4899",
        "icon": "🛍️",
        "rules": [
            "DIGITEC", "GALAXUS", "TEMU", "AMAZON", "ZALANDO",
            "H&M", "ZARA", "FNAC", "INTERDISCOUNT", "IKEA", "MANOR TEXTILE",
        ],
    },
    {
        "name": "Santé",
        "color": "#14B8A6",
        "icon": "🏥",
        "rules": [
            "PHARMACIE", "MEDECIN", "HOPITAL", "CLINIQUE",
            "IMAGERIE", "PATHOLOGIE", "DENTISTE", "BLOCH",
            "CIM CENTRE", "INSTITUT DE PATHOLOGIE",
        ],
    },
    {
        "name": "Télécom",
        "color": "#6366F1",
        "icon": "📱",
        "rules": ["SALT MOBILE", "SUNRISE", "SWISSCOM", "INFOMANIAK"],
    },
    {
        "name": "Loisirs & Voyages",
        "color": "#F59E0B",
        "icon": "🎮",
        "rules": [
            "BOOKING.COM", "AIRBNB", "HOTEL", "INSTANT GAMING",
            "STEAM", "NETFLIX", "SPOTIFY", "INFOMANIAK ENTERTAINMENT",
            "TICKETCORNER", "WEEZEVENT", "NJUKO",
        ],
    },
    {
        "name": "Investissements",
        "color": "#10B981",
        "icon": "📈",
        "rules": ["INTERACTIVE BROKERS", "BROKER"],
        "is_savings": True,
    },
    {
        "name": "Impôts",
        "color": "#6B7280",
        "icon": "🏛️",
        "rules": [
            "IMPOT", "IMPÔT", "FISCAL", "ICC", "IFD",
            "ADMINISTRATION CANTONALE", "ADMINISTRATION FEDERALE",
            "ACOMPTE ICC", "Etat de Vaud - Impôts",
        ],
    },
    {
        "name": "Assurances",
        "color": "#92400E",
        "icon": "🛡️",
        "rules": [
            "ASSURANCE", "ECA ", "LAA", "LCA",
            "GENERALI", "ZURICH ASSUR", "AXA", "HELVETIA",
            "GROUPE MUTUEL", "HELSANA", "SWICA", "ETABL. ASS.",
        ],
    },
    {
        "name": "Loyer & Logement",
        "color": "#1D4ED8",
        "icon": "🏠",
        "rules": ["LOYER", "CAUTION LOYER", "CHARGES LOCATIVES"],
    },
    {
        "name": "Virements internes",
        "color": "#9CA3AF",
        "icon": "🔄",
        "rules": [
            "Transfert sur Compte", "Transfert depuis Compte",
            "Total du bouclement",
        ],
    },
    {
        "name": "Wellness & Bien-être",
        "color": "#D946EF",
        "icon": "✨",
        "rules": [
            "COIFFEUR", "COIFFURE", "BARBER", "ONGLE", "ONGLES",
            "MASSAGE", "INSTITUT DE BEAUTE", "SALON DE BEAUTE",
            "SPA ", "BIEN-ETRE", "BIEN-ÊTRE",
        ],
    },
    {
        "name": "Non catégorisé",
        "color": "#D1D5DB",
        "icon": "❓",
        "rules": [],
    },
]


def seed_default_categories(db: Session) -> None:
    from .models import Category, Transaction
    from .history import log_history
    for cat_data in DEFAULT_CATEGORIES:
        exists = db.query(Category).filter(Category.name == cat_data["name"]).first()
        if not exists:
            new_cat = Category(**cat_data)
            db.add(new_cat)
            db.commit()
            db.refresh(new_cat)
            print(f"Seeded new default category: {new_cat.name}")

            # Auto-recategorize transactions for the new category
            if new_cat.rules:
                txs = db.query(Transaction).filter(
                    Transaction.is_reversal == False,
                    Transaction.is_internal == False,
                ).all()
                changes = []
                for tx in txs:
                    search = " | ".join(filter(None, [
                        tx.description or "", tx.counterparty or "", tx.remittance_info or ""
                    ])).upper()
                    for rule in new_cat.rules:
                        if rule.upper() in search:
                            if tx.category_id != new_cat.id:
                                changes.append({"tx_id": tx.id, "previous_category_id": tx.category_id})
                                tx.category_id = new_cat.id
                            break
                if changes:
                    db.commit()
                    log_history(
                        db, action="recategorize",
                        summary=f"{len(changes)} transaction(s) recatégorisée(s) vers {new_cat.name} lors du premier import",
                        payload={"category_id": new_cat.id, "changes": changes},
                    )
                    print(f"Auto-categorized {len(changes)} transactions to {new_cat.name}")


def categorize(tx, categories: list) -> Optional[int]:
    """
    Match a transaction against category rules.
    Returns the category id of the first match, or the 'Non catégorisé' id.
    """
    search_text = " | ".join(filter(None, [
        tx.description or "",
        tx.counterparty or "",
        tx.remittance_info or "",
    ])).upper()

    uncategorized_id = None
    for cat in categories:
        if cat.name == "Non catégorisé":
            uncategorized_id = cat.id
            continue
        if not cat.rules:
            continue
        for rule in cat.rules:
            if rule.upper() in search_text:
                return cat.id

    return uncategorized_id
