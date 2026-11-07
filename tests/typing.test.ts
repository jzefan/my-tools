import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEED_WORDS } from '../src/typing/catalog.ts';
import {
  LESSONS,
  buildWarmup,
  warmupKeys,
  isLessonUnlocked,
  lessonRun,
} from '../src/typing/curriculum.ts';
import {
  advanceItem,
  applyKey,
  createSession,
  finishedAll,
  sessionStats,
} from '../src/typing/engine.ts';
import { homeReturn, homeReturnNote, targetForChar } from '../src/typing/keyboard.ts';
import { nextReview, rankWeakKeys } from '../src/typing/review.ts';

test('home-row return drill leaves the new key and comes back', () => {
  assert.equal(homeReturn('e', 2), 'ded ded');
  assert.equal(homeReturnNote('i'), 'k i k');
  assert.equal(homeReturn('E', 1), 'dEd');
});

test('shift letters light the letter key and both shifts', () => {
  const target = targetForChar('A');
  assert.equal(target.shift, true);
  assert.ok(target.ids.includes('a'));
  assert.ok(target.ids.includes('shift-l'));
});

test('a wrong key does not advance and a correction still counts', () => {
  let state = createSession([{ id: '1', prompt: 'ab', wordId: 7 }]);
  const miss = applyKey(state, { key: 'x' }, { allowBackspace: false, now: 1 });
  assert.equal(miss.kind, 'miss');
  assert.equal(miss.state.charIndex, 0);
  state = applyKey(miss.state, { key: 'a' }, { allowBackspace: true, now: 2 }).state;
  state = applyKey(state, { key: 'Backspace' }, { allowBackspace: true, now: 3 }).state;
  assert.equal(state.charIndex, 0);
  assert.equal(state.correct, 1);
  const blocked = applyKey(state, { key: 'Backspace' }, { allowBackspace: false, now: 4 });
  assert.equal(blocked.kind, 'ignore');
  state = applyKey(state, { key: 'a' }, { allowBackspace: false, now: 5 }).state;
  state = applyKey(state, { key: 'b' }, { allowBackspace: false, now: 6 }).state;
  assert.equal(state.phase, 'hold');
  state = advanceItem(state, 7);
  assert.equal(finishedAll(state), true);
  assert.equal(state.wordResults[0].correct, false);
});

test('wpm counts five correct characters as one word', () => {
  let state = createSession([{ id: 'speed', prompt: 'a'.repeat(300) }]);
  for (let index = 0; index < 300; index += 1) {
    state = applyKey(state, { key: 'a' }, { allowBackspace: false, now: 1_000 }).state;
  }
  const stats = sessionStats({ ...state, startedAt: 1_000 }, 61_000);
  assert.ok(Math.abs(stats.wpm - 60) < 0.01);
});

test('review intervals and weak keys', () => {
  const first = nextReview(true, { streak: 0, mastery: 0 }, 0);
  assert.equal(first.streak, 1);
  assert.equal(first.wrongBook, 0);
  assert.equal(first.nextReviewAt, 12 * 60 * 60 * 1000);
  const missed = nextReview(false, first, 5);
  assert.equal(missed.streak, 0);
  assert.equal(missed.wrongBook, 1);
  assert.deepEqual(rankWeakKeys([
    { key: 'e', hits: 1, misses: 4 },
    { key: 'a', hits: 8, misses: 2 },
    { key: 'space', hits: 0, misses: 9 },
  ]), ['e', 'a']);
});

test('eight lessons stay typeable and unlock in order', () => {
  assert.equal(LESSONS.length, 8);
  for (const lesson of LESSONS) {
    assert.ok(lesson.steps.length >= 3);
    for (const step of lesson.steps) {
      assert.ok(step.items.length > 0);
      for (const item of step.items) assert.ok(item.prompt.length > 0);
    }
  }
  const know = LESSONS[0];
  assert.equal(know.steps[2].items.length, 8);
  assert.equal(LESSONS[1].steps[2].items.length, 3);
  assert.equal(LESSONS[2].steps[2].items.length, 12);
  assert.equal(isLessonUnlocked(1, {}), false);
  const done = Object.fromEntries(know.steps.map((step) => [step.id, { completed: true }]));
  assert.equal(isLessonUnlocked(1, done), true);
  const run = lessonRun(know, 0);
  assert.equal(run.assist, true);
  assert.equal(run.allowBackspace, false);
  assert.equal(buildWarmup(['e']).timedMs, 60_000);
  assert.deepEqual(warmupKeys(['c']), ['c', 'e', 'i', 'r']);
  assert.ok(buildWarmup(['c']).items.some((item) => item.prompt.includes('dcd')));
});

test('seed words keep stable unique ids', () => {
  const ids = new Set<number>();
  for (const word of SEED_WORDS) {
    assert.equal(ids.has(word.id), false);
    ids.add(word.id);
    assert.ok(word.word.length > 0);
    assert.ok(word.translation.length > 0);
  }
  assert.ok(SEED_WORDS.filter((word) => word.book === 'primary').length >= 100);
  assert.ok(SEED_WORDS.filter((word) => word.book === 'junior').length >= 30);
  assert.ok(SEED_WORDS.filter((word) => word.book === 'sentence').length >= 16);
});
