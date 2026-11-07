# Supply an immutable python:3.12-slim-bookworm@sha256:... build argument.
ARG PYTHON_IMAGE
FROM ${PYTHON_IMAGE}
COPY docker/pipeline-python/requirements.txt /opt/sheetbase/requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: -r /opt/sheetbase/requirements.txt
# Optional: the optimiser behind campaigns' "BayBE" engine. It brings PyTorch, which makes
# the image large and needs about 1 GiB at run time (see PIPELINE_PYTHON_MEMORY).
# Build with --build-arg WITH_BAYBE=true; the pinned packages above stay as they are.
ARG WITH_BAYBE=false
COPY docker/pipeline-python/requirements-baybe.txt /opt/sheetbase/requirements-baybe.txt
RUN if [ "$WITH_BAYBE" = "true" ]; then pip install --no-cache-dir --only-binary=:all: -c /opt/sheetbase/requirements.txt -r /opt/sheetbase/requirements-baybe.txt; fi
COPY docker/pipeline-python/worker.py /opt/sheetbase/worker.py
ENV PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
USER 65532:65532
WORKDIR /tmp
ENTRYPOINT ["python", "-I", "-u", "/opt/sheetbase/worker.py"]
