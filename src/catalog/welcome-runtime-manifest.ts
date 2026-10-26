import { WELCOME_CHALLENGE_ID } from './definitions.js';
import { runtimeManifestSchema, type RuntimeManifest } from '../orchestrator/runtime-manifests.js';

/** The built image identity is supplied by the operator, never by a player. */
export function createWelcomeRuntimeManifest(image: string): RuntimeManifest {
  return runtimeManifestSchema.parse({
    challengeId: WELCOME_CHALLENGE_ID,
    image,
    containerPort: 8080,
    user: '65532:65532',
    healthcheck: {
      test: ['CMD', 'node', '/app/healthcheck.mjs'],
      intervalSeconds: 5,
      timeoutSeconds: 3,
      retries: 5,
      startupSeconds: 60,
    },
    resources: { memoryMb: 128, cpuCores: 0.5, pids: 64, tmpfsMb: 16 },
  });
}
