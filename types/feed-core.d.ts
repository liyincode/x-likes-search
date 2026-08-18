declare const module: { exports: unknown };

declare namespace XLS {
  type SortMode = "newest" | "oldest" | "author";
  type DateInput = string | number | Date | null | undefined;

  interface PhotoMedia {
    type: "photo";
    url: string;
    width: number;
    height: number;
    altText: string;
  }

  interface MediaSourceRecord {
    tweetId: string;
    text: string;
    datetime: string | null;
    author: string;
    displayName: string;
    avatar: string;
    url: string;
  }

  interface LikeRecord {
    tweetId: string;
    text: string;
    datetime: string | null;
    author: string;
    displayName: string;
    avatar: string;
    url: string;
    capturedAt: number;
    hue?: number;
    likes?: number;
    reposts?: number;
    media?: PhotoMedia[];
    mediaSource?: MediaSourceRecord;
  }

  interface ViewAuthor {
    name: string;
    handle: string;
    hue: number;
    avatar: string;
  }

  interface MediaSourceView {
    tweetId: string;
    text: string;
    date: string;
    author: ViewAuthor;
    url: string;
  }

  interface LikeView extends MediaSourceView {
    capturedAt: number;
    raw: LikeRecord;
    media?: PhotoMedia[];
    mediaSource?: MediaSourceView;
    stats?: { likes: number | null; reposts: number | null };
    searchHay: string;
  }

  interface GalleryPhotoItem {
    likedTweet: LikeView;
    tweet: LikeView | MediaSourceView;
    media: PhotoMedia;
    mediaIndex: number;
  }

  type LikeIndex = Record<string, LikeRecord>;

  interface MergeOptions {
    updateMedia?: boolean;
  }

  interface MergeResult {
    added: number;
    mediaUpdated: number;
  }

  interface StorageAreaLike {
    set(items: Record<string, unknown>): Promise<void>;
  }

  interface RowLayout {
    tops: number[];
    heights: number[];
    totalHeight: number;
  }

  interface VisibleRange {
    start: number;
    end: number;
    totalHeight: number;
  }

  interface ParsedLikes {
    tweets: LikeRecord[];
    nextCursor: string | null;
    mediaFallbackCount: number;
  }

  interface XMedia {
    type?: string;
    media_url_https?: string;
    original_info?: { width?: number; height?: number };
    sizes?: { large?: { w?: number; h?: number } };
    ext_alt_text?: string;
  }

  interface XUser {
    legacy?: {
      screen_name?: string;
      name?: string;
      profile_image_url_https?: string;
    };
    core?: { screen_name?: string; name?: string };
    avatar?: { image_url?: string };
  }

  interface XTweet {
    __typename?: string;
    rest_id?: string;
    note_tweet?: { note_tweet_results?: { result?: { text?: string } } };
    core?: { user_results?: { result?: XUser } };
    legacy?: {
      id_str?: string;
      full_text?: string;
      created_at?: string | null;
      favorite_count?: number;
      retweet_count?: number;
      extended_entities?: { media?: XMedia[] };
      retweeted_status_result?: { result?: XTweetResult };
    };
  }

  interface XVisibilityResult {
    __typename: "TweetWithVisibilityResults";
    tweet?: XTweet;
  }

  type XTweetResult = XTweet | XVisibilityResult;

  interface XTimelineContent {
    entryType?: string;
    cursorType?: string;
    value?: string;
    itemContent?: {
      itemType?: string;
      tweet_results?: { result?: XTweetResult };
    };
  }

  interface XTimelineEntry {
    content?: XTimelineContent;
  }

  interface XTimelineInstruction {
    type?: string;
    entry?: XTimelineEntry;
    entries?: XTimelineEntry[];
  }

  interface LikesResponse {
    data?: {
      user?: {
        result?: {
          timeline_v2?: { timeline?: { instructions?: XTimelineInstruction[] } };
          timeline?: { timeline?: { instructions?: XTimelineInstruction[] } };
        };
      };
    };
  }

  interface FeedCoreApi {
    escapeHTML(value: unknown): string;
    normalizeLike(item: LikeRecord): LikeView;
    readonly INDEX_VERSION: number;
    mediaUrl(url: unknown, size: string): string;
    flattenPhotoItems(tweets: LikeView[]): GalleryPhotoItem[];
    mergeLikes(index: LikeIndex, tweets: LikeRecord[], options?: MergeOptions): MergeResult;
    formatStorageError(error: unknown): string;
    setStorageRequired(storageArea: StorageAreaLike, items: Record<string, unknown>): Promise<void>;
    matches(tweet: LikeView, query: string): boolean;
    countMatches(list: LikeView[], query: string): number;
    readonly ROW_COLLAPSED: number;
    readonly ROW_ACTIVE_EXPANDED: number;
    buildRowOffsets(count: number, activeIndex: number, collapsed?: number, expanded?: number): RowLayout;
    visibleRange(scrollTop: number, viewportHeight: number, layout: RowLayout, overscan?: number): VisibleRange;
    highlight(text: unknown, query: string): string;
    sortList(list: LikeView[], mode: SortMode): LikeView[];
    pipeline(list: LikeView[], sort?: SortMode): LikeView[];
    initials(name: unknown): string;
    avatarColors(hue: number): { bg: string; bg2: string };
    relativeDate(iso: DateInput, now?: DateInput): string;
    fullDate(iso: DateInput): string;
    addHistory(existing: string[], query: string): string[];
    removeHistory(existing: string[], query: string): string[];
    parseLikesResponse(body: unknown): ParsedLikes;
  }

  type FeedCoreRoot = typeof globalThis & { FeedCore?: FeedCoreApi };
}
