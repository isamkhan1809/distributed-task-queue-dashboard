import time
import random
import logging
from .celery_app import app

logger = logging.getLogger(__name__)


@app.task(bind=True, max_retries=3, name="worker.tasks.process_data")
def process_data(self, data_size: int = 100, fail_rate: float = 0.1):
    """Simulate data processing job"""
    try:
        if random.random() < fail_rate:
            raise Exception("Simulated processing failure")
        time.sleep(random.uniform(1, max(1.1, data_size / 50)))
        return {"processed_rows": data_size, "status": "success"}
    except Exception as exc:
        logger.error(f"process_data failed: {exc}")
        raise self.retry(exc=exc, countdown=5)


@app.task(bind=True, max_retries=2, name="worker.tasks.send_email")
def send_email(self, recipient: str = "user@example.com", subject: str = "Hello"):
    """Simulate email sending"""
    try:
        time.sleep(random.uniform(0.5, 2))
        if random.random() < 0.05:
            raise Exception("SMTP timeout")
        return {"sent_to": recipient, "subject": subject}
    except Exception as exc:
        logger.error(f"send_email failed: {exc}")
        raise self.retry(exc=exc, countdown=10)


@app.task(bind=True, max_retries=1, name="worker.tasks.generate_report")
def generate_report(self, report_type: str = "pdf", pages: int = 10):
    """Simulate report generation"""
    try:
        time.sleep(random.uniform(2, max(2.1, pages * 0.5)))
        return {
            "report_type": report_type,
            "pages": pages,
            "url": f"/reports/{report_type}_{random.randint(1000, 9999)}.{report_type}",
        }
    except Exception as exc:
        logger.error(f"generate_report failed: {exc}")
        raise self.retry(exc=exc, countdown=15)


@app.task(name="worker.tasks.scrape_url")
def scrape_url(url: str = "https://example.com"):
    """Simulate web scraping"""
    time.sleep(random.uniform(1, 5))
    return {"url": url, "items_found": random.randint(10, 500)}


@app.task(name="worker.tasks.train_model")
def train_model(epochs: int = 10, dataset_size: int = 1000):
    """Simulate ML training"""
    for epoch in range(epochs):
        time.sleep(random.uniform(0.3, 1))
    return {
        "epochs": epochs,
        "final_loss": round(random.uniform(0.01, 0.5), 4),
        "accuracy": round(random.uniform(0.8, 0.99), 4),
    }
