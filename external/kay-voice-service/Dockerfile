FROM python:3.11.9-slim-bookworm
WORKDIR /service
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000 KAY_WEBSOCKET_MAX_FRAME_BYTES=1048576
COPY requirements.txt .
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin kayvoice
COPY app ./app
RUN chown -R kayvoice:kayvoice /service
USER kayvoice
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8000')+'/health', timeout=2)"
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\" --ws-max-size \"${KAY_WEBSOCKET_MAX_FRAME_BYTES:-1048576}\" --no-access-log"]