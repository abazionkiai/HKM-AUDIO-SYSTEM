import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { audioDb } from './server/db.ts';
import { setupWebSocket } from './server/ws.ts';
import { aiRouter } from './server/routes/ai.ts';
import { hardwareRouter } from './server/routes/hardware.ts';
import { remoteRouter } from './server/routes/remote.ts';
import { stateRouter } from './server/routes/state.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const port = Number(process.env.PORT ?? 3030);
  const host = process.env.HOST ?? '0.0.0.0';
  app.set('port', port);

  // Initialize SQLite / JSON state storage
  audioDb.ensureStore();

  // Attach HTTP Server & WebSocket subsystem
  const httpServer = http.createServer(app);
  setupWebSocket(httpServer);

  // API Domain Routers
  app.use('/api/ai', aiRouter);
  app.use('/api/hardware', hardwareRouter);
  app.use('/api/remote', remoteRouter);
  app.use('/api', stateRouter);

  // Client frontend serving: Vite middleware in dev, static dist in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(port, host, () => {
    console.log(`Church Audio Intelligence running on http://${host}:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
