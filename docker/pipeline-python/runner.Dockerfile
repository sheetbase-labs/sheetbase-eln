# Both build arguments must be immutable image references.
ARG DOCKER_CLI_IMAGE
ARG NODE_IMAGE
FROM ${DOCKER_CLI_IMAGE} AS docker-cli
FROM ${NODE_IMAGE}
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY scripts/pipeline-python-runner.mjs /opt/sheetbase/pipeline-python-runner.mjs
ENV NODE_ENV=production PIPELINE_PYTHON_RUNNER_PORT=8080
USER 65532:65532
EXPOSE 8080
CMD ["node", "/opt/sheetbase/pipeline-python-runner.mjs"]
