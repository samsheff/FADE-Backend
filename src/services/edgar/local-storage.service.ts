import * as fs from 'fs/promises';
import * as path from 'path';
import { FilingStorage } from './storage.interface.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Local filesystem implementation of FilingStorage
 * Stores filings in configured directory structure
 */
export class LocalFilingStorage implements FilingStorage {
  private basePath: string;
  private logger;

  constructor() {
    this.basePath = getEnvironment().EDGAR_STORAGE_PATH;
    this.logger = getLogger();
  }

  async save(relativePath: string, content: Buffer): Promise<void> {
    const fullPath = path.join(this.basePath, relativePath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file
    await fs.writeFile(fullPath, content);

    this.logger.debug({ path: relativePath, size: content.length }, 'Saved filing to local storage');
  }

  async read(relativePath: string): Promise<Buffer> {
    const fullPath = path.join(this.basePath, relativePath);

    try {
      const content = await fs.readFile(fullPath);
      this.logger.debug({ path: relativePath, size: content.length }, 'Read filing from local storage');
      return content;
    } catch (error) {
      this.logger.error({ path: relativePath, error }, 'Failed to read filing from local storage');
      throw new Error(`Failed to read filing: ${relativePath}`);
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.basePath, relativePath);

    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(relativePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, relativePath);

    try {
      await fs.unlink(fullPath);
      this.logger.debug({ path: relativePath }, 'Deleted filing from local storage');
    } catch (error) {
      this.logger.warn({ path: relativePath, error }, 'Failed to delete filing from local storage');
    }
  }
}
