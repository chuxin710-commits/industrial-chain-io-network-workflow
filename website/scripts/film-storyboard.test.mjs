import test from 'node:test';
import assert from 'node:assert/strict';
import { FILM_DURATION, FILM_SHOTS, SHOT_DURATION, shotAt } from '../src/film-storyboard.js';

test('eight unique scenes cover the complete score with bilingual captions', () => {
  assert.equal(FILM_SHOTS.length, 8);
  assert.equal(new Set(FILM_SHOTS.map(({ id }) => id)).size, 8);
  assert.equal(FILM_SHOTS.length * SHOT_DURATION, FILM_DURATION);
  for (const shot of FILM_SHOTS) {
    assert.match(shot.cn, /[\u4e00-\u9fff]/);
    assert.match(shot.en, /[A-Z]/);
  }
});

test('cuts use the same timeline for the MV and the website captions', () => {
  for (let index = 0; index < FILM_SHOTS.length; index++) {
    const start = index * SHOT_DURATION;
    assert.equal(shotAt(start).id, FILM_SHOTS[index].id);
    assert.equal(shotAt(start + 3.999).id, FILM_SHOTS[index].id);
    assert.equal(shotAt(start + SHOT_DURATION).index, (index + 1) % 8);
  }
});

test('loop and negative-time wrapping stay deterministic', () => {
  assert.deepEqual(shotAt(0), shotAt(FILM_DURATION));
  assert.deepEqual(shotAt(2), shotAt(FILM_DURATION * 3 + 2));
  assert.deepEqual(shotAt(-1), shotAt(FILM_DURATION - 1));
});
