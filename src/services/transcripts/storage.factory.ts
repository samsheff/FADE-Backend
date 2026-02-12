import { TranscriptsStorage } from './storage.interface.js';
import { TranscriptsStorageService } from './transcripts-storage.service.js';
import { S3TranscriptsStorage } from './s3-transcripts-storage.service.js';
import { getEnvironment } from '../../config/environment.js';

/**
 * Factory function to create appropriate transcripts storage implementation
 * based on environment configuration
 */
export function createTranscriptsStorage(): TranscriptsStorage {
  const env = getEnvironment();

  if (env.TRANSCRIPTS_STORAGE_TYPE === 's3') {
    return new S3TranscriptsStorage();
  }

  // Default to local filesystem storage for development
  return new TranscriptsStorageService();
}
