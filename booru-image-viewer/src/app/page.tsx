'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  Search,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Play,
  Maximize,
  Bookmark,
  BookmarkCheck,
  Key,
  Trash2,
  X,
  ClipboardPaste,
  Star,
  Heart,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useMounted } from '@/hooks/use-mounted';

/* ----------------------------- types ----------------------------- */

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

interface ApiResponse {
  count: number;
  source: string;
  posts: NormalizedPost[];
}

interface ApiError {
  error: string;
  detail?: string;
}

type ViewMode = 'pagination' | 'infinite';
type SortMode = 'default' | 'score_desc' | 'score_asc';
type TabView = 'search' | 'favorites';

interface BookmarkEntry {
  name: string;
  apiUrl: string;
  tags: string;
  scoreFloor: number;
  limit: number;
  apiKey: string;
  userId: string;
  createdAt: number;
}

/* ----------------------- preset host buttons ---------------------- */

const PRESET_HOSTS: { label: string; url: string; note: string }[] = [
  {
    label: 'Gelbooru',
    url: 'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1',
    note: 'requires API key for most queries',
  },
  {
    label: 'Danbooru',
    url: 'https://danbooru.donmai.us/posts.json?tags=',
    note: 'login + api_key for auth',
  },
  {
    label: 'Safebooru',
    url: 'https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1',
    note: 'safe-only, no key needed',
  },
  {
    label: 'Rule34',
    url: 'https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1',
    note: 'supports api_key + user_id',
  },
  {
    label: 'yande.re',
    url: 'https://yande.re/post.json?limit=100',
    note: 'login + api_key for auth',
  },
  {
    label: 'Konachan',
    url: 'https://konachan.com/post.json?limit=100',
    note: 'login + api_key for auth',
  },
];

const VIDEO_EXTS = ['webm', 'mp4', 'm4v', 'mov', 'mkv', 'ogv'];
const SESSION_KEY = 'booru-viewer-session';
const BOOKMARKS_KEY = 'booru-viewer-bookmarks';
const FAVORITES_KEY = 'booru-viewer-favorites';

/* ------------------------- helper funcs --------------------------- */

function extractExt(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('.');
    if (parts.length < 2) return null;
    return parts[parts.length - 1].toLowerCase();
  } catch {
    const parts = url.split('.');
    if (parts.length < 2) return null;
    return parts[parts.length - 1].toLowerCase().split('?')[0];
  }
}

function isVideoPost(post: NormalizedPost): boolean {
  const ext = (post.file_ext ?? extractExt(post.file_url) ?? '').toLowerCase();
  return VIDEO_EXTS.includes(ext);
}

/**
 * Parse a raw credentials string and extract api_key + user_id (or login).
 *
 * Accepts any of these formats:
 *   - "&api_key=abc123&user_id=2002159"
 *   - "api_key=abc123&user_id=2002159"
 *   - "https://gelbooru.com/...?...&api_key=abc123&user_id=2002159"
 *   - "api_key: abc123, user_id: 2002159"
 *   - "abc123 2002159" (api_key first, user_id second, separated by whitespace)
 *   - "abc123:2002159"
 */
function parseCredentials(raw: string): { apiKey: string; userId: string } {
  const text = raw.trim();
  if (!text) return { apiKey: '', userId: '' };

  // Try to extract api_key=... and user_id=... (or login=...) via regex
  const apiKeyMatch = text.match(/api_key[=:]\s*([a-f0-9]{32,}|[A-Za-z0-9_-]{10,})/i);
  const userIdMatch = text.match(/(?:user_id|login)[=:]\s*(\w+)/i);

  if (apiKeyMatch && userIdMatch) {
    return { apiKey: apiKeyMatch[1], userId: userIdMatch[1] };
  }

  // If only api_key=... found, try to find a standalone number for user_id
  if (apiKeyMatch) {
    const uidMatch = text.match(/\b(\d{3,})\b/);
    return { apiKey: apiKeyMatch[1], userId: uidMatch ? uidMatch[1] : '' };
  }

  // Try "key:value" or "key value" format (2 tokens)
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  if (tokens.length >= 2 && !text.includes('=') && !text.includes(':')) {
    return { apiKey: tokens[0], userId: tokens[1] };
  }

  // Try "key:value" format
  const colonMatch = text.match(/^([a-f0-9]{32,}|[A-Za-z0-9_-]{10,})[:\s]+(\w+)$/i);
  if (colonMatch) {
    return { apiKey: colonMatch[1], userId: colonMatch[2] };
  }

  return { apiKey: '', userId: '' };
}

/**
 * Domains known to enforce hotlink protection. Image/video URLs from these
 * hosts must be routed through /api/image so the server can inject the
 * correct Referer header.
 */
const HOTLINK_DOMAINS = [
  'gelbooru.com',
  'safebooru.org',
  'rule34.xxx',
  'danbooru.donmai.us',
  'yande.re',
  'konachan.com',
  'konachan.net',
];

function isHotlinkProtected(url: string): boolean {
  try {
    const host = new URL(url).host;
    return HOTLINK_DOMAINS.some((d) => host.includes(d));
  } catch {
    return false;
  }
}

/** Route a media URL through the server-side image proxy if needed. */
function proxyMediaUrl(url: string | null): string | null {
  if (!url) return null;
  if (isHotlinkProtected(url)) {
    return `/api/image?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function dedupePosts(posts: NormalizedPost[]): NormalizedPost[] {
  const seen = new Set<string>();
  return posts.filter((p) => {
    const key = `${p.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requestVideoFullscreen(video: HTMLVideoElement | null) {
  if (!video) return;
  const v = video as HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
    webkitRequestFullscreen?: () => void;
    msRequestFullscreen?: () => void;
  };
  if (typeof v.requestFullscreen === 'function') {
    v.requestFullscreen();
  } else if (typeof v.webkitEnterFullscreen === 'function') {
    v.webkitEnterFullscreen();
  } else if (typeof v.webkitRequestFullscreen === 'function') {
    v.webkitRequestFullscreen();
  } else if (typeof v.msRequestFullscreen === 'function') {
    v.msRequestFullscreen();
  }
}

function detectAuthScheme(apiUrl: string): 'gelbooru' | 'danbooru' | 'none' {
  try {
    const host = new URL(apiUrl).host;
    if (host.includes('danbooru') || host.includes('yande') || host.includes('konachan')) {
      return 'danbooru';
    }
    if (host.includes('gelbooru') || host.includes('safebooru') || host.includes('rule34')) {
      return 'gelbooru';
    }
  } catch {
    // ignore
  }
  return 'none';
}

function buildUrl(
  apiUrl: string,
  tags: string,
  scoreFloor: number,
  limit: number,
  page: number,
  apiKey: string,
  userId: string,
  sortMode: SortMode
): string {
  const u = new URL(apiUrl);

  // Combine tags (existing + user + score filter + sort)
  const userTags = tags.trim();
  const scoreTag = `score:>${scoreFloor}`;

  // Sort tag — different syntax per host
  const host = u.host;
  let sortTag = '';
  if (sortMode === 'score_desc') {
    if (host.includes('danbooru') || host.includes('yande') || host.includes('konachan')) {
      sortTag = 'order:score';
    } else {
      // Gelbooru / Safebooru / Rule34
      sortTag = 'sort:score:desc';
    }
  } else if (sortMode === 'score_asc') {
    if (host.includes('danbooru') || host.includes('yande') || host.includes('konachan')) {
      sortTag = 'order:score_asc';
    } else {
      sortTag = 'sort:score:asc';
    }
  }

  const existingTags = (u.searchParams.get('tags') ?? '').trim();
  const combined = [existingTags, userTags, scoreTag, sortTag]
    .filter(Boolean)
    .join(' ');
  if (combined) u.searchParams.set('tags', combined);

  // Limit
  u.searchParams.set('limit', String(limit));

  // Auth — append based on host scheme
  const scheme = detectAuthScheme(apiUrl);
  if (apiKey && userId) {
    if (scheme === 'danbooru') {
      u.searchParams.set('login', userId);
      u.searchParams.set('api_key', apiKey);
    } else if (scheme === 'gelbooru') {
      u.searchParams.set('api_key', apiKey);
      u.searchParams.set('user_id', userId);
    }
  }

  // Pagination — different APIs use different params
  if (host.includes('danbooru') || host.includes('yande') || host.includes('konachan')) {
    u.searchParams.set('page', String(page + 1));
  } else {
    u.searchParams.set('pid', String(page));
  }
  return u.toString();
}

/* ----------------------- localStorage helpers --------------------- */

interface SessionState {
  apiUrl: string;
  tags: string;
  scoreFloor: number;
  limit: number;
  apiKey: string;
  userId: string;
  viewMode: ViewMode;
  sortMode: SortMode;
}

function loadSession(): Partial<SessionState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<SessionState>;
  } catch {
    return null;
  }
}

function saveSession(s: SessionState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // ignore quota errors
  }
}

function loadBookmarks(): BookmarkEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BookmarkEntry[];
  } catch {
    return [];
  }
}

function saveBookmarks(bm: BookmarkEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bm));
  } catch {
    // ignore
  }
}

function loadFavorites(): NormalizedPost[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as NormalizedPost[];
  } catch {
    return [];
  }
}

function saveFavorites(favs: NormalizedPost[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  } catch {
    // ignore quota errors
  }
}

/* ----------------------- module-level store ----------------------- */

interface StoreState {
  apiUrl: string;
  tags: string;
  scoreFloor: number;
  limit: number;
  apiKey: string;
  userId: string;
  viewMode: ViewMode;
  sortMode: SortMode;
  tabView: TabView;
  page: number;
  loading: boolean;
  error: ApiError | null;
  rawResults: ApiResponse | null;
  accumulatedPosts: NormalizedPost[];
  hasMore: boolean;
  bookmarks: BookmarkEntry[];
  favorites: NormalizedPost[];
  sessionLoaded: boolean;
}

const storeState: StoreState = {
  apiUrl: '',
  tags: '',
  scoreFloor: 0,
  limit: 100,
  apiKey: '',
  userId: '',
  viewMode: 'pagination',
  sortMode: 'default',
  tabView: 'search',
  page: 0,
  loading: false,
  error: null,
  rawResults: null,
  accumulatedPosts: [],
  hasMore: true,
  bookmarks: [],
  favorites: [],
  sessionLoaded: false,
};

let listeners: (() => void)[] = [];

function updateState(patch: Partial<StoreState>) {
  Object.assign(storeState, patch);
  listeners.forEach((l) => l());
}

function useSyncStore<T>(selector: () => T): T {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  return selector();
}

function useBooruStore() {
  const apiUrl = useSyncStore(() => storeState.apiUrl);
  const tags = useSyncStore(() => storeState.tags);
  const scoreFloor = useSyncStore(() => storeState.scoreFloor);
  const limit = useSyncStore(() => storeState.limit);
  const apiKey = useSyncStore(() => storeState.apiKey);
  const userId = useSyncStore(() => storeState.userId);
  const viewMode = useSyncStore(() => storeState.viewMode);
  const sortMode = useSyncStore(() => storeState.sortMode);
  const page = useSyncStore(() => storeState.page);
  const loading = useSyncStore(() => storeState.loading);
  const error = useSyncStore(() => storeState.error);
  const rawResults = useSyncStore(() => storeState.rawResults);
  const accumulatedPosts = useSyncStore(() => storeState.accumulatedPosts);
  const hasMore = useSyncStore(() => storeState.hasMore);
  const bookmarks = useSyncStore(() => storeState.bookmarks);
  const favorites = useSyncStore(() => storeState.favorites);
  const tabView = useSyncStore(() => storeState.tabView);
  const sessionLoaded = useSyncStore(() => storeState.sessionLoaded);

  const fetchImages = useCallback(async (pageOverride?: number) => {
    const effectivePage = pageOverride ?? storeState.page;
    const url = buildUrl(
      storeState.apiUrl,
      storeState.tags,
      storeState.scoreFloor,
      storeState.limit,
      effectivePage,
      storeState.apiKey,
      storeState.userId,
      storeState.sortMode
    );
    updateState({ loading: true, error: null });
    try {
      const res = await fetch(`/api/booru?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) {
        updateState({
          loading: false,
          error: data as ApiError,
          rawResults: null,
          hasMore: false,
        });
        return;
      }
      const apiResp = data as ApiResponse;
      const gotPosts = apiResp.posts.length > 0;

      if (storeState.viewMode === 'infinite') {
        const base =
          effectivePage === 0 ? [] : storeState.accumulatedPosts;
        updateState({
          loading: false,
          rawResults: apiResp,
          accumulatedPosts: dedupePosts([...base, ...apiResp.posts]),
          page: effectivePage,
          hasMore: gotPosts && apiResp.posts.length >= storeState.limit,
        });
      } else {
        updateState({
          loading: false,
          rawResults: apiResp,
          page: effectivePage,
          hasMore: gotPosts,
        });
      }
    } catch (err) {
      updateState({
        loading: false,
        error: {
          error: 'Network error',
          detail: err instanceof Error ? err.message : String(err),
        },
        rawResults: null,
        hasMore: false,
      });
    }
  }, []);

  const setApiUrl = useCallback((v: string) => updateState({ apiUrl: v }), []);
  const setTags = useCallback((v: string) => updateState({ tags: v }), []);
  const setScoreFloor = useCallback(
    (v: number) => updateState({ scoreFloor: v }),
    []
  );
  const setLimit = useCallback((v: number) => updateState({ limit: v }), []);
  const setApiKey = useCallback((v: string) => updateState({ apiKey: v }), []);
  const setUserId = useCallback((v: string) => updateState({ userId: v }), []);
  const setViewMode = useCallback((v: ViewMode) => {
    updateState({
      viewMode: v,
      accumulatedPosts: v === 'infinite' ? (storeState.rawResults?.posts ?? []) : [],
      page: 0,
      hasMore: true,
    });
  }, []);
  const setSortMode = useCallback(
    (v: SortMode) => updateState({ sortMode: v }),
    []
  );
  const setPage = useCallback((v: number) => updateState({ page: v }), []);
  const setRawResults = useCallback(
    (v: ApiResponse | null) => updateState({ rawResults: v }),
    []
  );
  const setBookmarks = useCallback(
    (v: BookmarkEntry[]) => updateState({ bookmarks: v }),
    []
  );
  const setTabView = useCallback(
    (v: TabView) => updateState({ tabView: v }),
    []
  );
  const toggleFavorite = useCallback((post: NormalizedPost) => {
    const existing = storeState.favorites;
    const isFav = existing.some((f) => String(f.id) === String(post.id));
    const next = isFav
      ? existing.filter((f) => String(f.id) !== String(post.id))
      : [post, ...existing];
    updateState({ favorites: next });
    saveFavorites(next);
  }, []);
  const removeFavorite = useCallback((postId: string | number) => {
    const next = storeState.favorites.filter(
      (f) => String(f.id) !== String(postId)
    );
    updateState({ favorites: next });
    saveFavorites(next);
  }, []);
  const isFavorite = useCallback(
    (postId: string | number) =>
      storeState.favorites.some((f) => String(f.id) === String(postId)),
    []
  );

  return {
    apiUrl,
    setApiUrl,
    tags,
    setTags,
    scoreFloor,
    setScoreFloor,
    limit,
    setLimit,
    apiKey,
    setApiKey,
    userId,
    setUserId,
    viewMode,
    setViewMode,
    sortMode,
    setSortMode,
    page,
    setPage,
    loading,
    error,
    rawResults,
    setRawResults,
    accumulatedPosts,
    hasMore,
    bookmarks,
    setBookmarks,
    favorites,
    toggleFavorite,
    removeFavorite,
    isFavorite,
    tabView,
    setTabView,
    sessionLoaded,
    fetchImages,
  };
}

/** Load persisted session + bookmarks into the store once on mount. */
function useHydrateStore() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const session = loadSession();
    if (session) {
      updateState({
        apiUrl: session.apiUrl ?? '',
        tags: session.tags ?? '',
        scoreFloor: session.scoreFloor ?? 0,
        limit: session.limit ?? 100,
        apiKey: session.apiKey ?? '',
        userId: session.userId ?? '',
        viewMode: session.viewMode ?? 'pagination',
        sortMode: session.sortMode ?? 'default',
        sessionLoaded: true,
      });
    } else {
      updateState({ sessionLoaded: true });
    }
    updateState({ bookmarks: loadBookmarks(), favorites: loadFavorites() });
  }, []);
}

/** Debounced auto-save of current session to localStorage. */
function useAutoSaveSession() {
  const {
    apiUrl,
    tags,
    scoreFloor,
    limit,
    apiKey,
    userId,
    viewMode,
    sortMode,
    sessionLoaded,
  } = useBooruStore();
  useEffect(() => {
    if (!sessionLoaded) return;
    const timer = setTimeout(() => {
      saveSession({ apiUrl, tags, scoreFloor, limit, apiKey, userId, viewMode, sortMode });
    }, 400);
    return () => clearTimeout(timer);
  }, [
    apiUrl,
    tags,
    scoreFloor,
    limit,
    apiKey,
    userId,
    viewMode,
    sortMode,
    sessionLoaded,
  ]);
}

/* ----------------------------- main ------------------------------- */

export default function Home() {
  useHydrateStore();
  useAutoSaveSession();
  const { tabView } = useBooruStore();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <DeployBanner />
      <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl w-full">
        <TabBar />
        {tabView === 'search' ? (
          <>
            <ControlPanel />
            <ResultsArea />
          </>
        ) : (
          <FavoritesView />
        )}
      </main>
      <Footer />
      <Toaster />
    </div>
  );
}

/* ----------------------------- tab bar ---------------------------- */

function TabBar() {
  const { tabView, setTabView, favorites } = useBooruStore();
  return (
    <div className="flex items-center gap-1 border-b border-border mb-4">
      <button
        onClick={() => setTabView('search')}
        className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
          tabView === 'search'
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        <Search className="h-3.5 w-3.5 inline mr-1.5" />
        Search
      </button>
      <button
        onClick={() => setTabView('favorites')}
        className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
          tabView === 'favorites'
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        <Heart className="h-3.5 w-3.5" />
        Favorites
        {favorites.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {favorites.length}
          </Badge>
        )}
      </button>
    </div>
  );
}

/* -------------------------- deploy banner ------------------------- */

function DeployBanner() {
  const mounted = useMounted();

  // Read dismissal state once on mount (no setState-in-effect)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('booru-deploy-banner-dismissed') === '1';
  });

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('booru-deploy-banner-dismissed', '1');
    }
  };

  if (!mounted || dismissed) return null;

  return (
    <div className="border-b border-primary/20 bg-primary/5">
      <div className="container mx-auto max-w-7xl px-4 py-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground flex-1 min-w-0">
          <span className="font-medium text-foreground">Want this site to never expire?</span>{' '}
          Deploy it free to Vercel — see <code className="bg-muted px-1 rounded text-[10px]">DEPLOYMENT.md</code> in the source zip.
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href="https://vercel.com/new"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline whitespace-nowrap"
          >
            Deploy →
          </a>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- header ----------------------------- */

function Header() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="container mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">B</span>
          </div>
          <h1 className="text-base sm:text-lg font-semibold tracking-tight">
            Booru Image Viewer
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1">
                <Info className="h-4 w-4" />
                <span className="hidden sm:inline">Help</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <div className="p-3 text-xs space-y-2 text-muted-foreground">
                <p className="font-medium text-foreground text-sm">How to use</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Paste a booru JSON API URL (or click a preset).</li>
                  <li>Enter your API key + user ID in Credentials (needed for Gelbooru).</li>
                  <li>Add optional tags, pick a min. score.</li>
                  <li>Choose Pagination or Infinite Scroll.</li>
                  <li>Click <strong>Load</strong>. Click any thumbnail to open the lightbox.</li>
                </ol>
                <p className="pt-1">
                  For Gelbooru, get a free API key at:{' '}
                  <a
                    href="https://gelbooru.com/index.php?page=account&s=options"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    My Account &rarr; Options
                  </a>
                </p>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {mounted && theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}

/* ------------------------- control panel -------------------------- */

function ControlPanel() {
  const {
    apiUrl,
    setApiUrl,
    tags,
    setTags,
    scoreFloor,
    setScoreFloor,
    limit,
    setLimit,
    apiKey,
    setApiKey,
    userId,
    setUserId,
    viewMode,
    setViewMode,
    sortMode,
    setSortMode,
    setPage,
    loading,
    fetchImages,
  } = useBooruStore();

  const { toast } = useToast();

  const onPreset = (url: string) => {
    setApiUrl(url);
    toast({ title: 'Preset loaded', description: url });
  };

  const onLoad = () => {
    if (!apiUrl.trim()) {
      toast({
        title: 'Missing URL',
        description: 'Paste a booru API URL first.',
        variant: 'destructive',
      });
      return;
    }
    setPage(0);
    if (viewMode === 'infinite') {
      updateState({ accumulatedPosts: [], hasMore: true });
    }
    fetchImages(0);
  };

  return (
    <section className="space-y-4">
      {/* API URL + Load */}
      <div className="space-y-2">
        <Label
          htmlFor="api-url"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Booru API URL
        </Label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            id="api-url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1"
            className="font-mono text-xs sm:text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) onLoad();
            }}
          />
          <Button onClick={onLoad} disabled={loading} className="shrink-0 gap-2">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {loading ? 'Loading' : 'Load'}
          </Button>
        </div>
      </div>

      {/* Preset chips + view mode toggle */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Presets:</span>
          {PRESET_HOSTS.map((h) => (
            <Button
              key={h.label}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onPreset(h.url)}
              title={`${h.url}\n${h.note}`}
            >
              {h.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Credentials (collapsible) */}
      <CredentialsSection
        apiUrl={apiUrl}
        apiKey={apiKey}
        userId={userId}
        setApiKey={setApiKey}
        setUserId={setUserId}
      />

      {/* Filter row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg border border-border bg-card/50">
        {/* tags with autocomplete */}
        <TagInputWithAutocomplete
          tags={tags}
          setTags={setTags}
          apiUrl={apiUrl}
          apiKey={apiKey}
          userId={userId}
          loading={loading}
          onLoad={onLoad}
        />

        {/* limit + sort */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label
              htmlFor="limit"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Per Page
            </Label>
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger id="limit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100 (max)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="sort"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Sort by Score
            </Label>
            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger id="sort" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="score_desc">Highest first</SelectItem>
                <SelectItem value="score_asc">Lowest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* score slider */}
        <div className="space-y-2 md:col-span-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Min. Score
            </Label>
            <Badge variant="secondary" className="font-mono">
              score:&gt;{scoreFloor}
            </Badge>
          </div>
          <Slider
            value={[scoreFloor]}
            onValueChange={(v) => setScoreFloor(v[0])}
            min={0}
            max={1000}
            step={5}
            className="py-1"
          />
          <div className="flex flex-wrap gap-1 pt-1">
            {[5, 50, 100, 250, 500, 1000].map((p) => (
              <Button
                key={p}
                size="sm"
                variant={scoreFloor === p ? 'default' : 'outline'}
                className="h-6 px-2 text-[10px]"
                onClick={() => setScoreFloor(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* View mode + Bookmarks */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">View:</span>
          <Button
            size="sm"
            variant={viewMode === 'pagination' ? 'default' : 'outline'}
            className="h-7 text-xs gap-1"
            onClick={() => setViewMode('pagination')}
          >
            <ChevronLeft className="h-3 w-3" />
            Pagination
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'infinite' ? 'default' : 'outline'}
            className="h-7 text-xs gap-1"
            onClick={() => setViewMode('infinite')}
          >
            Infinite Scroll
          </Button>
        </div>
        <BookmarkControls
          current={{
            apiUrl,
            tags,
            scoreFloor,
            limit,
            apiKey,
            userId,
          }}
        />
      </div>
    </section>
  );
}

/* ----------------------- tag input with autocomplete --------------- */

interface TagSuggestion {
  name: string;
  count: number;
}

function TagInputWithAutocomplete({
  tags,
  setTags,
  apiUrl,
  apiKey,
  userId,
  loading,
  onLoad,
}: {
  tags: string;
  setTags: (v: string) => void;
  apiUrl: string;
  apiKey: string;
  userId: string;
  loading: boolean;
  onLoad: () => void;
}) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract the word currently being typed (last token after a space)
  const currentWord = (() => {
    const parts = tags.split(/\s+/);
    // If the tags string ends with a space, the user is starting a new word
    if (tags.endsWith(' ')) return '';
    return parts[parts.length - 1] ?? '';
  })();

  const fetchSuggestions = useCallback(
    async (term: string) => {
      if (!term || term.length < 2 || !apiUrl) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      setLoadingSuggestions(true);
      try {
        const params = new URLSearchParams({
          api_url: apiUrl,
          term,
        });
        if (apiKey) params.set('api_key', apiKey);
        if (userId) params.set('user_id', userId);
        const res = await fetch(`/api/tags?${params.toString()}`);
        const data = await res.json();
        if (data.suggestions) {
          setSuggestions(data.suggestions);
          setShowSuggestions(data.suggestions.length > 0);
          setActiveSuggestion(-1);
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setLoadingSuggestions(false);
      }
    },
    [apiUrl, apiKey, userId]
  );

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setTags(newValue);

    // Debounce autocomplete
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const parts = newValue.split(/\s+/);
    const word = newValue.endsWith(' ') ? '' : parts[parts.length - 1];
    if (word && word.length >= 2) {
      debounceRef.current = setTimeout(() => fetchSuggestions(word), 250);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const applySuggestion = (suggestion: TagSuggestion) => {
    // Replace the current word with the chosen tag
    const parts = tags.split(/\s+/).filter(Boolean);
    if (tags.endsWith(' ') || tags === '') {
      parts.push(suggestion.name);
    } else {
      parts[parts.length - 1] = suggestion.name;
    }
    const newValue = parts.join(' ') + ' ';
    setTags(newValue);
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveSuggestion(-1);
    // Refocus
    setTimeout(() => {
      inputRef.current?.focus();
      // Move cursor to end
      const len = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(len, len);
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion((i) =>
          i < suggestions.length - 1 ? i + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion((i) =>
          i > 0 ? i - 1 : suggestions.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && activeSuggestion >= 0)) {
        e.preventDefault();
        if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
          applySuggestion(suggestions[activeSuggestion]);
          return;
        }
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === 'Enter' && !loading) {
      onLoad();
    }
  };

  // Click-outside listener — closes the suggestion dropdown when clicking
  // anywhere outside the input container. This is more reliable than the
  // old onBlur+setTimeout approach which could fire before a suggestion
  // click registered on desktop.
  useEffect(() => {
    if (!showSuggestions) return;
    const onClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    // Use mousedown so it fires before blur/click on the input
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showSuggestions]);

  const onFocus = () => {
    if (suggestions.length > 0 && currentWord.length >= 2) {
      setShowSuggestions(true);
    }
  };

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  };

  return (
    <div ref={containerRef} className="space-y-2 relative">
      <Label
        htmlFor="tags"
        className="text-xs uppercase tracking-wide text-muted-foreground"
      >
        Tags (optional, space-separated)
      </Label>
      <div className="relative">
        <input
          ref={inputRef}
          id="tags"
          type="text"
          value={tags}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          placeholder="cat_ears rating:general 1girl"
          className="font-mono text-xs flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          autoComplete="off"
          spellCheck={false}
        />
        {loadingSuggestions && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-md border border-border bg-popover shadow-md max-h-72 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={s.name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  applySuggestion(s);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  applySuggestion(s);
                }}
                onMouseEnter={() => setActiveSuggestion(i)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-accent ${
                  i === activeSuggestion ? 'bg-accent' : ''
                }`}
              >
                <span className="font-mono truncate">{s.name}</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {formatCount(s.count)}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Type a tag to see suggestions with post counts. Use ↑↓ to navigate,
        Tab or Enter to insert.
      </p>
    </div>
  );
}

/* ----------------------- credentials section ---------------------- */

function CredentialsSection({
  apiUrl,
  apiKey,
  userId,
  setApiKey,
  setUserId,
}: {
  apiUrl: string;
  apiKey: string;
  userId: string;
  setApiKey: (v: string) => void;
  setUserId: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const scheme = detectAuthScheme(apiUrl);
  const userIdLabel =
    scheme === 'danbooru' ? 'Login (username)' : 'User ID (numeric)';
  const userIdPlaceholder =
    scheme === 'danbooru' ? 'your_username' : '12345';

  const onParsePaste = () => {
    // Read from the ref first (handles cases where React state hasn't synced)
    const raw = pasteRef.current?.value ?? pasteText;
    const parsed = parseCredentials(raw);
    if (!parsed.apiKey && !parsed.userId) {
      toast({
        title: 'Could not parse',
        description:
          'Paste the full &api_key=...&user_id=... string, or "apikey userid" separated by a space.',
        variant: 'destructive',
      });
      return;
    }
    if (parsed.apiKey) setApiKey(parsed.apiKey);
    if (parsed.userId) setUserId(parsed.userId);
    setPasteOpen(false);
    setPasteText('');
    if (pasteRef.current) pasteRef.current.value = '';
    toast({
      title: 'Credentials parsed',
      description: `API Key: ${parsed.apiKey ? parsed.apiKey.slice(0, 8) + '...' : '(none)'}, User ID: ${parsed.userId || '(none)'}`,
    });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 text-xs">
            <Key className="h-3.5 w-3.5" />
            Credentials
            {(apiKey || userId) && (
              <Badge variant="secondary" className="ml-1 text-[10px]">
                set
              </Badge>
            )}
          </Button>
        </CollapsibleTrigger>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setPasteOpen(true)}
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
          Paste credentials
        </Button>
      </div>
      <CollapsibleContent>
        <div className="mt-2 p-4 rounded-lg border border-border bg-card/50 space-y-3">
          <p className="text-xs text-muted-foreground">
            {scheme === 'gelbooru' &&
              'Gelbooru / Safebooru / Rule34: pass your numeric User ID + API Key. Gelbooru now requires these for most queries.'}
            {scheme === 'danbooru' &&
              'Danbooru / yande.re / Konachan: pass your username (login) + API Key.'}
            {scheme === 'none' &&
              'Paste an API URL first — auth fields will adapt to the detected host.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="api-key"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                API Key
              </Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="your_api_key_here"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="user-id"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                {userIdLabel}
              </Label>
              <Input
                id="user-id"
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder={userIdPlaceholder}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Keys are stored only in your browser&apos;s localStorage and sent
            directly to the booru API via the server proxy. They are never
            logged.
          </p>
        </div>
      </CollapsibleContent>

      {/* Paste credentials dialog */}
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>Paste Credentials</DialogTitle>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Paste your full credentials string here — the app will
              automatically extract the API key and user ID. Any of these
              formats work:
            </p>
            <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
              <li>
                <code className="bg-muted px-1 rounded">
                  &amp;api_key=abc...&amp;user_id=12345
                </code>
              </li>
              <li>
                <code className="bg-muted px-1 rounded">
                  api_key=abc...&amp;user_id=12345
                </code>
              </li>
              <li>
                <code className="bg-muted px-1 rounded">
                  https://gelbooru.com/...&amp;api_key=abc...&amp;user_id=12345
                </code>
              </li>
              <li>
                <code className="bg-muted px-1 rounded">abc123... 12345</code>{' '}
                (key space userid)
              </li>
            </ul>
            <textarea
              ref={pasteRef}
              defaultValue={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="&api_key=9eac98cc...&user_id=2002159"
              className="font-mono text-xs min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onParsePaste}>Parse &amp; Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}

/* ----------------------- bookmark controls ------------------------ */

function BookmarkControls({
  current,
}: {
  current: Omit<BookmarkEntry, 'name' | 'createdAt'>;
}) {
  const { bookmarks, setBookmarks } = useBooruStore();
  const { setApiUrl, setTags, setScoreFloor, setLimit, setApiKey, setUserId } =
    useBooruStore();
  const { toast } = useToast();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({
        title: 'Name required',
        description: 'Enter a name for this bookmark.',
        variant: 'destructive',
      });
      return;
    }
    const entry: BookmarkEntry = {
      ...current,
      name: trimmed,
      createdAt: Date.now(),
    };
    const next = [...bookmarks.filter((b) => b.name !== trimmed), entry];
    setBookmarks(next);
    saveBookmarks(next);
    setSaveOpen(false);
    setName('');
    toast({ title: 'Bookmark saved', description: trimmed });
  };

  const load = (bm: BookmarkEntry) => {
    setApiUrl(bm.apiUrl);
    setTags(bm.tags);
    setScoreFloor(bm.scoreFloor);
    setLimit(bm.limit);
    setApiKey(bm.apiKey);
    setUserId(bm.userId);
    toast({ title: 'Bookmark loaded', description: bm.name });
  };

  const remove = (bm: BookmarkEntry) => {
    const next = bookmarks.filter((b) => b.name !== bm.name);
    setBookmarks(next);
    saveBookmarks(next);
    toast({ title: 'Bookmark removed', description: bm.name });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={() => setSaveOpen(true)}
      >
        <Bookmark className="h-3.5 w-3.5" />
        Save
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
            <BookmarkCheck className="h-3.5 w-3.5" />
            Bookmarks
            {bookmarks.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {bookmarks.length}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Saved Bookmarks</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {bookmarks.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              No bookmarks saved yet.
            </div>
          ) : (
            bookmarks.map((bm) => (
              <div
                key={bm.name}
                className="flex items-center justify-between gap-1 group"
              >
                <DropdownMenuItem
                  className="flex-1 cursor-pointer"
                  onClick={() => load(bm)}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">
                      {bm.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate font-mono">
                      score:&gt;{bm.scoreFloor} · {bm.limit}/page
                    </span>
                  </div>
                </DropdownMenuItem>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-60 group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    remove(bm);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Save Bookmark</DialogTitle>
          <div className="space-y-3 py-2">
            <Label htmlFor="bm-name" className="text-xs">
              Bookmark name
            </Label>
            <Input
              id="bm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Gelbooru high-score cat_ears"
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Saves URL, tags, score floor, per-page, and credentials.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------- results area -------------------------- */

function ResultsArea() {
  const { loading, rawResults, error, viewMode, accumulatedPosts, page } =
    useBooruStore();

  // Initial loading state (first load, no results yet)
  if (loading && accumulatedPosts.length === 0 && !rawResults) {
    return (
      <section className="mt-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 15 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      </section>
    );
  }

  if (error && accumulatedPosts.length === 0 && !rawResults) {
    const is401 =
      error.error.includes('401') ||
      error.detail?.includes('401') ||
      error.error.toLowerCase().includes('unauthorized');
    return (
      <section className="mt-8 space-y-4">
        <div className="p-3 rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-sm">
          <p className="font-medium">{error.error}</p>
          {error.detail && (
            <pre className="mt-1 text-xs whitespace-pre-wrap break-all text-destructive/80">
              {error.detail}
            </pre>
          )}
        </div>
        {is401 && (
          <div className="p-4 rounded-md border border-primary/50 bg-primary/5 text-sm space-y-2">
            <p className="font-medium text-foreground">
              Authentication required
            </p>
            <p className="text-muted-foreground">
              This booru requires an API key. Click{' '}
              <strong>Paste credentials</strong> below the URL field, then paste
              your <code>&amp;api_key=...&amp;user_id=...</code> string and
              click <strong>Parse &amp; Save</strong>. Then hit Load again.
            </p>
          </div>
        )}
        {!is401 && (
          <p className="text-center text-muted-foreground text-sm">
            Tip: if you see <code>401 Unauthorized</code> from Gelbooru, open the
            Credentials panel and enter your API key + user ID.
          </p>
        )}
      </section>
    );
  }

  if (!rawResults && accumulatedPosts.length === 0) {
    return (
      <section className="mt-12 text-center space-y-3">
        <div className="mx-auto h-16 w-16 rounded-full bg-muted flex items-center justify-center">
          <Search className="h-7 w-7 text-muted-foreground" />
        </div>
        <p className="text-lg font-medium">
          Paste a booru API URL and hit Load
        </p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Works with Gelbooru, Danbooru, Safebooru, Rule34, yande.re, Konachan.
          Add your API key in Credentials if you get a 401.
        </p>
      </section>
    );
  }

  return <ImageGrid />;
}

/* --------------------------- image grid --------------------------- */

function ImageGrid() {
  const {
    rawResults,
    accumulatedPosts,
    viewMode,
    error,
  } = useBooruStore();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const posts =
    viewMode === 'infinite'
      ? accumulatedPosts
      : rawResults?.posts ?? [];

  // Derive a safe index — null if out of bounds (avoids setState-in-effect)
  const safeIndex =
    activeIndex !== null && activeIndex < posts.length
      ? activeIndex
      : null;

  // Lightbox keyboard nav
  useEffect(() => {
    if (safeIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveIndex(null);
      if (e.key === 'ArrowRight')
        setActiveIndex((i) =>
          i === null ? i : Math.min(i + 1, posts.length - 1)
        );
      if (e.key === 'ArrowLeft')
        setActiveIndex((i) => (i === null ? i : Math.max(i - 1, 0)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [safeIndex, posts.length]);

  if (posts.length === 0) {
    return (
      <section className="mt-12 text-center text-muted-foreground text-sm">
        No posts matched this query. Try lowering the score floor or simplifying
        your tags.
      </section>
    );
  }

  const sourceUrl = rawResults?.source ?? '';

  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing <strong className="text-foreground">{posts.length}</strong>{' '}
          {viewMode === 'infinite' ? 'posts (accumulated)' : 'posts'}
        </span>
        {sourceUrl && (
          <span className="truncate max-w-[60%]" title={sourceUrl}>
            from{' '}
            {(() => {
              try {
                return new URL(sourceUrl).host;
              } catch {
                return 'upstream';
              }
            })()}
          </span>
        )}
      </div>

      {error && viewMode === 'infinite' && accumulatedPosts.length > 0 && (
        <div className="p-2 rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-xs">
          {error.error} — stopped loading more.
        </div>
      )}

      <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 [column-fill:_balance]">
        {posts.map((p, i) => (
          <ImageCard
            key={`${p.id}-${i}`}
            post={p}
            onClick={() => setActiveIndex(i)}
          />
        ))}
      </div>

      {viewMode === 'pagination' ? (
        <Pagination />
      ) : (
        <InfiniteScrollSentinel />
      )}

      <Lightbox
        posts={posts}
        index={safeIndex}
        onClose={() => setActiveIndex(null)}
        onNav={setActiveIndex}
      />
    </section>
  );
}

/* --------------------------- image card --------------------------- */

function ImageCard({
  post,
  onClick,
  showFavoriteButton = true,
}: {
  post: NormalizedPost;
  onClick: () => void;
  showFavoriteButton?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const { toggleFavorite, isFavorite } = useBooruStore();
  const fav = isFavorite(post.id);

  const isVideo = isVideoPost(post);
  const thumbSrc = proxyMediaUrl(
    post.preview_url ?? post.sample_url ?? post.file_url
  );

  const onFavClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    toggleFavorite(post);
  };

  if (!thumbSrc || errored) {
    return (
      <div
        onClick={onClick}
        className="mb-3 break-inside-avoid w-full rounded-md border border-border bg-muted/40 flex items-center justify-center aspect-square text-xs text-muted-foreground hover:bg-muted/80 transition-colors relative cursor-pointer"
      >
        {isVideo ? 'Video unavailable' : 'Image unavailable'}
        {showFavoriteButton && (
          <FavoriteStar fav={fav} onClick={onFavClick} />
        )}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="mb-3 break-inside-avoid w-full rounded-md overflow-hidden border border-border bg-card hover:ring-2 hover:ring-primary/50 transition-all relative group cursor-pointer"
    >
      <img
        src={thumbSrc}
        alt={post.tags.slice(0, 5).join(', ') || `post ${post.id}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={`w-full h-auto block transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {!loaded && (
        <div className="absolute inset-0 bg-muted/50 animate-pulse" />
      )}

      {/* score overlay */}
      <div className="absolute top-1.5 right-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
        {post.score}
      </div>

      {/* rating badge */}
      <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded uppercase">
        {post.rating}
      </div>

      {/* favorite button */}
      {showFavoriteButton && (
        <FavoriteStar fav={fav} onClick={onFavClick} />
      )}

      {/* video indicator */}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-10 w-10 rounded-full bg-black/60 flex items-center justify-center">
            <Play className="h-5 w-5 text-white fill-white ml-0.5" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------- favorite star -------------------------- */

function FavoriteStar({
  fav,
  onClick,
}: {
  fav: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
      className={`absolute bottom-1.5 right-1.5 h-8 w-8 rounded-full flex items-center justify-center transition-all ${
        fav
          ? 'bg-red-500/90 text-white opacity-100'
          : 'bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80'
      }`}
    >
      <Heart
        className={`h-4 w-4 ${fav ? 'fill-white' : ''}`}
      />
    </button>
  );
}

/* ----------------------------- lightbox --------------------------- */

function Lightbox({
  posts,
  index,
  onClose,
  onNav,
}: {
  posts: NormalizedPost[];
  index: number | null;
  onClose: () => void;
  onNav: (i: number) => void;
}) {
  const open = index !== null;
  const post = open ? posts[index] : null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toggleFavorite, isFavorite } = useBooruStore();

  const isVideo = post ? isVideoPost(post) : false;
  const fav = post ? isFavorite(post.id) : false;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden gap-0 max-h-[90vh]">
        {post && (
          <div className="flex flex-col md:flex-row h-full max-h-[90vh]">
            {/* media area */}
            <div className="flex-1 bg-black flex items-center justify-center relative min-h-[40vh]">
              {isVideo ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <video
                    ref={videoRef}
                    src={proxyMediaUrl(post.file_url ?? post.sample_url) ?? ''}
                    controls
                    autoPlay
                    loop
                    playsInline
                    className="max-h-[90vh] max-w-full"
                  />
                  <button
                    onClick={() => requestVideoFullscreen(videoRef.current)}
                    className="absolute bottom-4 right-4 h-10 px-3 rounded-full bg-black/70 text-white flex items-center gap-2 hover:bg-black/90 text-xs font-medium"
                    aria-label="Fullscreen"
                  >
                    <Maximize className="h-4 w-4" />
                    Fullscreen
                  </button>
                </div>
              ) : (
                <img
                  src={proxyMediaUrl(post.sample_url ?? post.file_url ?? post.preview_url) ?? ''}
                  alt={`post ${post.id}`}
                  className="max-h-[90vh] max-w-full object-contain"
                />
              )}

              {/* nav arrows */}
              <button
                onClick={() => onNav(Math.max((index ?? 0) - 1, 0))}
                disabled={(index ?? 0) === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={() =>
                  onNav(Math.min((index ?? 0) + 1, posts.length - 1))
                }
                disabled={(index ?? 0) === posts.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* metadata */}
            <aside className="md:w-80 shrink-0 p-4 overflow-y-auto bg-background border-t md:border-t-0 md:border-l border-border max-h-[40vh] md:max-h-[90vh]">
              <div className="flex items-center justify-between mb-3 gap-2">
                <DialogTitle className="text-sm font-mono truncate">
                  Post #{post.id}
                </DialogTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant={fav ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => toggleFavorite(post)}
                  >
                    <Heart className={`h-3.5 w-3.5 ${fav ? 'fill-current' : ''}`} />
                    {fav ? 'Favorited' : 'Favorite'}
                  </Button>
                  {isVideo && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Play className="h-3 w-3 fill-current" />
                      VIDEO
                    </Badge>
                  )}
                </div>
              </div>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Score</dt>
                  <dd className="font-mono font-medium">{post.score}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Rating</dt>
                  <dd className="uppercase">{post.rating}</dd>
                </div>
                {post.width && post.height && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Size</dt>
                    <dd className="font-mono">
                      {post.width}&times;{post.height}
                    </dd>
                  </div>
                )}
                {post.file_ext && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Format</dt>
                    <dd className="font-mono uppercase">{post.file_ext}</dd>
                  </div>
                )}
                {post.source && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Source</dt>
                    <dd>
                      <a
                        href={post.source}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1 truncate max-w-[180px]"
                      >
                        link <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </dd>
                  </div>
                )}
                {post.file_url && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">File</dt>
                    <dd>
                      <a
                        href={post.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1 truncate max-w-[180px]"
                      >
                        open <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Tags ({post.tags.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {post.tags.slice(0, 60).map((t, i) => (
                    <Badge
                      key={`${t}-${i}`}
                      variant="secondary"
                      className="text-[10px] font-mono"
                    >
                      {t}
                    </Badge>
                  ))}
                  {post.tags.length > 60 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{post.tags.length - 60} more
                    </span>
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- pagination --------------------------- */

function Pagination() {
  const { page, setPage, fetchImages, loading, rawResults } = useBooruStore();
  const full = rawResults?.posts.length ?? 0;
  const canPrev = page > 0;
  const canNext = !loading && full > 0;

  const go = (p: number) => {
    if (p < 0) return;
    setPage(p);
    fetchImages(p);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 pt-4 border-t border-border">
      <Button
        variant="outline"
        size="sm"
        onClick={() => go(page - 1)}
        disabled={!canPrev || loading}
        className="gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        Prev
      </Button>
      <span className="text-xs text-muted-foreground font-mono">
        Page {page + 1}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => go(page + 1)}
        disabled={!canNext || loading}
        className="gap-1"
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ---------------------- infinite scroll sentinel ------------------ */

function InfiniteScrollSentinel() {
  const { fetchImages, page, loading, hasMore, viewMode, rawResults } =
    useBooruStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewMode !== 'infinite') return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && hasMore) {
          fetchImages(page + 1);
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode, page, loading, hasMore, fetchImages, rawResults]);

  if (viewMode !== 'infinite') return null;

  const loadedCount = rawResults?.posts.length ?? 0;

  return (
    <div ref={ref} className="py-6 flex flex-col items-center gap-2">
      {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
      {!loading && !hasMore && loadedCount === 0 && (
        <p className="text-xs text-muted-foreground">End of results.</p>
      )}
      {!loading && hasMore && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchImages(page + 1)}
          disabled={loading}
          className="gap-1"
        >
          Load more
        </Button>
      )}
    </div>
  );
}

/* --------------------------- favorites view ----------------------- */

function FavoritesView() {
  const { favorites, removeFavorite } = useBooruStore();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Lightbox keyboard nav
  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveIndex(null);
      if (e.key === 'ArrowRight')
        setActiveIndex((i) =>
          i === null ? i : Math.min(i + 1, favorites.length - 1)
        );
      if (e.key === 'ArrowLeft')
        setActiveIndex((i) => (i === null ? i : Math.max(i - 1, 0)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, favorites.length]);

  if (favorites.length === 0) {
    return (
      <section className="mt-12 text-center space-y-3">
        <div className="mx-auto h-16 w-16 rounded-full bg-muted flex items-center justify-center">
          <Heart className="h-7 w-7 text-muted-foreground" />
        </div>
        <p className="text-lg font-medium">No favorites yet</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Click the heart icon on any post in the search results to save it
          here. Your favorites are stored in your browser and persist across
          sessions.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{favorites.length}</strong>{' '}
          favorited {favorites.length === 1 ? 'post' : 'posts'}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => {
            if (
              confirm(
                `Remove all ${favorites.length} favorites? This cannot be undone.`
              )
            ) {
              favorites.forEach((f) => removeFavorite(f.id));
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear all
        </Button>
      </div>

      <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 [column-fill:_balance]">
        {favorites.map((p, i) => (
          <ImageCard
            key={`fav-${p.id}-${i}`}
            post={p}
            onClick={() => setActiveIndex(i)}
          />
        ))}
      </div>

      <Lightbox
        posts={favorites}
        index={activeIndex}
        onClose={() => setActiveIndex(null)}
        onNav={setActiveIndex}
      />
    </section>
  );
}

/* ----------------------------- footer ----------------------------- */

function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-background/80 backdrop-blur">
      <div className="container mx-auto max-w-7xl px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          Booru image viewer with score filtering, video playback, bookmarks &amp;
          infinite scroll. Respect each site&apos;s rate limits and ToS.
        </p>
        <p className="font-mono">Next.js 16 &middot; client-side proxy</p>
      </div>
    </footer>
  );
}
