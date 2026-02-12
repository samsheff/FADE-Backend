/**
 * Swappable storage interface for earnings call transcripts
 * Allows switching between local filesystem and cloud storage (S3, etc.)
 */
export interface TranscriptsStorage {
  /**
   * Initialize storage (create directories, test connectivity, etc.)
   */
  init(): Promise<void>;

  /**
   * Store transcript text
   * @param symbol Stock ticker (e.g., "AAPL", "TSLA")
   * @param transcriptId Transcript identifier (e.g., "fmp-transcript-AAPL-2024-Q2")
   * @param content Transcript text content
   * @returns Storage path (relative to base)
   */
  store(symbol: string, transcriptId: string, content: string): Promise<string>;

  /**
   * Retrieve transcript content
   * @param storagePath Relative storage path
   * @returns Transcript text content
   */
  retrieve(storagePath: string): Promise<string>;

  /**
   * Check if transcript exists
   * @param storagePath Relative storage path
   * @returns True if file exists
   */
  exists(storagePath: string): Promise<boolean>;

  /**
   * Delete transcript
   * @param storagePath Relative storage path
   */
  delete(storagePath: string): Promise<void>;
}
