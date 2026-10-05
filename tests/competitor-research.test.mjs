import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompetitorResearch } from '../src/competitor-research.mjs';

test('builds a separate read-only opportunity investigation with canonical references', () => {
  const task = buildCompetitorResearch({ repositories: ['https://github.com/PaperclipAI/Paperclip/', 'https://github.com/paperclipai/paperclip'], focus: '  Memória e delegação  ' }, 'C:/projects/nexo');
  assert.deepEqual(task.competitor_repositories, ['https://github.com/paperclipai/paperclip']);
  assert.equal(task.workspace, 'C:/projects/nexo');
  assert.equal(task.agent, 'codex');
  assert.equal(task.profile, 'discovery');
  assert.equal(task.specialist, 'opportunity-analyst');
  assert.equal(task.max_minutes, 20);
  assert.equal(task.opportunity_audit, true);
  assert.equal(task.discovery_kind, 'competitor_research');
  assert.match(task.goal, /Memória e delegação/);
  assert.match(task.goal, /até três/);
  assert.match(task.acceptance, /commit/);
  assert.match(task.acceptance, /Não copiar/);
  assert.equal(task.status, undefined);
});

test('rejects empty, malformed and oversized reference lists', () => {
  for (const repositories of [undefined, null, [], 'https://github.com/a/b', Array(9).fill('https://github.com/a/b'), [null], ['']]) {
    assert.throws(() => buildCompetitorResearch({ repositories }, 'workspace'), /reposit/i);
  }
});

test('accepts only a literal HTTPS GitHub repository URL without credentials or navigation', () => {
  const unsafe = [
    'http://github.com/a/b', 'file:///a/b', 'https://example.com/a/b',
    'https://github.com.evil.test/a/b', 'https://www.github.com/a/b',
    'https://user:password@github.com/a/b', 'https://github.com:443/a/b',
    'https://github.com/a/b?token=secret', 'https://github.com/a/b?',
    'https://github.com/a/b#readme', 'https://github.com/a/b#',
    'https://github.com/a/b/tree/main', 'https://github.com/a',
    'https://github.com/a/../b/c', 'https://github.com/a/%62',
    'https://github.com/a/b\\c', 'https://github.com/a//b',
    'https://github.com/a/b\n', 'https://github.com/a/..',
  ];
  for (const reference of unsafe) {
    assert.throws(() => buildCompetitorResearch({ repositories: [reference] }, 'workspace'), /reposit/i, reference);
  }
  assert.deepEqual(buildCompetitorResearch({ repositories: ['https://GITHUB.com/Owner/Repo.git/'] }, 'workspace').competitor_repositories, ['https://github.com/owner/repo']);
});

test('bounds focus and requires workspace without authorizing or resolving it', () => {
  const repositories = ['https://github.com/a/b'];
  assert.equal(buildCompetitorResearch({ workspace: ' ../relative ', repositories }, 'configured').workspace, '../relative');
  assert.equal(buildCompetitorResearch({ workspace: ' ', repositories, focus: 'x'.repeat(800) }, ' configured ').workspace, 'configured');
  for (const focus of [null, {}, 'x'.repeat(801)]) {
    assert.throws(() => buildCompetitorResearch({ repositories, focus }, 'workspace'), /foco/i);
  }
  assert.throws(() => buildCompetitorResearch({ repositories }), /workspace/i);
  assert.throws(() => buildCompetitorResearch({ workspace: {}, repositories }, 'configured'), /workspace/i);
  assert.throws(() => buildCompetitorResearch(null, 'configured'), /entrada/i);
});
