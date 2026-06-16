<div align="center">

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=28&pause=1000&color=58A6FF&center=true&vCenter=true&width=700&lines=Distributed+Task+Queue+Dashboard;Celery+%7C+Redis+%7C+FastAPI+%7C+WebSockets;Submit+Jobs+%7C+Watch+Workers+%7C+Live+Retries;Docker+Compose+%7C+React+Real-Time+Dashboard)](https://git.io/typing-svg)

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=14&pause=2000&color=8B949E&center=true&vCenter=true&width=600&lines=Real+task+queue+system+you+can+see+and+control" alt="subtitle"/>
</p>

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Celery](https://img.shields.io/badge/Celery-5.4-37814A?style=for-the-badge&logo=celery&logoColor=white)](https://docs.celeryq.dev)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

</div>

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / React UI                        │
│   ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐  │
│   │ Stat Cards│  │Queue Depth │  │Worker Grid│  │ Task Feed  │  │
│   └──────────┘  └────────────┘  └──────────┘  └────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket (ws://localhost:8000/ws)
                            │ REST API (http://localhost:8000)
┌───────────────────────────▼─────────────────────────────────────┐
│                        FastAPI Backend                           │
│  POST /tasks/submit   GET /tasks/{id}   GET /queues  GET /ws    │
│         │                                    │                   │
│         ▼                                    ▼                   │
│  celery.apply_async()            QueueInspector (inspect API)   │
└──────────────┬──────────────────────────┬───────────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                           Redis :6379                            │
│   Broker queues: [celery] [data] [email] [reports]              │
│   Result backend: celery-task-meta-{id}                         │
└───────────────────────────┬──────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Worker 1   │   │   Worker 2   │   │   Worker N   │
│  concurrency │   │  concurrency │   │  concurrency │
│      4       │   │      4       │   │      4       │
└──────────────┘   └──────────────┘   └──────────────┘
```

---

## Features

- **Live WebSocket feed** — dashboard updates every 2 seconds without page refresh
- **5 sample task types** — data processing, email, report generation, web scraping, ML training
- **Automatic retries** — configurable retry counts with countdown delays, visible in the scheduler
- **Queue routing** — tasks dispatched to dedicated queues (`data`, `email`, `reports`, `celery`)
- **Worker grid** — see every Celery worker, its status, active task count and total processed
- **Queue depth bars** — animated bar charts per queue, updating in real time
- **Task detail drawer** — click any task to inspect args, result JSON, and full traceback on failure
- **Session stats** — completed and failed counts tracked per browser session
- **Docker Compose** — one command to spin up Redis, API, and workers

---

## Quick Start (Docker)

```bash
git clone https://github.com/isamkhan1809/distributed-task-queue-dashboard.git
cd distributed-task-queue-dashboard

# Start Redis + API + Celery worker
docker compose up --build -d

# Start the frontend dev server
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

> The API is available at **http://localhost:8000** and API docs at **http://localhost:8000/docs**.

---

## Manual Setup

### Backend

```bash
# Requires Python 3.11+ and a running Redis instance on localhost:6379
cd backend
pip install -r requirements.txt

# Terminal 1 — start the FastAPI server
uvicorn main:app --reload --port 8000

# Terminal 2 — start the Celery worker
celery -A worker.celery_app worker --loglevel=info --concurrency=4 -Q celery,data,email,reports

# Optional — Flower monitoring UI
celery -A worker.celery_app flower --port=5555
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/tasks/submit` | Submit a task (`task_name`, `kwargs`) |
| `GET` | `/tasks/{task_id}` | Get task state + result |
| `GET` | `/tasks/active` | List active and reserved tasks |
| `GET` | `/tasks/history` | Recent completed/failed tasks |
| `GET` | `/queues` | Queue depths + worker stats |
| `WS` | `/ws` | WebSocket — broadcasts snapshot every 2s |

**Submit example:**

```bash
curl -X POST http://localhost:8000/tasks/submit \
  -H "Content-Type: application/json" \
  -d '{"task_name": "worker.tasks.process_data", "kwargs": {"data_size": 500, "fail_rate": 0.2}}'
```

---

## Project Structure

```
distributed-task-queue-dashboard/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket broadcaster, routes
│   ├── worker/
│   │   ├── celery_app.py    # Celery configuration + queue routing
│   │   └── tasks.py         # 5 sample tasks with retries and failures
│   ├── monitor/
│   │   └── inspector.py     # Queue/worker inspection via Celery inspect API
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx          # Full dashboard UI with WebSocket client
│       └── App.css          # Dark theme styling
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection URL (broker + backend) |

---

<div align="center">

[![wave](https://capsule-render.vercel.app/api?type=waving&color=58A6FF&height=100&section=footer)](https://github.com/isamkhan1809/distributed-task-queue-dashboard)

</div>
