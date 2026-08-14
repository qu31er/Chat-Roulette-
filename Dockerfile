FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn websockets

COPY main.py .

# Добавляем таймауты для uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8887", "--timeout-keep-alive", "65", "--limit-concurrency", "100"]