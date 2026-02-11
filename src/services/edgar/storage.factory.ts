import { FilingStorage } from './storage.interface.js';
import { LocalFilingStorage } from './local-storage.service.js';
import { S3FilingStorage } from './s3-storage.service.js';
import { getEnvironment } from '../../config/environment.js';

/**
 * Factory function to create appropriate storage implementation
 * based on environment configuration
 */
export function createFilingStorage(): FilingStorage {
  const env = getEnvironment();

  if (env.EDGAR_STORAGE_TYPE === 's3') {
    return new S3FilingStorage();
  }

  // Default to local filesystem storage for development
  return new LocalFilingStorage();
}
