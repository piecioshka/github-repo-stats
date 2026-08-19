import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Loads variables from a dotenv file (default: `.env` in the current working
 * directory) into `process.env`. Variables already present in the environment
 * take precedence, and a missing file is not an error - the file is just an
 * optional convenience for storing GITHUB_TOKEN.
 */
export function loadDotEnv(filePath = '.env'): void {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  for (const [key, value] of Object.entries(parseEnv(content))) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
