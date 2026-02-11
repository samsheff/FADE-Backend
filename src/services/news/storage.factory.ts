import { NewsStorage } from './storage.interface.js';
import { NewsStorageService } from './news-storage.service.js';
import { S3NewsStorage } from './s3-news-storage.service.js';
import { getEnvironment } from '../../config/environment.js';

/**
 * Factory function to create appropriate news storage implementation
 * based on environment configuration
 */
export function createNewsStorage(): NewsStorage {
  const env = getEnvironment();

  if (env.NEWS_STORAGE_TYPE === 's3') {
    return new S3NewsStorage();
  }

  // Default to local filesystem storage for development
  return new NewsStorageService();
}
