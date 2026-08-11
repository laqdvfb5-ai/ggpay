import pg from 'pg';
import { loadConfig } from '../config.js';

pg.types.setTypeParser(20, (value: string) => BigInt(value));
export const pool = new pg.Pool({ connectionString: loadConfig().databaseUrl, max: 5 });
