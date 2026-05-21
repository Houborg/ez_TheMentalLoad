import { buildApp } from './app';
import './workers/sync-worker'; // starts background sync polling on import

async function start(): Promise<void> {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
