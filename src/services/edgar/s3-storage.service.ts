import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { FilingStorage } from './storage.interface.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

/**
 * S3-compatible implementation of FilingStorage
 * Compatible with DigitalOcean Spaces and AWS S3
 */
export class S3FilingStorage implements FilingStorage {
  private client: S3Client;
  private bucket: string;
  private logger;

  constructor() {
    const env = getEnvironment();

    if (!env.EDGAR_S3_BUCKET) {
      throw new Error('EDGAR_S3_BUCKET must be set when using S3 storage');
    }

    if (!env.EDGAR_S3_ENDPOINT) {
      throw new Error('EDGAR_S3_ENDPOINT must be set when using S3 storage');
    }

    if (!env.EDGAR_S3_ACCESS_KEY || !env.EDGAR_S3_SECRET_KEY) {
      throw new Error('EDGAR_S3_ACCESS_KEY and EDGAR_S3_SECRET_KEY must be set when using S3 storage');
    }

    this.bucket = env.EDGAR_S3_BUCKET;
    this.logger = getLogger();

    // Initialize S3 client with DigitalOcean Spaces configuration
    this.client = new S3Client({
      endpoint: env.EDGAR_S3_ENDPOINT,
      region: env.EDGAR_S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: env.EDGAR_S3_ACCESS_KEY,
        secretAccessKey: env.EDGAR_S3_SECRET_KEY,
      },
      // Force path-style for DigitalOcean Spaces compatibility
      forcePathStyle: false,
    });
  }

  async save(relativePath: string, content: Buffer): Promise<void> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: relativePath,
        Body: content,
        ContentType: this.getContentType(relativePath),
      });

      await this.client.send(command);

      this.logger.debug(
        { path: relativePath, size: content.length, bucket: this.bucket },
        'Saved filing to S3 storage',
      );
    } catch (error) {
      this.logger.error({ path: relativePath, error, bucket: this.bucket }, 'Failed to save filing to S3');
      throw new Error(`Failed to save filing to S3: ${relativePath}`);
    }
  }

  async read(relativePath: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: relativePath,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        throw new Error('Empty response body from S3');
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks);

      this.logger.debug(
        { path: relativePath, size: content.length, bucket: this.bucket },
        'Read filing from S3 storage',
      );

      return content;
    } catch (error) {
      this.logger.error({ path: relativePath, error, bucket: this.bucket }, 'Failed to read filing from S3');
      throw new Error(`Failed to read filing from S3: ${relativePath}`);
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: relativePath,
      });

      await this.client.send(command);
      return true;
    } catch (error: any) {
      // HeadObject returns 404 error when object doesn't exist
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }

      this.logger.warn(
        { path: relativePath, error, bucket: this.bucket },
        'Error checking filing existence in S3',
      );
      return false;
    }
  }

  async delete(relativePath: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: relativePath,
      });

      await this.client.send(command);

      this.logger.debug({ path: relativePath, bucket: this.bucket }, 'Deleted filing from S3 storage');
    } catch (error) {
      this.logger.warn(
        { path: relativePath, error, bucket: this.bucket },
        'Failed to delete filing from S3 storage',
      );
    }
  }

  /**
   * Determine content type based on file extension
   */
  private getContentType(path: string): string {
    if (path.endsWith('.html') || path.endsWith('.htm')) {
      return 'text/html';
    }
    if (path.endsWith('.xml')) {
      return 'application/xml';
    }
    if (path.endsWith('.txt')) {
      return 'text/plain';
    }
    return 'application/octet-stream';
  }
}
