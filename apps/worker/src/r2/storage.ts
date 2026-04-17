/**
 * PDFをR2に保存し、Workerプロキシ経由のURLを返す
 *
 * 注意: R2の署名付きURLはWorkersから直接生成できないため、
 * Workers経由のプロキシエンドポイント(/pdf/*)でアクセスする。
 * このエンドポイントは authMiddleware で保護されている。
 */
export async function savePdf(
  pdfBucket: R2Bucket,
  sessionId: string,
  sessionType: string,
  pdfBytes: Uint8Array,
): Promise<string> {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const key = `pdf/${sessionType}/${date}/${sessionId}.pdf`;

  await pdfBucket.put(key, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { sessionId, sessionType, generatedAt: new Date().toISOString() },
  });

  return key;
}

/**
 * R2からPDFを読み込んでResponseとして返す（プロキシ用）
 */
export async function servePdf(
  pdfBucket: R2Bucket,
  key: string,
): Promise<Response> {
  const obj = await pdfBucket.get(key);
  if (!obj) {
    return new Response('PDF not found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/pdf');
  headers.set('Content-Disposition', `inline; filename="${key.split('/').pop()}"`);
  // 24時間キャッシュ
  headers.set('Cache-Control', 'private, max-age=86400');

  return new Response(obj.body, { headers });
}
