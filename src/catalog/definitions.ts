import { z } from 'zod';

export const challengeDefinitionSchema = z
  .object({
    id: z.uuid(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64),
    title: z.string().trim().min(1).max(128),
    summary: z.string().trim().min(1).max(500),
    category: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    points: z.number().int().positive().max(10_000),
    kind: z.enum(['web', 'shell']),
    tags: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64)).max(20),
    definitionVersion: z.number().int().positive(),
    published: z.boolean(),
  })
  .strict();

export type ChallengeDefinition = z.infer<typeof challengeDefinitionSchema>;

const rawDefinitions = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'sample-web-a',
    title: 'Sample Web Target A',
    summary: 'Catalog fixture for an introductory HTTP target.',
    category: 'web',
    difficulty: 'easy',
    points: 10,
    kind: 'web',
    tags: ['http', 'beginner'],
    definitionVersion: 1,
    published: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'sample-web-b',
    title: 'Sample Web Target B',
    summary: 'Catalog fixture for an HTTP target with a longer solve path.',
    category: 'web',
    difficulty: 'medium',
    points: 25,
    kind: 'web',
    tags: ['http', 'auth'],
    definitionVersion: 1,
    published: true,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'sample-shell-a',
    title: 'Sample Shell Target A',
    summary: 'Catalog fixture for an introductory Linux target.',
    category: 'linux',
    difficulty: 'easy',
    points: 10,
    kind: 'shell',
    tags: ['linux', 'beginner'],
    definitionVersion: 1,
    published: true,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    slug: 'sample-shell-b',
    title: 'Sample Shell Target B',
    summary: 'Catalog fixture for a multi-step Linux target.',
    category: 'linux',
    difficulty: 'hard',
    points: 50,
    kind: 'shell',
    tags: ['linux', 'privilege-escalation'],
    definitionVersion: 1,
    published: true,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    slug: 'sample-network-a',
    title: 'Sample Network Target A',
    summary: 'Catalog fixture for a service-enumeration target.',
    category: 'network',
    difficulty: 'medium',
    points: 25,
    kind: 'shell',
    tags: ['enumeration'],
    definitionVersion: 1,
    published: true,
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    slug: 'sample-forensics-a',
    title: 'Sample Forensics Target A',
    summary: 'Catalog fixture for an artefact-analysis target.',
    category: 'forensics',
    difficulty: 'easy',
    points: 10,
    kind: 'web',
    tags: ['analysis', 'beginner'],
    definitionVersion: 1,
    published: true,
  },
] satisfies ChallengeDefinition[];

export const CHALLENGE_DEFINITIONS: readonly ChallengeDefinition[] = z
  .array(challengeDefinitionSchema)
  .min(1)
  .superRefine((definitions, context) => {
    for (const field of ['id', 'slug'] as const) {
      const seen = new Set<string>();
      for (const [index, definition] of definitions.entries()) {
        if (seen.has(definition[field])) {
          context.addIssue({
            code: 'custom',
            message: `Duplicate challenge ${field}`,
            path: [index, field],
          });
        }
        seen.add(definition[field]);
      }
    }
  })
  .parse(rawDefinitions);
