import redis
import json
import time
from datetime import datetime
from typing import Any
from celery import Celery
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


class QueueInspector:
    def __init__(self, redis_url: str = REDIS_URL):
        self.redis_url = redis_url
        self.redis_client = redis.from_url(redis_url, decode_responses=True)
        self.celery_app = Celery("tasks", broker=redis_url, backend=redis_url)
        self.celery_app.conf.update(
            task_serializer="json",
            result_serializer="json",
            accept_content=["json"],
        )

    def _safe_inspect(self):
        try:
            return self.celery_app.control.inspect(timeout=1.0)
        except Exception:
            return None

    def get_active_tasks(self) -> list[dict]:
        """Get currently executing tasks across all workers."""
        tasks = []
        try:
            inspector = self._safe_inspect()
            if not inspector:
                return tasks
            active = inspector.active()
            if not active:
                return tasks
            for worker_name, task_list in active.items():
                for t in task_list:
                    tasks.append({
                        "id": t.get("id", ""),
                        "name": t.get("name", ""),
                        "args": t.get("args", []),
                        "kwargs": t.get("kwargs", {}),
                        "started": t.get("time_start"),
                        "worker": worker_name,
                        "queue": t.get("delivery_info", {}).get("routing_key", "celery"),
                    })
        except Exception as e:
            print(f"Error getting active tasks: {e}")
        return tasks

    def get_reserved_tasks(self) -> list[dict]:
        """Get tasks reserved by workers (waiting to be executed)."""
        tasks = []
        try:
            inspector = self._safe_inspect()
            if not inspector:
                return tasks
            reserved = inspector.reserved()
            if not reserved:
                return tasks
            for worker_name, task_list in reserved.items():
                for t in task_list:
                    tasks.append({
                        "id": t.get("id", ""),
                        "name": t.get("name", ""),
                        "args": t.get("args", []),
                        "kwargs": t.get("kwargs", {}),
                        "worker": worker_name,
                        "queue": t.get("delivery_info", {}).get("routing_key", "celery"),
                    })
        except Exception as e:
            print(f"Error getting reserved tasks: {e}")
        return tasks

    def get_scheduled_tasks(self) -> list[dict]:
        """Get tasks scheduled for retry."""
        tasks = []
        try:
            inspector = self._safe_inspect()
            if not inspector:
                return tasks
            scheduled = inspector.scheduled()
            if not scheduled:
                return tasks
            for worker_name, task_list in scheduled.items():
                for t in task_list:
                    req = t.get("request", {})
                    tasks.append({
                        "id": req.get("id", ""),
                        "name": req.get("name", ""),
                        "eta": t.get("eta"),
                        "worker": worker_name,
                        "priority": t.get("priority", 0),
                    })
        except Exception as e:
            print(f"Error getting scheduled tasks: {e}")
        return tasks

    def get_queue_lengths(self) -> dict[str, int]:
        """Get current length of each queue in Redis."""
        queues = ["celery", "data", "email", "reports"]
        lengths = {}
        try:
            for queue in queues:
                length = self.redis_client.llen(queue)
                lengths[queue] = length
        except Exception as e:
            print(f"Error getting queue lengths: {e}")
            for queue in queues:
                lengths[queue] = 0
        return lengths

    def get_worker_stats(self) -> list[dict]:
        """Get stats for all connected workers."""
        workers = []
        try:
            inspector = self._safe_inspect()
            if not inspector:
                return workers

            stats = inspector.stats() or {}
            active = inspector.active() or {}
            ping_result = inspector.ping() or {}

            for worker_name in set(list(stats.keys()) + list(ping_result.keys())):
                worker_stats = stats.get(worker_name, {})
                active_tasks = active.get(worker_name, [])
                pool_info = worker_stats.get("pool", {})
                total_info = worker_stats.get("total", {})
                processed = sum(total_info.values()) if total_info else 0

                workers.append({
                    "worker_name": worker_name,
                    "status": "online" if worker_name in ping_result else "offline",
                    "active_tasks": len(active_tasks),
                    "processed": processed,
                    "failed": 0,
                    "concurrency": pool_info.get("max-concurrency", 4),
                    "pid": worker_stats.get("pid", None),
                })
        except Exception as e:
            print(f"Error getting worker stats: {e}")
        return workers

    def get_task_result(self, task_id: str) -> dict[str, Any]:
        """Get result and state for a specific task."""
        try:
            result_key = f"celery-task-meta-{task_id}"
            data = self.redis_client.get(result_key)
            if data:
                parsed = json.loads(data)
                return {
                    "state": parsed.get("status", "UNKNOWN"),
                    "result": parsed.get("result"),
                    "traceback": parsed.get("traceback"),
                    "runtime": parsed.get("runtime"),
                    "task_id": task_id,
                    "date_done": parsed.get("date_done"),
                }
            # Task not found in backend, might still be pending
            return {"state": "PENDING", "result": None, "traceback": None, "runtime": None, "task_id": task_id}
        except Exception as e:
            print(f"Error getting task result for {task_id}: {e}")
            return {"state": "UNKNOWN", "result": None, "traceback": None, "runtime": None, "task_id": task_id}

    def get_recent_tasks(self, limit: int = 50) -> list[dict]:
        """Get recent tasks from the Redis result backend."""
        tasks = []
        try:
            # Scan for celery task metadata keys
            cursor = 0
            keys = []
            while True:
                cursor, batch = self.redis_client.scan(cursor, match="celery-task-meta-*", count=200)
                keys.extend(batch)
                if cursor == 0:
                    break
                if len(keys) >= limit * 2:
                    break

            for key in keys[:limit * 2]:
                try:
                    data = self.redis_client.get(key)
                    if data:
                        parsed = json.loads(data)
                        task_id = key.replace("celery-task-meta-", "")
                        tasks.append({
                            "id": task_id,
                            "name": parsed.get("task", parsed.get("name", "unknown")),
                            "state": parsed.get("status", "UNKNOWN"),
                            "result": parsed.get("result"),
                            "traceback": parsed.get("traceback"),
                            "date_done": parsed.get("date_done"),
                            "runtime": parsed.get("runtime"),
                        })
                except Exception:
                    continue

            # Sort by date_done descending (most recent first)
            tasks.sort(key=lambda x: x.get("date_done") or "", reverse=True)
            return tasks[:limit]
        except Exception as e:
            print(f"Error getting recent tasks: {e}")
            return []
