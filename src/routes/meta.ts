import type { FastifyInstance } from 'fastify';

export async function registerMetaRoutes(app: FastifyInstance) {
  app.get('/meta', async () => ({ name: 'cyber-range-backend', version: 'v1' }));
}
