# DealLens processing worker
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN useradd --create-home --uid 10001 worker
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY deallens_worker ./deallens_worker
COPY config ./config
USER worker
CMD ["python", "-m", "deallens_worker", "run"]
