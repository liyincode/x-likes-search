export interface XMedia {
  type?: string;
  media_url_https?: string;
  original_info?: { width?: number; height?: number };
  sizes?: { large?: { w?: number; h?: number } };
  ext_alt_text?: string;
}

export interface XUser {
  legacy?: {
    screen_name?: string;
    name?: string;
    profile_image_url_https?: string;
  };
  core?: { screen_name?: string; name?: string };
  avatar?: { image_url?: string };
}

export interface XTweet {
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

export interface XVisibilityResult {
  __typename: "TweetWithVisibilityResults";
  tweet?: XTweet;
}

export type XTweetResult = XTweet | XVisibilityResult;

export interface XTimelineContent {
  entryType?: string;
  cursorType?: string;
  value?: string;
  itemContent?: {
    itemType?: string;
    tweet_results?: { result?: XTweetResult };
  };
}

export interface XTimelineEntry {
  content?: XTimelineContent;
}

export interface XTimelineInstruction {
  type?: string;
  direction?: string;
  entry?: XTimelineEntry;
  entries?: XTimelineEntry[];
}

export interface LikesResponse {
  data?: {
    user?: {
      result?: {
        timeline_v2?: { timeline?: { instructions?: XTimelineInstruction[] } };
        timeline?: { timeline?: { instructions?: XTimelineInstruction[] } };
      };
    };
  };
}
