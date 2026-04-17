import { Hono } from 'hono';
import { servePdf } from '../r2/storage.js';
import type { Env } from '../index.js';

export const pdfProxy = new Hono<Env>();

/**
 * GET /pdf/*
 * R2に保存されたPDFをプロキシする（authMiddleware で保護済み）
 *
 * 例: /pdf/injury/2026-04-13/abc123.pdf
 */
pdfProxy.get('/pdf/*', async (c) => {
  const pdfBucket = c.env.PDF_BUCKET;
  if (!pdfBucket) {
    return c.json({ error: 'PDF_BUCKET not configured' }, 500);
  }

  // /pdf/ 以降をキーとして使用
  const key = c.req.path.replace(/^\/pdf\//, '');
  if (!key) {
    return c.json({ error: 'Invalid PDF path' }, 400);
  }

  return servePdf(pdfBucket, `pdf/${key}`);
});
