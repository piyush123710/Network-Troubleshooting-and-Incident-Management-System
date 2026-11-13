# NetTrace Incident Desk — Network Troubleshooting & Incident Management System

A full-stack network diagnostic workbench and IT incident management system built to identify, analyze, prioritize, and document DNS, DHCP, routing, and connectivity issues.

## Key Features

- **Network Diagnostic Runner (`Ping`, `Tracert`, `IPConfig`, `NSLookup`, `Full Suite`)**
  - Executes live server-side network probes with automated fault classification and Windows CMD-formatted output transcripts.
  - Parses packet loss, RTT min/avg/max/jitter, DNS record types (`A`, `AAAA`, `MX`, `NS`, `TXT`, `SOA`), hop-by-hop latency spikes, and local adapter IP/subnet/gateway/DNS configurations.
  - One-click escalation converts any failed or degraded diagnostic run directly into a pre-populated incident ticket.
- **Incident Prioritization & Resolution Logs (`P1`–`P4`)**
  - Priority-based SLA tracking: **P1 Critical** (15m), **P2 High** (60m), **P3 Medium** (4h), and **P4 Low** (24h).
  - Status lifecycle (`Open` → `Investigating` → `Escalated` → `Resolved` → `Closed`) with category filtering (`DNS`, `DHCP`, `Routing`, `Switching`, `Latency`, `Connectivity`).
  - Timestamped resolution log timeline capturing the engineer, action type (`Diagnostic`, `Triage`, `Workaround`, `Escalation`, `Root Cause`, `Resolution`), CMD command used, and notes.
  - Structured **Escalation Details** tracking tier (`Tier 2 Infrastructure`, `Tier 2 Network Engineering`, `Tier 3 ISP / Carrier NOC`), target team, external ticket reference, and handoff notes.
- **Troubleshooting Runbooks & Technical Documentation**
  - Searchable SOP knowledge base for DNS resolution failures, DHCP/APIPA (`169.254.x.x`) lease exhaustion, routing hop bottlenecks, and P1/P2 escalation protocols.
  - Copyable Windows CMD diagnostic command sequences and ability to author custom SOP runbooks.
- **Relational SQL Inspector & Python/MySQL Companion Scripts**
  - Persistent relational SQLite database (`data/nettrace.db`) modeled after a MySQL 8.0 schema (`diagnostic_runs`, `incidents`, `resolution_logs`, `runbooks`).
  - Built-in read-only SQL `SELECT` query explorer, CSV export (`/api/export/incidents.csv`), and downloadable **MySQL 8.0 `schema_mysql.sql`** and **Python (`subprocess` + `mysql-connector-python`) CLI** scripts.

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **Backend:** Node.js, Express, TypeScript (`tsx`)
- **Database:** SQLite (`better-sqlite3`) with MySQL 8.0 compatible relational schema
- **Networking Diagnostics:** Node.js `dns.promises`, `net`, `os.networkInterfaces()`, and `child_process` (`ping`, `ip route`)
- **Companion Reference Artifacts:** Python `subprocess` CLI & MySQL 8.0 DDL (`server/companionFiles.ts`)

## Project Structure

```text
├── server.ts                  # Express + Vite server & REST API endpoints
├── server/
│   ├── db.ts                  # Relational SQL schema, WAL setup, & seed data
│   ├── diagnostics.ts         # Ping, Tracert, IPConfig, NSLookup & root-cause analyzer
│   └── companionFiles.ts      # Downloadable Python CLI & MySQL 8.0 schema scripts
├── src/
│   ├── App.tsx                # Main dashboard shell & navigation
│   ├── types.ts               # Shared TypeScript interfaces
│   └── components/
│       ├── OverviewView.tsx       # KPI strip, rapid triage launcher & priority queue
│       ├── DiagnosticsView.tsx    # Live diagnostic runner, telemetry tables & CMD output
│       ├── IncidentsView.tsx      # Incident filter grid, detail inspector & log timeline
│       ├── RunbooksView.tsx       # Searchable SOP runbooks & CMD sequence library
│       ├── SqlSchemaView.tsx      # Live SQL query explorer & Python/MySQL downloads
│       ├── CreateIncidentModal.tsx# New incident creation form
│       └── StatusText.tsx         # Accessible priority & status indicators
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js `v20+` (tested on `v22`)
- npm

### Installation & Development

```bash
npm install
npm run dev
```

The application runs on **`http://localhost:3000`**.

### Production Build & Start

```bash
npm run build
npm start
```

### Type Checking

```bash
npm run lint
```

## REST API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/summary` | Aggregate incident & diagnostic metrics |
| `POST` | `/api/diagnostics/run` | Run `ping`, `tracert`, `ipconfig`, `nslookup`, or `full_suite` |
| `GET` | `/api/diagnostics` | List recent persisted diagnostic runs |
| `GET` | `/api/incidents` | List incidents with priority, status, category, and search filters |
| `POST` | `/api/incidents` | Create a new incident and initial triage log |
| `GET` | `/api/incidents/:id` | Fetch incident details, resolution logs, and attached diagnostic run |
| `PATCH` | `/api/incidents/:id` | Update priority, status, root cause, and escalation fields |
| `DELETE` | `/api/incidents/:id` | Delete an incident |
| `POST` | `/api/incidents/:id/logs` | Append a resolution log entry |
| `GET` | `/api/runbooks` | List troubleshooting SOP runbooks |
| `POST` | `/api/runbooks` | Add a new SOP runbook |
| `POST` | `/api/sql/query` | Execute a read-only `SELECT` or `PRAGMA` SQL query |
| `GET` | `/api/companion` | Retrieve Python CLI script, MySQL schema, and SQLite DDL |
| `GET` | `/api/export/incidents.csv` | Download all incidents as CSV |
