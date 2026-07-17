"""
Rule-based transaction categorizer.
Each category has a list of keyword strings; matching is case- and
accent-insensitive and checked against (description, counterparty,
remittance_info). A rule prefixed with "re:" is matched as a regular
expression instead of a plain substring.
"""
from __future__ import annotations
import re
import unicodedata
from typing import Optional
from sqlalchemy.orm import Session

REGEX_RULE_PREFIX = "re:"


def _normalize(text: str) -> str:
    """Uppercase and strip accents so e.g. 'rémunération' matches 'REMUNERATION'
    (Swiss bank exports sometimes mangle accented characters)."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.upper()


def rule_match_len(rule: str, normalized_search_text: str) -> Optional[int]:
    """
    Returns the length of what `rule` matched in `normalized_search_text`
    (already run through _normalize), or None if it doesn't match. A rule
    prefixed with "re:" is compiled as a case-insensitive regex; an invalid
    pattern is treated as "never matches" rather than raising. Everything
    else matches as a plain substring, same as before. The match length lets
    a more specific rule (e.g. "UBER EATS") win over a broader one ("UBER")
    regardless of category order.
    """
    if rule.startswith(REGEX_RULE_PREFIX):
        pattern = rule[len(REGEX_RULE_PREFIX):]
        if not pattern:
            return None
        try:
            m = re.search(pattern, normalized_search_text, re.IGNORECASE)
        except re.error:
            return None
        # A zero-width match (e.g. a quantifier-only pattern like "\d*" that
        # can match an empty string) carries no real signal — treating it as
        # a match would let it silently win category assignment for every
        # transaction, since even length 0 beats categorize()'s "nothing
        # found yet" sentinel of -1.
        return len(m.group(0)) if m and m.group(0) else None

    norm_rule = _normalize(rule)
    return len(norm_rule) if norm_rule and norm_rule in normalized_search_text else None


DEFAULT_CATEGORIES = [
    {
        "name": "Salaire",
        "color": "#22C55E",
        "icon": "💼",
        "rules": [
            "ETAT DE VAUD", "Working Bicycle", "versement salaire",
            "Crédit salaire", "DPT DES FINANCES",
            "TRAITEMENT SALARIAL", "re:\\bPAIE\\b", "VIREMENT SALAIRE", "RÉMUNÉRATION",
            "ALLOCATION FAMILIALE", "ALLOCATION DE MATERNITE",
            "RENTE AVS", "RENTE LPP", "INDEMNITE CHOMAGE",
            "INDEMNITE JOURNALIERE", "TREIZIEME SALAIRE",
            "REMBOURSEMENT DE FRAIS", "ADMINISTRATION CANTONALE DES FINANCES",
            "LOHN", "GEHALT",
        ],
    },
    {
        "name": "Alimentation",
        "color": "#F97316",
        "icon": "🛒",
        "rules": [
            "MIGROS", "COOP", "LIDL", "ALDI", "DENNER", "MANOR",
            "VOLG", "SPAR", "USEGO", "re:\\bAVEC\\b", "K-KIOSK",
            "MIGROLINO", "OTTO'S", "LANDI", "EPICERIE", "SUPERMARCHE",
            "BOULANGERIE", "BOUCHERIE", "MARCHE", "LEBENSMITTEL", "BÄCKEREI",
        ],
    },
    {
        "name": "Transport",
        "color": "#3B82F6",
        "icon": "🚆",
        "rules": [
            "SBB MOBILE", "SBB AG", "CFF", "BLS", "POSTCAR",
            "TPF", "TPN", "UNIRESO", "MOBILITY", "TPG", "TRAVYS",
            "LEMAN EXPRESS", "ZVV", "ESSENCE", "CARBURANT",
            "STATION-SERVICE", "PARKING", "PEAGE", "BILLET DE TRAIN",
            "ABONNEMENT DE TRANSPORT", "TAXI", "SHELL",
            "MIGROL", "TANKSTELLE", "FAHRKARTE", "UBER",
        ],
    },
    {
        "name": "Restaurants",
        "color": "#EF4444",
        "icon": "🍽️",
        "rules": [
            "RESTAURANT", "PIZZERIA", "KEBAB", "BURGER",
            "MCDONALD", "SUSHI", "BRASSERIE", "TRATTORIA",
            "FAST FOOD", "BISTROT", "TRAITEUR", "CAFE",
            "BURGER KING", "KFC", "SUBWAY", "STARBUCKS", "UBER EATS",
            "SMOOD", "JUST EAT", "HOLY COW", "TIBITS", "IMBISS",
        ],
    },
    {
        "name": "Bars & Sorties",
        "color": "#8B5CF6",
        "icon": "🍺",
        "rules": [
            "BAR ", " BAR", "PUB ", "LOUNGE", "NIGHTCLUB",
            "DISCOTHEQUE", "BOITE DE NUIT", "CAVE A VIN", "SOIREE",
            "COCKTAIL BAR", "CLUB", "HAPPY HOUR", "KARAOKE",
            "CASINO", "ROOFTOP", "KNEIPE", "BIERGARTEN",
        ],
    },
    {
        "name": "Shopping",
        "color": "#EC4899",
        "icon": "🛍️",
        "rules": [
            "DIGITEC", "GALAXUS", "TEMU", "AMAZON", "ZALANDO",
            "H&M", "ZARA", "FNAC", "INTERDISCOUNT", "IKEA", "MANOR TEXTILE",
            "C&A", "GLOBUS", "COOP CITY", "MEDIAMARKT", "MICASA", "CONFORAMA",
            "VÖGELE", "OCHSNER SPORT", "DECATHLON", "VETEMENTS",
            "CHAUSSURES", "MAGASIN", "ACHAT EN LIGNE", "KLEIDUNG", "GESCHÄFT",
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
            "OPTICIEN", "PHYSIOTHERAPEUTE", "OSTEOPATHE", "AMAVITA",
            "SUNSTORE", "SUN STORE", "PHARMACIE POPULAIRE", "COOP VITALITY", "CHUV",
            "HUG", "INSELSPITAL", "ARZT", "APOTHEKE", "ZAHNARZT",
        ],
    },
    {
        "name": "Télécom",
        "color": "#6366F1",
        "icon": "📱",
        "rules": [
            "SALT MOBILE", "SUNRISE", "SWISSCOM", "INFOMANIAK",
            "WINGO", "YALLO", "COOP MOBILE", "M-BUDGET MOBILE", "LYCAMOBILE",
            "UPC", "QUICKLINE", "IWAY", "FORFAIT MOBILE",
            "ABONNEMENT INTERNET", "TELEPHONIE", "HANDYABO", "INTERNETANSCHLUSS",
        ],
    },
    {
        "name": "Loisirs & Voyages",
        "color": "#F59E0B",
        "icon": "🎮",
        "rules": [
            "BOOKING.COM", "AIRBNB", "HOTEL", "INSTANT GAMING",
            "STEAM", "NETFLIX", "SPOTIFY", "INFOMANIAK ENTERTAINMENT",
            "TICKETCORNER", "WEEZEVENT", "NJUKO",
            "DISNEY+", "AMAZON PRIME VIDEO", "PLAYSTATION STORE", "XBOX", "NINTENDO ESHOP",
            "STARTICKET", "PATHE", "CINEMA", "CONCERT", "FESTIVAL",
            "MUSEE", "VOYAGE", "VACANCES", "EASYJET", "SWISS INTERNATIONAL",
            "RYANAIR", "LASTMINUTE.COM", "KINO", "REISE",
        ],
    },
    {
        "name": "Investissements",
        "color": "#10B981",
        "icon": "📈",
        "rules": [
            "INTERACTIVE BROKERS",
            "SWISSQUOTE", "POSTFINANCE E-TRADING", "YUH", "NEON INVEST",
            "SELMA FINANCE", "VIAC", "FRANKLY", "FINPENSION", "COINBASE",
            "KRAKEN", "BITPANDA", "INVESTISSEMENT", "COURTIER",
            "ACHAT D'ACTIONS", "EPARGNE TITRES", "3E PILIER", "ETF",
            "WERTSCHRIFTEN", "VORSORGE",
        ],
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
            "IMPOT FEDERAL DIRECT", "ACOMPTE D'IMPOT", "IMPOT A LA SOURCE",
            "TAXE VEHICULE", "REDEVANCE SERAFE", "AMENDE", "re:\\bTAXE\\b",
            "STEUERN", "BUSSE",
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
            "CSS", "SANITAS", "CONCORDIA", "VISANA", "ASSURA", "KPT",
            "LA MOBILIERE", "BALOISE", "LA VAUDOISE", "ALLIANZ",
            "PRIME D'ASSURANCE", "PRIME ASSURANCE", "KRANKENKASSE", "VERSICHERUNG",
        ],
    },
    {
        "name": "Loyer & Logement",
        "color": "#1D4ED8",
        "icon": "🏠",
        "rules": [
            "LOYER", "CAUTION LOYER", "CHARGES LOCATIVES",
            "REGIE IMMOBILIERE", "NAEF IMMOBILIER", "PRIVERA", "GEROFINANCE",
            "HYPOTHEQUE", "ELECTRICITE", "ROMANDE ENERGIE", "GROUPE E",
            "re:\\bGAZ\\b", "CHAUFFAGE", "ENTRETIEN", "SYNDIC",
            "MIETE", "NEBENKOSTEN", "HYPOTHEK",
        ],
    },
    {
        "name": "Remboursements entre amis",
        "color": "#0EA5E9",
        "icon": "🤝",
        "rules": [
            "REMBOURSEMENT ENTRE AMIS", "REMBOURSEMENT AMI", "REMBOURSEMENT AMIS",
        ],
    },
    {
        "name": "Virements internes",
        "color": "#9CA3AF",
        "icon": "🔄",
        "rules": [
            "Transfert sur Compte", "Transfert depuis Compte",
            "Total du bouclement", "Revolut Bank UAB",
            "VIREMENT INTERNE", "TRANSFERT ENTRE COMPTES",
            "VIREMENT COMPTE EPARGNE", "VIREMENT COMPTE JOINT",
            "ORDRE PERMANENT", "VERSEMENT EPARGNE", "TRANSFERT PROPRE COMPTE",
            "DAUERAUFTRAG",
        ],
        "is_ignored": True,
    },
    {
        "name": "Wellness & Bien-être",
        "color": "#D946EF",
        "icon": "✨",
        "rules": [
            "COIFFEUR", "COIFFURE", "BARBER", "ONGLE", "ONGLES",
            "MASSAGE", "INSTITUT DE BEAUTE", "SALON DE BEAUTE",
            "SPA ", "BIEN-ETRE", "BIEN-ÊTRE",
            "MANUCURE", "PEDICURE", "EPILATION", "SALON DE BRONZAGE",
            "ONGLERIE", "ESTHETICIENNE", "YOGA", "FITNESS", "KOSMETIK",
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

            # Auto-recategorize transactions for the new category, respecting
            # the same longest-match rule as categorize() against ALL categories
            # (so the new category only wins transactions where it's the best match)
            if new_cat.rules:
                all_categories = db.query(Category).all()
                txs = db.query(Transaction).filter(
                    Transaction.is_reversal == False,
                    Transaction.is_internal == False,
                ).all()
                changes = []
                for tx in txs:
                    if categorize(tx, all_categories) == new_cat.id and tx.category_id != new_cat.id:
                        changes.append({"tx_id": tx.id, "previous_category_id": tx.category_id})
                        tx.category_id = new_cat.id
                        if new_cat.is_ignored:
                            tx.is_internal = True
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
    Returns the category id whose matching keyword is the longest (so a more
    specific rule like "UBER EATS" wins over a shorter one like "UBER"
    regardless of category order), or the 'Non catégorisé' id if nothing matches.
    """
    search_text = _normalize(" | ".join(filter(None, [
        tx.description or "",
        tx.counterparty or "",
        tx.remittance_info or "",
    ])))

    uncategorized_id = None
    best_cat_id = None
    best_len = -1
    for cat in categories:
        if cat.name == "Non catégorisé":
            uncategorized_id = cat.id
            continue
        if not cat.rules:
            continue
        for rule in cat.rules:
            match_len = rule_match_len(rule, search_text)
            if match_len is not None and match_len > best_len:
                best_len = match_len
                best_cat_id = cat.id

    return best_cat_id if best_cat_id is not None else uncategorized_id
