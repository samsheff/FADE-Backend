import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { NewsStorage } from './storage.interface.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

/**
 * S3-compatible implementation of NewsStorage
 * Compatible with DigitalOcean Spaces and AWS S3
 *
 * Path structure: {publisher_slug}/{article_id}.txt
 * Example: reuters/finnhub-12345.txt
 */
export class S3NewsStorage implements NewsStorage {
  private client: S3Client;
  private bucket: string;
  private logger;

  constructor() {
    const env = getEnvironment();

    if (!env.NEWS_S3_BUCKET) {
      throw new Error('NEWS_S3_BUCKET must be set when using S3 storage');
    }

    if (!env.NEWS_S3_ENDPOINT) {
      throw new Error('NEWS_S3_ENDPOINT must be set when using S3 storage');
    }

    if (!env.NEWS_S3_ACCESS_KEY || !env.NEWS_S3_SECRET_KEY) {
      throw new Error('NEWS_S3_ACCESS_KEY and NEWS_S3_SECRET_KEY must be set when using S3 storage');
    }

    this.bucket = env.NEWS_S3_BUCKET;
    this.logger = getLogger();

    // Initialize S3 client with DigitalOcean Spaces configuration
    this.client = new S3Client({
      endpoint: env.NEWS_S3_ENDPOINT,
      region: env.NEWS_S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: env.NEWS_S3_ACCESS_KEY,
        secretAccessKey: env.NEWS_S3_SECRET_KEY,
      },
      forcePathStyle: false,
    });
  }

  /**
   * Initialize storage - for S3 this is a no-op since buckets are created via Terraform
   */
  async init(): Promise<void> {
    this.logger.info({ bucket: this.bucket }, 'News S3 storage initialized');
  }

  async store(publisherSlug: string, articleId: string, content: string): Promise<string> {
    const relativePath = `${publisherSlug}/${articleId}.txt`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: relativePath,
        Body: Buffer.from(content, 'utf-8'),
        ContentType: 'text/plain',
      });

      await this.client.send(command);

      this.logger.debug({ path: relativePath, bucket: this.bucket }, 'Article stored in S3');

      return relativePath;
    } catch (error) {
      this.logger.error(
        { path: relativePath, error, bucket: this.bucket },
        'Failed to store article in S3',
      );
      throw new Error(`Failed to store article in S3: ${relativePath}`);
    }
  }

  async retrieve(storagePath: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        throw new Error('Empty response body from S3');
      }

      // Convert stream to string
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks).toString('utf-8');

      this.logger.debug({ path: storagePath, bucket: this.bucket }, 'Article retrieved from S3');

      return content;
    } catch (error) {
      this.logger.error(
        { path: storagePath, error, bucket: this.bucket },
        'Failed to retrieve article from S3',
      );
      throw new Error(`Failed to retrieve article from S3: ${storagePath}`);
    }
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
      });

      await this.client.send(command);
      return true;
    } catch (error: any) {
      // HeadObject returns 404 error when object doesn't exist
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }

      this.logger.warn(
        { path: storagePath, error, bucket: this.bucket },
        'Error checking article existence in S3',
      );
      return false;
    }
  }

  async delete(storagePath: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
      });

      await this.client.send(command);

      this.logger.debug({ path: storagePath, bucket: this.bucket }, 'Article deleted from S3');
    } catch (error) {
      this.logger.warn(
        { path: storagePath, error, bucket: this.bucket },
        'Failed to delete article from S3',
      );
    }
  }
}
