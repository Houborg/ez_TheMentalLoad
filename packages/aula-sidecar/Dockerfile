FROM python:3.14-slim

WORKDIR /app

COPY packages/aula-sidecar/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY packages/aula-sidecar/main.py .

EXPOSE 8765
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]
