/**
 * Queue Configuration
 * 
 * Centralized configuration for Redis connection and queue settings.
 * Supports environment-based configuration for different deployment environments.
 */

import { ConnectionOptions } from 'bullmq';
import { JobType } from './types';

export const DEFAULT_JOB_TIMEOUT_MS = 30000;

export interface QueueConfig {
  redis: ConnectionOptions;
  /**
   * Per-job execution timeout policy in milliseconds.
   *
   * @remarks The queue manager aborts the processor's AbortSignal and fails the
   * BullMQ attempt when the selected timeout elapses. Job-type overrides are
   * append-only operational configuration; keep values positive and large
   * enough for normal work to finish before retries can start.
   */
  jobTimeout: {
    defaultMs: number;
    perJobTypeMs: Partial<Record<JobType, number>>;
  };
  defaultJobOptions: {
    attempts: number;
    backoff: {
      type: 'exponential';
      delay: number;
    };
    removeOnComplete: number | boolean;
    removeOnFail: number | boolean;
  };
}

/**
 * Get Redis connection configuration from environment variables
 * Falls back to localhost defaults for development
 */
export function getRedisConfig(): ConnectionOptions {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

function parsePositiveTimeout(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envKeyForJobTimeout(jobType: JobType): string {
  return `QUEUE_JOB_TIMEOUT_${jobType.toUpperCase().replace(/-/g, '_')}_MS`;
}

function loadJobTimeoutOverrides(defaultMs: number): Partial<Record<JobType, number>> {
  const overrides: Partial<Record<JobType, number>> = {};

  Object.values(JobType).forEach((jobType) => {
    const value = process.env[envKeyForJobTimeout(jobType)];
    if (value !== undefined) {
      overrides[jobType] = parsePositiveTimeout(value, defaultMs);
    }
  });

  return overrides;
}

export function getJobTimeoutMs(jobType: JobType): number {
  return queueConfig.jobTimeout.perJobTypeMs[jobType] ?? queueConfig.jobTimeout.defaultMs;
}

/**
 * Default queue configuration
 * Provides sensible defaults for job retry logic and cleanup
 */
const defaultJobTimeoutMs = parsePositiveTimeout(
  process.env.QUEUE_JOB_TIMEOUT_MS,
  DEFAULT_JOB_TIMEOUT_MS,
);

export const queueConfig: QueueConfig = {
  redis: getRedisConfig(),
  jobTimeout: {
    defaultMs: defaultJobTimeoutMs,
    perJobTypeMs: loadJobTimeoutOverrides(defaultJobTimeoutMs),
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 1000,
  },
};
