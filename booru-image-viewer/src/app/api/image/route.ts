import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side image/video proxy.
 *
 * Some booru CDNs (notably gelbooru's img*.gelbooru.com) enforce hotlink
 * protection: they 302-redirect any request whose Referer is not the booru's
 * own origin. Browsers cannot spoof the Referer header, so we proxy the
 * request through the server and inject the correct Referer.
 *
 * Query params:
 *   - url: The full image/video URL to fetch.
 *
 * The response is streamed back with the upstream's content-type preserved.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Map of CDN host patterns -> origin to use as Referer.
const HOTLINK_HOSTS: { pattern: RegExp; referer: string }[] = [
  { pattern: /gelbooru\.com$/i, referer: 'https://gelbooru.com/' },
  { pattern: /safebooru\.org$/i, referer: 'https://safebooru.org/' },
  { pattern: /rule34\.xxx$/i, referer: 'https://rule34.xxx/' },
  { pattern: /danbooru\.donmai\.us$/i, referer: 'https://danbooru.donmai.us/' },
  { pattern: /yande\.re$/i, referer: 'https://yande.re/' },
  { pattern: /konachan\.com$/i, referer: 'https://konachan.com/' },
  { pattern: /konachan\.net$/i, referer: 'https://konachan.net/' },
];

function refererFor(host: string): string | null {
  for (const h of HOTLINK_HOSTS) {
    if (h.pattern.test(host)) return h.referer;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json(
      { error: 'Missing "url" query parameter.' },
      { status: 400 }
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json(
      { error: 'The provided URL is not valid.' },
      { status: 400 }
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json(
      { error: `Unsupported protocol: ${parsed.protocol}` },
      { status: 400 }
    );
  }

  const referer = refererFor(parsed.host);

  try {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (BooruImageViewer/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'image/*,video/*,*/*;q=0.8',
    };
    if (referer) {
      headers['Referer'] = referer;
    }

    const upstream = await fetch(parsed.toString(), {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: `Upstream returned HTTP ${upstream.status} ${upstream.statusText}`,
        },
        { status: 502 }
      );
    }

    const contentType =
      upstream.headers.get('content-type') ?? 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');

    // Stream the body through
    const body = upstream.body;
    if (!body) {
      return NextResponse.json(
        { error: 'Upstream returned empty body.' },
        { status: 502 }
      );
    }

    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    };
    if (contentLength) {
      responseHeaders['Content-Length'] = contentLength;
    }

    return new NextResponse(body, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Failed to fetch from upstream.', detail: message },
      { status: 502 }
    );
  }
}
