try {
  const response = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(2000) });
  if (response.status !== 200 || await response.text() !== 'ok\n') process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
