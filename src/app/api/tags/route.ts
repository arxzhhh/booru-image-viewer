import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for booru tag autocomplete APIs.
 *
 * Browsers cannot directly fetch these endpoints due to CORS, so we proxy.
 *
 * Query params:
 *   - api_url:  The base booru API URL the user pasted (used to detect the host)
 *   - term:     The partial tag string to search for
 *   - api_key:  Optional API key (for Gelbooru which requires auth for tag dapi)
 *   - user_id:  Optional user ID
 *
 * Returns a normalized array of tag suggestions:
 *   [{ name, count }]
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TagSuggestion {
  name: string;
  count: number;
}

function detectHost(apiUrl: string): string {
  try {
    return new URL(apiUrl).host;
  } catch {
    return '';
  }
}

async function fetchGelbooruTags(
  host: string,
  term: string,
  apiKey?: string,
  userId?: string
): Promise<TagSuggestion[]> {
  // Gelbooru tag dapi requires auth. Build the URL.
  const base = host.includes('safebooru')
    ? 'https://safebooru.org'
    : host.includes('rule34')
      ? 'https://api.rule34.xxx'
      : 'https://gelbooru.com';

  // Rule34 has a dedicated autocomplete endpoint that returns post counts in the label
  if (host.includes('rule34')) {
    const url = `${base}/autocomplete.php?q=${encodeURIComponent(term)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BooruImageViewer/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      label: string;
      value: string;
    }>;
    return data.map((t) => {
      // Label is like "cat_ears (189153)" — extract the count
      const m = t.label.match(/\((\d+)\)/);
      return { name: t.value, count: m ? parseInt(m[1], 10) : 0 };
    });
  }

  // Gelbooru / Safebooru: use the tag dapi with name_pattern + orderby=count
  const u = new URL(`${base}/index.php`);
  u.searchParams.set('page', 'dapi');
  u.searchParams.set('s', 'tag');
  u.searchParams.set('q', 'index');
  u.searchParams.set('json', '1');
  // % wildcards on both sides for substring match
  u.searchParams.set('name_pattern', `%${term}%`);
  u.searchParams.set('limit', '10');
  u.searchParams.set('orderby', 'count');
  if (apiKey && userId) {
    u.searchParams.set('api_key', apiKey);
    u.searchParams.set('user_id', userId);
  }

  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': 'BooruImageViewer/1.0' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const tags = (data as { tag?: Array<{ name: string; count: number }> }).tag ?? [];
  return tags.map((t) => ({ name: t.name, count: t.count }));
}

async function fetchDanbooruTags(
  host: string,
  term: string
): Promise<TagSuggestion[]> {
  // Danbooru / yande.re / Konachan — Danbooru autocomplete endpoint
  let base = 'https://danbooru.donmai.us';
  if (host.includes('yande')) base = 'https://yande.re';
  if (host.includes('konachan')) base = 'https://konachan.com';

  if (host.includes('yande') || host.includes('konachan')) {
    // Use the tag.json endpoint with name pattern
    const u = new URL(`${base}/tag.json`);
    u.searchParams.set('name', `${term}*`);
    u.searchParams.set('limit', '10');
    u.searchParams.set('order', 'count');
    const res = await fetch(u.toString(), {
      headers: { 'User-Agent': 'BooruImageViewer/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      name: string;
      count: number;
    }>;
    return data.map((t) => ({ name: t.name, count: t.count }));
  }

  // Danbooru autocomplete endpoint
  const u = new URL(`${base}/autocomplete.json`);
  u.searchParams.set('search[query]', term);
  u.searchParams.set('search[type]', 'tag_query');
  u.searchParams.set('limit', '10');
  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': 'BooruImageViewer/1.0' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{
    value: string;
    post_count?: number;
  }>;
  return data.map((t) => ({
    name: t.value,
    count: t.post_count ?? 0,
  }));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const apiUrl = searchParams.get('api_url') ?? '';
  const term = searchParams.get('term') ?? '';
  const apiKey = searchParams.get('api_key') ?? '';
  const userId = searchParams.get('user_id') ?? '';

  if (!term || term.length < 1) {
    return NextResponse.json({ suggestions: [] });
  }
  if (!apiUrl) {
    return NextResponse.json({ suggestions: [] });
  }

  const host = detectHost(apiUrl);

  try {
    let suggestions: TagSuggestion[] = [];

    if (
      host.includes('gelbooru') ||
      host.includes('safebooru') ||
      host.includes('rule34')
    ) {
      suggestions = await fetchGelbooruTags(host, term, apiKey, userId);
    } else if (
      host.includes('danbooru') ||
      host.includes('yande') ||
      host.includes('konachan')
    ) {
      suggestions = await fetchDanbooruTags(host, term);
    }

    // Sort by count descending, take top 10
    suggestions.sort((a, b) => b.count - a.count);
    suggestions = suggestions.slice(0, 10);

    return NextResponse.json(
      { suggestions },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Tag autocomplete failed', detail: message, suggestions: [] },
      { status: 502 }
    );
  }
}
