export interface NonceData {
  nonce: string;
  timestamp: number;
  expiresAt: number;
}

export interface SignInMessage {
  wallet: `0x${string}`;
  nonce: string;
  timestamp: bigint;
}

export interface NonceResponse {
  nonce: string;
  timestamp: number;
  message: string;
}
