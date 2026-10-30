try {
  if (process.argv.length !== 3) throw new Error('An immutable image identity is required');
  const { createWelcomeRuntimeManifest } = await import('../../dist/catalog/welcome-runtime-manifest.js');
  process.stdout.write(`${JSON.stringify([createWelcomeRuntimeManifest(process.argv[2])], null, 2)}\n`);
} catch {
  process.stderr.write('Welcome runtime manifest requires a valid immutable image identity; build the backend first\n');
  process.exitCode = 1;
}
