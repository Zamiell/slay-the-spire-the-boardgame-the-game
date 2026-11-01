ARG BASE_IMAGE
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS node
RUN node -e "require('node:fs').writeFileSync('/tmp/root-cas.crt', require('node:tls').rootCertificates.join('\n'))"
FROM ${BASE_IMAGE}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /tmp/root-cas.crt /etc/ssl/certs/ca-certificates.crt
ARG APT_SNAPSHOT
RUN test -n "$APT_SNAPSHOT" \
    && printf 'Acquire::https::CaInfo "/etc/ssl/certs/ca-certificates.crt";\n' > /etc/apt/apt.conf.d/99-art-ca \
    && apt-get update --snapshot "$APT_SNAPSHOT" -o APT::Update::Error-Mode=any \
    && apt-get install -y --no-install-recommends --snapshot "$APT_SNAPSHOT" \
       ffmpeg python3-numpy python3-pil webp \
    && apt-get clean
RUN apt-get install -y --no-install-recommends --snapshot "$APT_SNAPSHOT" git \
    && git config --system --add safe.directory /workspace \
    && apt-get clean
COPY art-toolchain.json /opt/art-toolchain.json
ENV PYTHONDONTWRITEBYTECODE=1 TMPDIR=/tmp GIT_OPTIONAL_LOCKS=0
WORKDIR /workspace
