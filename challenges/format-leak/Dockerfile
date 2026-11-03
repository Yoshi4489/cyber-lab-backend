FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4 AS build
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY format-leak/vuln.c /src/vuln.c
RUN gcc -O0 -fno-stack-protector -no-pie -o /src/vuln /src/vuln.c

# Shared learner workstation. Keep this stage identical across shell labs so the layer is reused.
FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
# shortcut: Debian packages track the archive at build time, not exact versions; pin via snapshot.debian.org when builds must be reproducible.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash binutils ca-certificates file gcc gdb less libc6-dev make nano \
      netcat-openbsd procps python3 python3-pip vim-tiny \
  && pip install --no-cache-dir --break-system-packages pwntools==4.14.1 \
  && rm -rf /var/lib/apt/lists/* /root/.cache \
  && useradd --create-home --uid 1000 --shell /bin/bash learner
# ttyd is not packaged in Debian; use the project's verified static release binary.
COPY _pwn/ttyd.x86_64 /usr/local/bin/ttyd
RUN chmod 0555 /usr/local/bin/ttyd
COPY _pwn/motd /etc/motd
COPY _pwn/ttyd-health.sh /usr/local/bin/lab-healthcheck
RUN chmod 0555 /usr/local/bin/lab-healthcheck
ENV HOME=/home/learner
COPY format-leak/vuln.c /opt/format-leak/vuln.c
COPY format-leak/README.txt /opt/format-leak/README.txt
COPY --from=build /src/vuln /opt/format-leak/vuln
USER 1000:1000
WORKDIR /home/learner
EXPOSE 7681
CMD ["ttyd", "--writable", "--port", "7681", "--interface", "0.0.0.0", "bash", "--login"]
