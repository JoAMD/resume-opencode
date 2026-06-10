import { config as dotenvConfig } from 'dotenv';
import { findProjectRoot } from './paths';
import path from 'path';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const envPath = path.join(findProjectRoot(__dirname), '.env');
  dotenvConfig({ path: envPath });
}
