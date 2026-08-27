import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from './backend.js';
import { config } from './config.js';

export { createBackend } from './backend.js';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createBackend();
  server.listen(config.demoPort, '127.0.0.1', () => {
    console.log(`Harness console → http://127.0.0.1:${config.demoPort}`);
  });
}
