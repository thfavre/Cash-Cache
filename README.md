# Finance Dashboard

Personal finance dashboard for Swiss bank accounts (Raiffeisen, CAMT.053 format).

## Features

- **Dashboard** — balance overview, income vs. expenses, category breakdown, recent transactions
- **Transactions** — searchable and filterable list with inline category editing
- **Analytics** — monthly charts, balance history, top merchants, net savings
- **Budgets** — monthly budgets per category with progress bars and overspend alerts
- **Prévisions** — 3-month spending forecasts per category (exponential smoothing)

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + Recharts |
| Backend | FastAPI (Python 3.12) + SQLAlchemy 2 + SQLite |
| Forecasting | statsmodels (ExponentialSmoothing) + numpy fallback |
| Data format | ISO 20022 CAMT.053.001.08 (Swiss bank statement XML) |

## Setup

### Prerequisites

- Python 3.12+
- Node.js 18+

### Install dependencies

```bash
# Backend
pip install -r backend/requirements.txt

# Frontend
cd frontend && npm install
```

### Add your data

Place your CAMT.053 XML export files anywhere under the `data/` folder:

```
data/
└── your_export/
    ├── camt053_..._account1.xml
    ├── camt053_..._account2.xml
    └── camt053_..._account3.xml
```

The app auto-imports on first launch. To re-import after adding new files, click **Réimporter les données** in the sidebar or call `POST /import`.

### Run

```powershell
# Windows — starts both servers
.\start.ps1
```

Or manually:

```bash
# Backend (from project root)
py -3.12 -m uvicorn backend.main:app --reload --port 8000

# Frontend (from frontend/)
npm run dev
```

Open **http://localhost:5173** in your browser.

## Data & Privacy

- `data/` and `finance.db` are excluded from git (personal financial data)
- Everything runs locally — no data leaves your machine

## API

Interactive docs available at **http://localhost:8000/docs** when the backend is running.

Key endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/stats/overview` | Balance, income, expenses, savings rate |
| `GET` | `/stats/monthly` | Monthly income/expenses breakdown |
| `GET` | `/stats/categories` | Spending by category |
| `GET` | `/stats/balance-history` | Monthly balance over time |
| `GET` | `/transactions` | Paginated, filterable transaction list |
| `PUT` | `/transactions/{id}/category` | Re-categorize a transaction |
| `GET` | `/categories` | List / manage categories and rules |
| `GET` | `/budgets` | Budgets with spending progress |
| `GET` | `/predictions` | Forecast next N months of spending |
| `POST` | `/import` | Re-parse all XML files |

## Categorization

Transactions are auto-categorized on import using keyword rules per category (Swiss merchants: Migros, Coop, SBB, SALT, etc.). Rules are stored in the database and editable via the categories API.

Categories with default rules: Salaire, Alimentation, Transport, Restaurants, Bars & Sorties, Shopping, Santé, Télécom, Loisirs & Voyages, Investissements, Impôts, Assurances, Loyer & Logement, Virements internes.
