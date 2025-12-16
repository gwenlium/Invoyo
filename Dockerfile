# 1. Base Image: Use slim for smaller footprint
FROM python:3.11-slim

# 2. Set Env Vars: Prevents python buffering and .pyc files
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 3. Set Work Directory
WORKDIR /code

# 4. Install Dependencies
# Copy requirements FIRST. Docker caches this layer.
# If you change code but not requirements, the build is instant.
COPY requirements.txt /code/
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# 5. Copy Application Code
COPY ./app /code/app
COPY ./tests /code/tests

# 6. Create directories with proper permissions
RUN mkdir -p /code/app/data/storage && \
    chmod 755 /code/app/data && \
    chmod 755 /code/app/data/storage

# 7. Security: Run as non-root user (Best Practice)
RUN adduser --disabled-password --gecos "" appuser

# 8. Fix directory ownership
RUN chown -R appuser:appuser /code/app/data
USER appuser

# 9. Start the App
# We use host 0.0.0.0 to make it accessible outside the container
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]