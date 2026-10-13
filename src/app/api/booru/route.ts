import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for booru-style image APIs.
 *
 * Browsers cannot directly fetch from gelbooru.com / danbooru.donmai.us / etc.
 * due to CORS, so we proxy the request through this server route.
 *
 * Query params:
 *   - url: The full booru API URL the user pasted (already includes tags, pid, limit, etc.)
 *
 * Returns a normalized JSON array of posts:
 *   { count, source, posts: [{ id, file_url, preview_url, sample_url, tags, score, rating, width, height, source }] }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface NormalizedPost {
  id: number | string;
  file_url: string | null;
  preview_url: string | null;
  sample_url: string | null;
  file_ext: string | null;
  tags: string[];
  score: number;
  rating: string;
  width: number | null;
  height: number | null;
  source: string | null;
}

interface RawPost {
  id?: number | string;
  file_url?: string;
  preview_url?: string;
  sample_url?: string;
  preview_file_url?: string;
  large_file_url?: string;
  file_preview_url?: string;
  file_ext?: string;
  tags?: string | string[] | Record<string, string[]>;
  tag_string?: string;
  tag_string_general?: string;
  score?: number | string | { total?: number; up?: number; down?: number };
  rating?: string;
  width?: number | string;
  height?: number | string;
  source?: string;
  sources?: string[];
  // e621 nested structure
  file?: { url?: string; ext?: string; width?: number; height?: number };
  preview?: { url?: string };
  sample?: { url?: string | null };
}

function parseTags(tags: string | string[] | Record<string, string[]> | undefined): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(' ').filter(Boolean);
  // e621: tags is an object with category arrays like { general: [...], character: [...] }
  if (typeof tags === 'object') {
    return Object.values(tags).flat();
  }
  return [];
}

function toNumber(v: unknown): number {
  if (typeof v === 'object' && v !== null && 'total' in v) {
    // e621 score object: { total, up, down }
    return toNumber((v as { total?: number }).total);
  }
  const n = typeof v === 'string' ? parseInt(v, 10) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
}

function normalizePost(p: RawPost): NormalizedPost {
  // Handle e621's nested structure
  const file_url = p.file_url ?? p.file?.url ?? null;
  const preview_url =
    p.preview_url ?? p.preview_file_url ?? p.file_preview_url ?? p.preview?.url ?? null;
  const sample_url = p.sample_url ?? p.large_file_url ?? p.sample?.url ?? null;
  const file_ext = p.file_ext ?? p.file?.ext ?? null;
  const width = p.width ?? p.file?.width ?? null;
  const height = p.height ?? p.file?.height ?? null;
  const source = p.source ?? (p.sources && p.sources.length > 0 ? p.sources[0] : null);

  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    file_url,
    preview_url,
    sample_url,
    file_ext,
    tags: parseTags(p.tags ?? p.tag_string ?? p.tag_string_general),
    score: toNumber(p.score),
    rating: p.rating ?? 'unknown',
    width: width != null ? toNumber(width) : null,
    height: height != null ? toNumber(height) : null,
    source,
  };
}

function extractPosts(json: unknown): RawPost[] {
  // Array directly — Danbooru, Gelbooru v1 dapi
  if (Array.isArray(json)) return json as RawPost[];

  // Object with posts array — e621 ({ posts: [...] }), Gelbooru ({ post: [...] })
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.posts)) return obj.posts as RawPost[];
    if (Array.isArray(obj.post)) return obj.post as RawPost[];
    if (obj.id || obj.file_url) return [obj as unknown as RawPost];
  }

  return [];
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

  try {
    // Use browser-like headers for sites behind Cloudflare (e621, etc.)
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    // e621 requires a Referer matching its origin + special headers
    if (parsed.host.includes('e621')) {
      headers['Referer'] = 'https://e621.net/';
      headers['Origin'] = 'https://e621.net';
    }

    const upstream = await fetch(parsed.toString(), {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return NextResponse.json(
        {
          error: `Upstream returned HTTP ${upstream.status} ${upstream.statusText}`,
          detail: text.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    if (!contentType.includes('json') && !contentType.includes('text')) {
      return NextResponse.json(
        {
          error: `Upstream did not return JSON (content-type: ${contentType}). Make sure the URL points to a JSON API endpoint.`,
        },
        { status: 502 }
      );
    }

    const rawText = await upstream.text();
    let json: unknown;
    try {
      json = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        {
          error: 'Upstream response was not valid JSON.',
          detail: rawText.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const posts = extractPosts(json).map(normalizePost);

    return NextResponse.json(
      {
        count: posts.length,
        posts,
        source: parsed.toString(),
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Failed to fetch from upstream.', detail: message },
      { status: 502 }
    );
  }
}
