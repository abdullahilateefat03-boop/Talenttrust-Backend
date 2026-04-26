/**
 * @module routes/admin
 * @description Admin-only routes for operational visibility.
 *
 * @route GET /api/v1/admin/queue-health
 * @security Requires admin role via JWT authentication
 */

import { Router, Response } from 'express';
import { QueueManager } from '../queue';
import { requireAuth, requireRole } from '../middleware/authorization';

export const adminRouter = Router();

adminRouter.get(
  '/queue-health',
  requireAuth,
  requireRole('admin'),
  async (_req, res: Response) => {
    const queueManager = QueueManager.getInstance();
    const queues = await queueManager.getHealth();
    const failures = await queueManager.getRecentFailures(10);

    res.status(200).json({
      status: 'success',
      data: {
        queues,
        failures,
        timestamp: Date.now(),
      },
    });
  }
);