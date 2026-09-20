/**
 * Placeholder catalog so the frontend can render real-shaped data before the
 * database (Phase 1) and the Docker lifecycle (Phase 3) exist.
 *
 * This is scaffolding, not content: the titles and summaries are deliberately
 * generic, and no real challenge is designed here. Everything in this module is
 * replaced by `challenges` rows in Phase 2.
 *
 * No flag — plaintext or hashed — is stored on a challenge. `mockFlag()`
 * derives one from the slug at verification time, which keeps the mock phase on
 * the same "never store a plaintext flag" rule as production (AGENTS.md).
 */

import { hashFlag } from '../lib/flags.js';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** How a player reaches the target once Phase 3 can actually spawn one. */
export type ChallengeKind = 'web' | 'shell';

export type MockChallenge = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  difficulty: Difficulty;
  points: number;
  kind: ChallengeKind;
  tags: readonly string[];
};

export const MOCK_CHALLENGES: readonly MockChallenge[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'sample-web-a',
    title: 'Sample Web Target A',
    summary: 'Placeholder entry for an HTTP target. Real content lands later.',
    category: 'web',
    difficulty: 'easy',
    points: 10,
    kind: 'web',
    tags: ['http', 'beginner'],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'sample-web-b',
    title: 'Sample Web Target B',
    summary: 'Placeholder entry for an HTTP target with a longer solve path.',
    category: 'web',
    difficulty: 'medium',
    points: 25,
    kind: 'web',
    tags: ['http', 'auth'],
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'sample-shell-a',
    title: 'Sample Shell Target A',
    summary: 'Placeholder entry reached through the in-browser terminal.',
    category: 'linux',
    difficulty: 'easy',
    points: 10,
    kind: 'shell',
    tags: ['linux', 'beginner'],
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    slug: 'sample-shell-b',
    title: 'Sample Shell Target B',
    summary: 'Placeholder entry for a multi-step terminal exercise.',
    category: 'linux',
    difficulty: 'hard',
    points: 50,
    kind: 'shell',
    tags: ['linux', 'privilege-escalation'],
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    slug: 'sample-network-a',
    title: 'Sample Network Target A',
    summary: 'Placeholder entry for a service-enumeration exercise.',
    category: 'network',
    difficulty: 'medium',
    points: 25,
    kind: 'shell',
    tags: ['enumeration'],
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    slug: 'sample-forensics-a',
    title: 'Sample Forensics Target A',
    summary: 'Placeholder entry for an artefact-analysis exercise.',
    category: 'forensics',
    difficulty: 'easy',
    points: 10,
    kind: 'web',
    tags: ['analysis', 'beginner'],
  },
];

export const MOCK_CATEGORIES: readonly string[] = [
  ...new Set(MOCK_CHALLENGES.map((challenge) => challenge.category)),
];

/**
 * The mock flag for a challenge, derived rather than stored.
 *
 * These are development fixtures with no security value — they exist so the
 * submission endpoint can be exercised end to end before real labs exist.
 */
export function mockFlag(slug: string): string {
  return `CTF{mock_${slug.replaceAll('-', '_')}}`;
}

export function mockFlagHash(slug: string): string {
  return hashFlag(mockFlag(slug));
}

export function findMockChallengeById(id: string): MockChallenge | undefined {
  return MOCK_CHALLENGES.find((challenge) => challenge.id === id);
}

export function findMockChallengeBySlug(slug: string): MockChallenge | undefined {
  return MOCK_CHALLENGES.find((challenge) => challenge.slug === slug);
}
