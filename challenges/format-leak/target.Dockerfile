FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4 AS build
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY format-leak/vuln.c /src/vuln.c
# -no-pie keeps the layout simple for a first format-string leak; the format bug is the point.
RUN gcc -O0 -fno-stack-protector -no-pie -o /src/vuln /src/vuln.c

FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
RUN apt-get update && apt-get install -y --no-install-recommends socat && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/vuln /app/vuln
COPY _pwn/load-flag.sh _pwn/healthcheck.sh /app/
RUN chmod 0555 /app/vuln /app/load-flag.sh /app/healthcheck.sh
USER 65532:65532
EXPOSE 9002
CMD ["socat", "TCP-LISTEN:9002,reuseaddr,fork", "EXEC:/app/vuln"]
