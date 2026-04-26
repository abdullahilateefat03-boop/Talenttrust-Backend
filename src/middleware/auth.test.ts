import { Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest } from './auth';

describe('authMiddleware', () => {
  let res: Partial<Response> & { status: jest.Mock; json: jest.Mock };
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    (next as jest.Mock).mockClear();
  });

  it('returns 401 when no Authorization header', async () => {
    const req = { headers: {} } as AuthenticatedRequest;
    await authMiddleware(req, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('calls next for demo admin token', async () => {
    const req = {
      headers: { authorization: 'Bearer demo-admin-token' },
    } as unknown as AuthenticatedRequest;
    await authMiddleware(req, res as Response, next);
    expect(req.user).toBeDefined();
    expect(next).toHaveBeenCalled();
  });
});
