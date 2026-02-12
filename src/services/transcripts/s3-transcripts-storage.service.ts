import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { TranscriptsStorage } from './storage.interface.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

/**
 * S3-compatible implementation of TranscriptsStorage
 * Compatible with DigitalOcean Spaces and AWS S3
 *
 * Path structure: {symbol}/{transcript_id}.txt
 * Example: AAPL/fmp-transcript-AAPL-2024-Q2.txt
 */
export class S3TranscriptsStorage implements TranscriptsStorage {
  private client: S3Client;
  private bucket: string;
  private logger;

  constructor() {
    const env = getEnvironment();

    if (!env.TRANSCRIPTS_S3_BUCKET) {
      throw new Error('TRANSCRIPTS_S3_BUCKET must be set when using S3 storage');
    }

    if (!env.TRANSCRIPTS_S3_ENDPOINT) {
      throw new Error('TRANSCRIPTS_S3_ENDPOINT must be set when using S3 storage');
    }

    if (!env.TRANSCRIPTS_S3_ACCESS_KEY || !env.TRANSCRIPTS_S3_SECRET_KEY) {
      throw new Error('TRANSCRIPTS_S3_ACCESS_KEY and TRANSCRIPTS_S3_SECRET_KEY must be set when using S3 storage');
    }

    this.bucket = env.TRANSCRIPTS_S3_BUCKET;
    this.logger = getLogger();

    // Initialize S3 client with DigitalOcean Spaces configuration
    this.client = new S3Client({
      endpoint: env.TRANSCRIPTS_S3_ENDPOINT,
      region: env.TRANSCRIPTS_S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: env.TRANSCRIPTS_S3_ACCESS_KEY,
        secretAccessKey: env.TRANSCRIPTS_S3_SECRET_KEY,
      },
      forcePathStyle: false,
    });
  }

  /**
   * Initialize storage - for S3 this is a no-op since buckets are created via Terraform
   */
  async init(): Promise<void> {
    this.logger.info({ bucket: this.bucket }, 'Transcripts S3 storage initialized');
  }

  async store(symbol: string, transcriptId: string, content: string): Promise<string> {
    const relativePath = `${symbol}/${transcriptId}.txt`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: relativePath,
        Body: Buffer.from(content, 'utf-8'),
        ContentType: 'text/plain',
      });

      await this.client.send(command);

      this.logger.debug({ path: relativePath, bucket: this.bucket }, 'Transcript stored in S3');

      return relativePath;
    } catch (error) {
      this.logger.error(
        { path: relativePath, error, bucket: this.bucket },
        'Failed to store transcript in S3',
      );
      throw new Error(`Failed to store transcript in S3: ${relativePath}`);
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

      this.logger.debug({ path: storagePath, bucket: this.bucket }, 'Transcript retrieved from S3');

      return content;
    } catch (error) {
      this.logger.error(
        { path: storagePath, error, bucket: this.bucket },
        'Failed to retrieve transcript from S3',
      );
      throw new Error(`Failed to retrieve transcript from S3: ${storagePath}`);
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
        'Error checking transcript existence in S3',
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

      this.logger.debug({ path: storagePath, bucket: this.bucket }, 'Transcript deleted from S3');
    } catch (error) {
      this.logger.warn(
        { path: storagePath, error, bucket: this.bucket },
        'Failed to delete transcript from S3',
      );
    }
  }
}
