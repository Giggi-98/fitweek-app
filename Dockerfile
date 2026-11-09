FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py seed.py ./
COPY static ./static
COPY resources ./resources
RUN mkdir /data && useradd -u 10001 -m fitweek && chown -R fitweek:fitweek /data
USER fitweek
EXPOSE 8080
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8080","--proxy-headers","--forwarded-allow-ips","127.0.0.1"]
