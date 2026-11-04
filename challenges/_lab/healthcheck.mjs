const response = await fetch('http://127.0.0.1:8080/healthz', { signal: AbortSignal.timeout(2_000) }).catch(() => null);
process.exit(response?.ok ? 0 : 1);
