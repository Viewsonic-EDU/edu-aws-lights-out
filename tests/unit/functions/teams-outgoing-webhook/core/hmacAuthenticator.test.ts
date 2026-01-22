import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateHmacSignature,
  getSecurityToken,
  clearCachedSecurityToken,
} from '@functions/teams-outgoing-webhook/core/hmacAuthenticator';
import crypto from 'crypto';
import { mockClient } from 'aws-sdk-client-mock';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmMock = mockClient(SSMClient);

describe('hmacAuthenticator', () => {
  const SECURITY_TOKEN = 'test-security-token-12345';
  let requestBody: string;
  let validSignature: string;

  beforeEach(() => {
    // Reset mocks and cache
    ssmMock.reset();
    clearCachedSecurityToken();

    requestBody = JSON.stringify({
      type: 'message',
      id: 'test-message-id',
      text: '@LightsOut start airsync-dev',
      from: { id: 'user-id', name: 'John Doe' },
    });

    // Generate valid HMAC signature
    const hmac = crypto.createHmac('sha256', SECURITY_TOKEN);
    hmac.update(requestBody, 'utf8');
    validSignature = hmac.digest('base64');
  });

  afterEach(() => {
    // Clean up environment variables and cache
    delete process.env.STAGE;
    clearCachedSecurityToken();
  });

  describe('Valid signature', () => {
    it('should validate correct HMAC signature', () => {
      const authHeader = `HMAC ${validSignature}`;
      const result = validateHmacSignature(authHeader, requestBody, SECURITY_TOKEN);

      expect(result).toBe(true);
    });

    it('should validate signature with different request body', () => {
      const differentBody = JSON.stringify({ text: 'different message' });
      const hmac = crypto.createHmac('sha256', SECURITY_TOKEN);
      hmac.update(differentBody, 'utf8');
      const signature = hmac.digest('base64');

      const authHeader = `HMAC ${signature}`;
      const result = validateHmacSignature(authHeader, differentBody, SECURITY_TOKEN);

      expect(result).toBe(true);
    });
  });

  describe('Invalid signature', () => {
    it('should reject missing Authorization header', () => {
      const result = validateHmacSignature(undefined, requestBody, SECURITY_TOKEN);

      expect(result).toBe(false);
    });

    it('should reject invalid signature format (missing HMAC prefix)', () => {
      const authHeader = validSignature; // Missing "HMAC " prefix
      const result = validateHmacSignature(authHeader, requestBody, SECURITY_TOKEN);

      expect(result).toBe(false);
    });

    it('should reject invalid signature format (wrong prefix)', () => {
      const authHeader = `Bearer ${validSignature}`;
      const result = validateHmacSignature(authHeader, requestBody, SECURITY_TOKEN);

      expect(result).toBe(false);
    });

    it('should reject incorrect signature', () => {
      const wrongSignature = Buffer.from('incorrect-signature').toString('base64');
      const authHeader = `HMAC ${wrongSignature}`;
      const result = validateHmacSignature(authHeader, requestBody, SECURITY_TOKEN);

      expect(result).toBe(false);
    });

    it('should reject signature computed with wrong security token', () => {
      const wrongToken = 'wrong-security-token';
      const hmac = crypto.createHmac('sha256', wrongToken);
      hmac.update(requestBody, 'utf8');
      const wrongSignature = hmac.digest('base64');

      const authHeader = `HMAC ${wrongSignature}`;
      const result = validateHmacSignature(authHeader, requestBody, SECURITY_TOKEN);

      expect(result).toBe(false);
    });

    it('should reject signature for modified request body', () => {
      const modifiedBody = requestBody + 'tampered';
      const authHeader = `HMAC ${validSignature}`;
      const result = validateHmacSignature(authHeader, modifiedBody, SECURITY_TOKEN);

      expect(result).toBe(false);
    });

    it('should reject malformed base64 signature', () => {
      const authHeader = 'HMAC not-valid-base64!@#$';
      const result = validateHmacSignature(authHeader, requestBody, SECURITY_TOKEN);

      expect(result).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty request body', () => {
      const emptyBody = '';
      const hmac = crypto.createHmac('sha256', SECURITY_TOKEN);
      hmac.update(emptyBody, 'utf8');
      const signature = hmac.digest('base64');

      const authHeader = `HMAC ${signature}`;
      const result = validateHmacSignature(authHeader, emptyBody, SECURITY_TOKEN);

      expect(result).toBe(true);
    });

    it('should handle Authorization header with extra spaces', () => {
      const authHeader = `HMAC  ${validSignature}`; // Extra space
      // This should fail because of incorrect format
      const result = validateHmacSignature(authHeader, requestBody, SECURITY_TOKEN);

      expect(result).toBe(false);
    });

    it('should reject Authorization header with multiple parts', () => {
      const authHeader = `HMAC ${validSignature} extra-part`;
      // split(' ') will create more than 2 parts, should be rejected
      const result = validateHmacSignature(authHeader, requestBody, SECURITY_TOKEN);

      expect(result).toBe(false);
    });
  });

  describe('Timing-safe comparison', () => {
    it('should use timing-safe comparison (prevents timing attacks)', () => {
      // This test verifies that the function doesn't immediately return false
      // when signatures don't match. While we can't directly test timing safety,
      // we can verify that both valid and invalid signatures are processed.

      const validAuthHeader = `HMAC ${validSignature}`;
      const validResult = validateHmacSignature(validAuthHeader, requestBody, SECURITY_TOKEN);

      const invalidSignature = validSignature.slice(0, -1) + 'X'; // Modify last char
      const invalidAuthHeader = `HMAC ${invalidSignature}`;
      const invalidResult = validateHmacSignature(invalidAuthHeader, requestBody, SECURITY_TOKEN);

      expect(validResult).toBe(true);
      expect(invalidResult).toBe(false);
    });
  });

  describe('getSecurityToken', () => {
    it('should load security token from SSM', async () => {
      process.env.STAGE = 'test';

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: SECURITY_TOKEN,
        },
      });

      const token = await getSecurityToken();

      expect(token).toBe(SECURITY_TOKEN);
      expect(ssmMock.calls()).toHaveLength(1);
      expect(ssmMock.call(0).args[0].input).toEqual({
        Name: '/lights-out/test/teams-webhook-token',
        WithDecryption: true,
      });
    });

    it('should cache security token after first load', async () => {
      process.env.STAGE = 'test';

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: SECURITY_TOKEN,
        },
      });

      // First call - should hit SSM
      const token1 = await getSecurityToken();
      expect(token1).toBe(SECURITY_TOKEN);
      expect(ssmMock.calls()).toHaveLength(1);

      // Second call - should use cache (no additional SSM call)
      const token2 = await getSecurityToken();
      expect(token2).toBe(SECURITY_TOKEN);
      expect(ssmMock.calls()).toHaveLength(1); // Still only 1 call
    });

    it('should throw error if STAGE environment variable not set', async () => {
      delete process.env.STAGE;

      await expect(getSecurityToken()).rejects.toThrow('STAGE environment variable not set');
    });

    it('should throw error if SSM parameter has no value', async () => {
      process.env.STAGE = 'test';

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          // No Value field
        },
      });

      await expect(getSecurityToken()).rejects.toThrow(
        'SSM parameter /lights-out/test/teams-webhook-token has no value'
      );
    });

    it('should throw error if SSM parameter not found', async () => {
      process.env.STAGE = 'test';

      ssmMock.on(GetParameterCommand).rejects({
        name: 'ParameterNotFound',
        message: 'Parameter not found',
      });

      await expect(getSecurityToken()).rejects.toThrow('Failed to load security token from SSM');
    });

    it('should throw error on SSM service error', async () => {
      process.env.STAGE = 'test';

      ssmMock.on(GetParameterCommand).rejects({
        name: 'ServiceUnavailable',
        message: 'Service temporarily unavailable',
      });

      await expect(getSecurityToken()).rejects.toThrow('Failed to load security token from SSM');
    });

    it('should handle different stage values', async () => {
      process.env.STAGE = 'production';

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: 'prod-token',
        },
      });

      const token = await getSecurityToken();

      expect(token).toBe('prod-token');
      expect(ssmMock.call(0).args[0].input).toEqual({
        Name: '/lights-out/production/teams-webhook-token',
        WithDecryption: true,
      });
    });
  });
});
