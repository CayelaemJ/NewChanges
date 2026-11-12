import { readFileSync } from 'node:fs';

const serverPath = new URL('../../src/server.ts', import.meta.url);

// Read static route declarations without importing the server or initializing services.
export function apiRouteInventory() {
  const source = readFileSync(serverPath, 'utf8');
  const routePattern = /app\.get(?:<[\s\S]*?>)?\s*\(\s*(['"])(\/api\/[^'"]+)\1/g;
  const paths = new Set();

  for (const match of source.matchAll(routePattern)) {
    paths.add(match[2]);
  }

  return { routes: [...paths].map(path => ({ method: 'GET', path })) };
}
