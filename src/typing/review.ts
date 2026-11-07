const DAY = 86_400_000;

export function nextReview(
  correct: boolean,
  prev: { streak: number; mastery: number },
  now: number,
): { streak: number; mastery: number; nextReviewAt: number; wrongBook: number } {
  if (!correct) {
    return {
      streak: 0,
      mastery: Math.max(0, prev.mastery - 1),
      nextReviewAt: now,
      wrongBook: 1,
    };
  }
  const streak = prev.streak + 1;
  const days = streak <= 1 ? 0.5 : streak === 2 ? 1 : streak === 3 ? 3 : streak === 4 ? 7 : 14;
  const mastery = streak >= 5 ? 3 : streak >= 3 ? 2 : Math.max(prev.mastery, 1);
  return {
    streak,
    mastery,
    nextReviewAt: now + days * DAY,
    wrongBook: 0,
  };
}

export function rankWeakKeys(
  rows: { key: string; hits: number; misses: number }[],
  limit = 4,
): string[] {
  return rows
    .filter((row) => row.misses > 0 && row.key.length === 1)
    .sort((a, b) => {
      const ar = a.misses / (a.hits + a.misses);
      const br = b.misses / (b.hits + b.misses);
      return br - ar || b.misses - a.misses || a.key.localeCompare(b.key);
    })
    .slice(0, limit)
    .map((row) => row.key);
}
