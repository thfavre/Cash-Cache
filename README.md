# Cash-Cache

**Cash-Cache** is a local, privacy-first personal finance and wealth forecasting platform. Designed for data sovereignty, it parses standard bank export files directly on your machine without relying on cloud aggregators or third-party synchronization.

All data extraction, categorization, and financial modeling run entirely offline using Python, SQLite, and React. Your financial records never leave your device.

---

## Architecture & Core Philosophy

- **Offline Data Sovereignty:** Uses a local SQLite database (`finance.db`) to ensure zero external telemetry, zero credential sharing, and complete data ownership.
- **Multi-Bank Standardization:** Natively ingests **ISO 20022 CAMT.053 XML** bank exports (e.g., Swiss Raiffeisen) and **Revolut CSV** statements, automatically detecting and reconciling cross-bank internal transfers.
- **Institutional-Grade Analytics:** Combines real-time cashflow mapping (`Sankey` diagrams) with probabilistic long-term net-worth projections (`Monte Carlo` simulations).

---

## Key Features

### 1. Data Ingestion & Automated Categorization
- **Multi-Source Parser:** Supports simultaneous imports across traditional banks and fintech platforms with multi-currency tracking.
- **Rule-Based Categorization:** Interactive drag-and-drop categorization hub (`Catégoriser`) with dynamic keyword learning and automated merchant normalization (e.g., grouping raw POS transactions into clean merchant entities).
- **Automated Reconciliation:** Automatically identifies cross-bank transfers and currency conversions to prevent double-counting expenses.

### 2. Cashflow & Portfolio Analytics
- **Hierarchical Sankey Diagram:** Finary-inspired 3-tier flow visualization linking income sources directly to expense categories and specific merchants.
- **Interactive Metrics:** Multi-period average calculations, custom date filtering, top merchant breakdowns, and real-time net savings tracking (`Épargne Nette`).
- **High-Density UI:** Responsive, wide-screen optimized layout built with Recharts and Tailwind CSS.

### 3. Wealth Planning & Simulation
- **Monte Carlo Net-Worth Projections:** Simulates future wealth trajectories over decades using randomized market returns and inflation adjustments (`statsmodels` & `numpy`).
- **Scenario Analysis:** Test recurring "what-if" financial decisions (e.g., property purchases, salary adjustments, or aggressive savings plans) with real vs. nominal purchasing power views.
- **Dynamic Budgeting:** Set granular category budgets monitored by live progress indicators and overspend alerts.

### 4. Customization & Experience
- **Extensive Theme System:** Over 180 curated color themes adapted from Monkeytype, complete with optional visual accent effects (Aurora, Nebula, Vaporwave).

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Recharts | Interactive UI & financial visualizations |
| **Backend** | FastAPI, Python 3.12+, SQLAlchemy 2 | REST API & data parsing engine |
| **Database** | SQLite (`finance.db`) | Local offline personal storage |
| **Data & Simulation** | `statsmodels`, `numpy`, custom Monte Carlo engine | Exponential smoothing & wealth modeling |
| **Supported Formats** | ISO 20022 `CAMT.053.001.08` XML, Revolut CSV | Bank statement standardization |

---

## Getting Started

### Prerequisites
- Python 3.12+
- Node.js 18+

### Quick Start & Execution

To launch both the FastAPI backend (`port 8000`) and the React development server (`port 5173`) concurrently, simply execute:

```powershell
# Windows PowerShell
.\start.ps1
```
```bash
# macOS / Linux / Git Bash
./start.sh
```

*(Note: On a fresh machine, run `pip install -r backend/requirements.txt` and `cd frontend && npm install` once before launching).*

### Importing Bank Data

You **do not** need to manually copy files into folder directories. All data ingestion happens directly through the web interface:

1. Open **http://localhost:5173** in your browser.
2. Navigate to the **Import (`Réimporter les données`)** page.
3. Drag and drop your **CAMT.053 XML** bank exports or **Revolut / Bank CSV** files directly into the interactive upload modal.
4. The application will automatically parse transactions, match or create accounts, detect currencies, and let you configure column mappings on the fly.

Interactive API documentation is also available locally at **http://localhost:8000/docs**.

---

## Privacy & Security

- `data/` and `finance.db` are strictly ignored by Git (`.gitignore`) and remain isolated on your local disk.
- No network requests are made to third-party tracking or aggregation APIs.

---

## License

Distributed under the **MIT License**. See [LICENSE](file:///C:/Users/Thomas/Desktop/doc2/Personal/finances/program/LICENSE) for full legal terms.
