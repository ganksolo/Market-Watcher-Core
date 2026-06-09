export interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  location?: string;
  verified?: boolean;
  verified_type?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
  created_at?: string;
}

export interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  lang?: string;
  public_metrics?: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
    quote_count: number;
    bookmark_count: number;
    impression_count: number;
  };
  referenced_tweets?: Array<{
    type: 'retweeted' | 'quoted' | 'replied_to';
    id: string;
  }>;
}

export interface XApiResponse<T> {
  data?: T;
  errors?: XApiError[];
}

export interface XApiListResponse<T> {
  data?: T[];
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    next_token?: string;
    result_count?: number;
  };
  errors?: XApiError[];
}

export interface XApiError {
  title: string;
  detail?: string;
  type?: string;
}
