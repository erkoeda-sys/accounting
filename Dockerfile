FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and PDFs
COPY . .

ENV PORT=8080
EXPOSE 8080

# gunicorn: 1 worker + 8 threads, 5 min timeout for streaming responses
CMD exec gunicorn \
    --bind :$PORT \
    --workers 1 \
    --threads 8 \
    --timeout 300 \
    app:app
