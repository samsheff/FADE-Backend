import { verifyTypedData } from 'viem';
import { EIP712_DOMAIN, EIP712_TYPES } from '../config/constants.js';
import { SignInMessage } from '../types/auth.types.js';
import { UnauthorizedError } from './errors.js';

export async function verifySignInSignature(
  message: SignInMessage,
  signature: `0x${string}`,
  expectedAddress: `0x${string}`,
): Promise<boolean> {
  try {
    const valid = await verifyTypedData({
      address: expectedAddress,
      domain: EIP712_DOMAIN,
      types: EIP712_TYPES,
      primaryType: 'SignIn',
      message,
      signature,
    });

    if (!valid) {
      throw new UnauthorizedError('Invalid signature');
    }

    return true;
  } catch (error) {
    throw new UnauthorizedError('Signature verification failed');
  }
}

export function generateNonce(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function formatSignInMessage(wallet: string, nonce: string, timestamp: number): string {
  return `Sign in to Polymarket Terminal\n\nWallet: ${wallet}\nNonce: ${nonce}\nTimestamp: ${timestamp}`;
}
