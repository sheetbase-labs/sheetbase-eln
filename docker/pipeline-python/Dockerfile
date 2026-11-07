# Supply an immutable python:3.12-slim-bookworm@sha256:... build argument.
ARG PYTHON_IMAGE
FROM ${PYTHON_IMAGE}
COPY docker/pipeline-python/requirements.txt /opt/sheetbase/requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: -r /opt/sheetbase/requirements.txt
COPY docker/pipeline-python/worker.py /opt/sheetbase/worker.py
ENV PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
USER 65532:65532
WORKDIR /tmp
ENTRYPOINT ["python", "-I", "-u", "/opt/sheetbase/worker.py"]
