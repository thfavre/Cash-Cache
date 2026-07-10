# Cash-Cache

**Cash-Cache** is a local, privacy-first personal finance and wealth forecasting platform. Designed for data sovereignty, it parses standard bank export files directly on your machine without relying on cloud aggregators or third-party synchronization.

All data extraction, categorization, and financial modeling run entirely offline using Python, SQLite, and React. Your financial records never leave your device.

---

## Architecture & Core Philosophy

- **Offline Data Sovereignty:** Uses a local SQLite database (`finance.db`) to ensure zero external telemetry, zero credential sharing, and complete data ownership.
- **Multi-Bank Standardization:** Natively ingests **ISO 20022 CAMT.053 XML** bank exports, **Revolut CSV** statements, and **any general bank CSV export** (with interactive custom column mapping and delimiter detection), automatically reconciling cross-bank transfers.
- **Institutional-Grade Analytics:** Combines real-time cashflow mapping (`Sankey` diagrams) with probabilistic long-term net-worth projections (`Monte Carlo` simulations).

---

## Key Features

- **Universal Bank Imports:** Natively parses **CAMT.053 XML**, **Revolut CSV**, and **any general bank CSV** via interactive custom column mapping.
- **Automated Categorization & Reconciliation:** Drag-and-drop rule learning (`Catégoriser`), merchant normalization, and cross-bank internal transfer detection.
- **Hierarchical Sankey Cashflow:** 3-tier visual breakdown (`Income → Categories → Merchants`) with custom date filtering and net savings tracking.
- **Monte Carlo Wealth Simulation:** Decadal probabilistic net-worth projections (`statsmodels`/`numpy`), recurring what-if scenarios, and real vs. nominal views.
- **Dynamic Budgets:** Granular monthly category budgets monitored by live progress bars and overspend alerts.
- **180+ Color Themes:** Curated Monkeytype theme system (`ThemeModal`) with optional visual accent effects (Aurora, Nebula, Vaporwave).

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Recharts | Interactive UI & financial visualizations |
| **Backend** | FastAPI, Python 3.12+, SQLAlchemy 2 | REST API & data parsing engine |
| **Database** | SQLite (`finance.db`) | Local offline personal storage |
| **Data & Simulation** | `statsmodels`, `numpy`, custom Monte Carlo engine | Exponential smoothing & wealth modeling |
| **Supported Formats** | ISO 20022 `CAMT.053.001.08` XML, Revolut CSV, Universal Bank CSV (Dynamic Mapping) | Bank statement standardization & ingestion |

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
3. Drag and drop your **CAMT.053 XML** bank exports, **Revolut CSV**, or **any general bank CSV statement** directly into the interactive upload modal.
4. The application will automatically parse transactions, match or create accounts, detect currencies, and let you configure column mappings on the fly.

Interactive API documentation is also available locally at **http://localhost:8000/docs**.

---

## Privacy & Security

- `data/` and `finance.db` are strictly ignored by Git (`.gitignore`) and remain isolated on your local disk.
- No network requests are made to third-party tracking or aggregation APIs.

---

## License

Distributed under the **MIT License**. See [LICENSE](file:///C:/Users/Thomas/Desktop/doc2/Personal/finances/program/LICENSE) for full legal terms.
