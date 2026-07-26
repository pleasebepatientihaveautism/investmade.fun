export function nextFeedExcludedAssetIds(
  feed: { candidates: Array<{ assetId: string }>; hasMore: boolean },
  selectedAssetIds: string[]
) {
  // ponytail: exhaust unique cards first, then recycle only skipped cards.
  return feed.hasMore ? feed.candidates.map(({ assetId }) => assetId) : selectedAssetIds;
}

export function fillFeedPage<T>(items: T[], size = 10): T[] {
  if (!items.length) return [];
  return Array.from({ length: size }, (_, index) => items[index % items.length] as T);
}
