FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn websockets

# Копируем бэкенд
COPY main.py .

# Копируем фронтенд
COPY frontend /app/frontend

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8887"]