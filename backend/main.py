import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from worker.celery_app import app as celery_app
from worker import tasks as task_module
from monitor.inspector import QueueInspector

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# ---- WebSocket connection manager ----

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        data = json.dumps(message, default=str)
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()
inspector = QueueInspector(REDIS_URL)

# ---- In-memory session task tracking ----
session_tasks: dict[str, dict] = {}


# ---- Background broadcaster ----

async def dashboard_broadcaster():
    """Push a full dashboard snapshot to all WebSocket clients every 2 seconds."""
    while True:
        try:
            snapshot = build_snapshot()
            await manager.broadcast({"type": "snapshot", "data": snapshot})
        except Exception as e:
            print(f"Broadcaster error: {e}")
        await asyncio.sleep(2)


def build_snapshot() -> dict:
    active = inspector.get_active_tasks()
    reserved = inspector.get_reserved_tasks()
    scheduled = inspector.get_scheduled_tasks()
    queue_lengths = inspector.get_queue_lengths()
    workers = inspector.get_worker_stats()
    recent = inspector.get_recent_tasks(50)

    # Update session task states from backend
    for task_id, task_info in session_tasks.items():
        if task_info.get("state") not in ("SUCCESS", "FAILURE"):
            result = inspector.get_task_result(task_id)
            task_info["state"] = result.get("state", task_info.get("state", "PENDING"))
            if result.get("result") is not None:
                task_info["result"] = result["result"]
            if result.get("traceback"):
                task_info["traceback"] = result["traceback"]
            if result.get("date_done"):
                task_info["date_done"] = result["date_done"]

    session_completed = sum(1 for t in session_tasks.values() if t.get("state") == "SUCCESS")
    session_failed = sum(1 for t in session_tasks.values() if t.get("state") == "FAILURE")

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "stats": {
            "active": len(active),
            "queued": sum(queue_lengths.values()),
            "completed": session_completed,
            "failed": session_failed,
            "workers_online": sum(1 for w in workers if w["status"] == "online"),
        },
        "workers": workers,
        "queue_lengths": queue_lengths,
        "active_tasks": active,
        "reserved_tasks": reserved,
        "scheduled_tasks": scheduled,
        "recent_tasks": recent,
        "session_tasks": list(session_tasks.values()),
    }


# ---- App lifespan ----

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(dashboard_broadcaster())
    yield
    task.cancel()


app = FastAPI(title="Distributed Task Queue Dashboard", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Request / Response models ----

TASK_MAP = {
    "worker.tasks.process_data": task_module.process_data,
    "worker.tasks.send_email": task_module.send_email,
    "worker.tasks.generate_report": task_module.generate_report,
    "worker.tasks.scrape_url": task_module.scrape_url,
    "worker.tasks.train_model": task_module.train_model,
}

TASK_QUEUES = {
    "worker.tasks.process_data": "data",
    "worker.tasks.send_email": "email",
    "worker.tasks.generate_report": "reports",
    "worker.tasks.scrape_url": "celery",
    "worker.tasks.train_model": "celery",
}


class SubmitTaskRequest(BaseModel):
    task_name: str
    kwargs: dict[str, Any] = {}


# ---- Routes ----

@app.post("/tasks/submit")
async def submit_task(req: SubmitTaskRequest):
    if req.task_name not in TASK_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown task: {req.task_name}. Valid tasks: {list(TASK_MAP.keys())}")

    task_fn = TASK_MAP[req.task_name]
    queue = TASK_QUEUES.get(req.task_name, "celery")

    result = task_fn.apply_async(kwargs=req.kwargs, queue=queue)

    task_record = {
        "id": result.id,
        "name": req.task_name,
        "kwargs": req.kwargs,
        "queue": queue,
        "state": "PENDING",
        "submitted_at": datetime.utcnow().isoformat(),
        "result": None,
        "traceback": None,
    }
    session_tasks[result.id] = task_record

    return {"task_id": result.id, "status": "submitted", "queue": queue}


@app.get("/tasks/history")
async def task_history():
    recent = inspector.get_recent_tasks(50)
    return {"tasks": recent}


@app.get("/tasks/active")
async def active_tasks():
    active = inspector.get_active_tasks()
    reserved = inspector.get_reserved_tasks()
    return {"active": active, "reserved": reserved}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    result = inspector.get_task_result(task_id)
    session_info = session_tasks.get(task_id, {})
    return {**session_info, **result}


@app.get("/queues")
async def queue_stats():
    queue_lengths = inspector.get_queue_lengths()
    workers = inspector.get_worker_stats()
    scheduled = inspector.get_scheduled_tasks()
    return {
        "queue_lengths": queue_lengths,
        "workers": workers,
        "scheduled_tasks": scheduled,
    }


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


# ---- WebSocket ----

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        # Send initial snapshot immediately
        snapshot = build_snapshot()
        await ws.send_text(json.dumps({"type": "snapshot", "data": snapshot}, default=str))
        # Keep alive — listen for any client messages
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                # Send a ping to keep connection alive
                await ws.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)
