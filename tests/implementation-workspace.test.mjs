import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createImplementationWorkspace, inspectImplementationChanges, mergeImplementationChanges } from '../src/implementation-workspace.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nexo-isolation-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'code');
  await mkdir(workspace);
  await writeFile(join(workspace, 'app.js'), 'baseline');
  return { root, workspace, isolationRoot: join(root, 'isolated'), taskId: 'mission-1', attemptId: 'attempt-1' };
}

test('snapshot copies source and build files with SHA256 baseline while excluding credentials and dependencies', async t => {
  const input = await fixture(t);
  for (const name of ['.env', 'private.pem', 'credentials.json', 'package.json']) await writeFile(join(input.workspace, name), name);
  await mkdir(join(input.workspace, 'node_modules'));
  await writeFile(join(input.workspace, 'node_modules', 'dependency.js'), 'excluded');
  const snapshot = await createImplementationWorkspace(input);
  assert.equal(await readFile(join(snapshot.workspace, 'app.js'), 'utf8'), 'baseline');
  const manifest = JSON.parse(await readFile(snapshot.manifestPath, 'utf8'));
  assert.match(manifest.files['app.js'].sha256, /^[a-f0-9]{64}$/);
  assert.ok(manifest.files['package.json']);
  for (const name of ['.env', 'private.pem', 'credentials.json', 'node_modules/dependency.js']) assert.equal(manifest.files[name], undefined);
  await assert.rejects(createImplementationWorkspace(input), /exist|EEXIST/i);
});

test('reports updates creates deletes and only merges under an exclusive caller lease', async t => {
  const snapshot = await createImplementationWorkspace(await fixture(t));
  await writeFile(join(snapshot.workspace, 'app.js'), 'changed');
  await writeFile(join(snapshot.workspace, 'new.ts'), 'created');
  const report = await inspectImplementationChanges(snapshot);
  assert.deepEqual(report.changes.map(c => [c.path, c.kind]), [['app.js', 'update'], ['new.ts', 'create']]);
  await assert.rejects(mergeImplementationChanges(snapshot), /exclusive/i);
  await mergeImplementationChanges(snapshot, { exclusiveWriter: true });
  assert.equal(await readFile(join(snapshot.sourceWorkspace, 'app.js'), 'utf8'), 'changed');
  assert.equal(await readFile(join(snapshot.sourceWorkspace, 'new.ts'), 'utf8'), 'created');
});

test('any canonical conflict blocks all writes including previously clean paths', async t => {
  const snapshot = await createImplementationWorkspace(await fixture(t));
  await writeFile(join(snapshot.workspace, 'app.js'), 'implementation');
  await writeFile(join(snapshot.workspace, 'new.ts'), 'implementation');
  await writeFile(join(snapshot.sourceWorkspace, 'new.ts'), 'concurrent');
  await assert.rejects(mergeImplementationChanges(snapshot, { exclusiveWriter: true }), /conflict/i);
  assert.equal(await readFile(join(snapshot.sourceWorkspace, 'app.js'), 'utf8'), 'baseline');
  assert.equal(await readFile(join(snapshot.sourceWorkspace, 'new.ts'), 'utf8'), 'concurrent');
});

test('deleted files are reported and a concurrent update prevents deletion', async t => {
  const snapshot = await createImplementationWorkspace(await fixture(t));
  await rm(join(snapshot.workspace, 'app.js'));
  assert.equal((await inspectImplementationChanges(snapshot)).changes[0].kind, 'delete');
  await writeFile(join(snapshot.sourceWorkspace, 'app.js'), 'concurrent');
  await assert.rejects(mergeImplementationChanges(snapshot, { exclusiveWriter: true }), /conflict/i);
  assert.equal(await readFile(join(snapshot.sourceWorkspace, 'app.js'), 'utf8'), 'concurrent');
});

test('symlinks are excluded from snapshot and rejected when introduced into isolated changes', async t => {
  const input = await fixture(t);
  const linkedDirectory = join(input.root, 'linked');
  await mkdir(linkedDirectory);
  await writeFile(join(linkedDirectory, 'private.js'), 'excluded');
  try { await symlink(linkedDirectory, join(input.workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('OS does not permit symlink creation'); throw error; }
  const snapshot = await createImplementationWorkspace(input);
  assert.equal(JSON.parse(await readFile(snapshot.manifestPath, 'utf8')).files['link/private.js'], undefined);
  await symlink(linkedDirectory, join(snapshot.workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectImplementationChanges(snapshot), /symbolic|symlink/i);
});

test('invalid identities and overlapping source/isolation paths fail closed', async t => {
  const input = await fixture(t);
  await assert.rejects(createImplementationWorkspace({ ...input, taskId: '../escape' }), /ident/i);
  await assert.rejects(createImplementationWorkspace({ ...input, isolationRoot: join(input.workspace, 'nested') }), /overlap/i);
});

test('independent attempts stay isolated and stale overlapping changes conflict', async t => {
  const input = await fixture(t);
  const first = await createImplementationWorkspace(input);
  const second = await createImplementationWorkspace({ ...input, attemptId: 'attempt-2' });
  assert.notEqual(first.workspace, second.workspace);
  await writeFile(join(first.workspace, 'app.js'), 'first');
  await writeFile(join(second.workspace, 'app.js'), 'second');
  const outcomes = await Promise.allSettled([
    mergeImplementationChanges(first, { exclusiveWriter: true }),
    mergeImplementationChanges(second, { exclusiveWriter: true }),
  ]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.ok(['first', 'second'].includes(await readFile(join(input.workspace, 'app.js'), 'utf8')));
  const loser = outcomes[0].status === 'rejected' ? first : second;
  await assert.rejects(mergeImplementationChanges(loser, { exclusiveWriter: true }), /conflict/i);
});

test('clean deletion merges and an introduced private file fails closed', async t => {
  const snapshot = await createImplementationWorkspace(await fixture(t));
  await mkdir(join(snapshot.workspace, 'node_modules'));
  await writeFile(join(snapshot.workspace, 'node_modules', 'generated.js'), 'artifact');
  assert.deepEqual((await inspectImplementationChanges(snapshot)).changes, []);
  await writeFile(join(snapshot.workspace, '.env.local'), 'secret');
  await assert.rejects(inspectImplementationChanges(snapshot), /private|excluded/i);
  await rm(join(snapshot.workspace, '.env.local'));
  await rm(join(snapshot.workspace, 'app.js'));
  await mergeImplementationChanges(snapshot, { exclusiveWriter: true });
  await assert.rejects(readFile(join(snapshot.sourceWorkspace, 'app.js')), { code: 'ENOENT' });
});

for (const kind of ['update', 'create', 'delete']) test(`cancellation after partially applied ${kind} rolls back before releasing the lease`, async t => {
  const snapshot = await createImplementationWorkspace(await fixture(t));
  const first = kind === 'create' ? 'a-created.txt' : 'app.js';
  if (kind === 'delete') await rm(join(snapshot.workspace, first));
  else await writeFile(join(snapshot.workspace, first), 'changed');
  await writeFile(join(snapshot.workspace, 'z-last.txt'), 'must not merge');
  let sawMutation = false;
  await assert.rejects(mergeImplementationChanges(snapshot, {
    exclusiveWriter: true,
    shouldContinue: () => {
      const target = join(snapshot.sourceWorkspace, first);
      const changed = kind === 'delete' ? !existsSync(target) : existsSync(target) && readFileSync(target, 'utf8') === 'changed';
      if (changed) {
        sawMutation = true;
        assert.ok(existsSync(join(snapshot.sourceWorkspace, '.nexo-merge-lock')), 'lease remains during cancellation');
      }
      return !changed;
    },
  }), { name: 'AbortError', code: 'ABORT_ERR' });
  assert.ok(sawMutation, 'cancellation occurs after an actual canonical mutation');
  assert.equal(await readFile(join(snapshot.sourceWorkspace, 'app.js'), 'utf8'), 'baseline');
  if (kind === 'create') assert.equal(existsSync(join(snapshot.sourceWorkspace, first)), false);
  assert.equal(existsSync(join(snapshot.sourceWorkspace, 'z-last.txt')), false);
  assert.deepEqual(readdirSync(snapshot.sourceWorkspace), ['app.js']);
  // A fresh merge proves both internal lock and isolated changes survived.
  await mergeImplementationChanges(snapshot, { exclusiveWriter: true });
  assert.equal(await readFile(join(snapshot.sourceWorkspace, 'z-last.txt'), 'utf8'), 'must not merge');
});

test('an already aborted signal prevents canonical mutation or lock creation', async t => {
  const snapshot = await createImplementationWorkspace(await fixture(t));
  await writeFile(join(snapshot.workspace, 'app.js'), 'changed');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(mergeImplementationChanges(snapshot, { exclusiveWriter: true, signal: controller.signal }), { name: 'AbortError', code: 'ABORT_ERR' });
  assert.equal(await readFile(join(snapshot.sourceWorkspace, 'app.js'), 'utf8'), 'baseline');
  assert.deepEqual(readdirSync(snapshot.sourceWorkspace), ['app.js']);
});

test('cancellation after creating parent directories removes empty directories under the lease', async t => {
  const snapshot = await createImplementationWorkspace(await fixture(t));
  await mkdir(join(snapshot.workspace, 'nested', 'child'), { recursive: true });
  await writeFile(join(snapshot.workspace, 'nested', 'child', 'new.js'), 'changed');
  await assert.rejects(mergeImplementationChanges(snapshot, {
    exclusiveWriter: true,
    shouldContinue: () => !existsSync(join(snapshot.sourceWorkspace, 'nested', 'child')),
  }), { name: 'AbortError', code: 'ABORT_ERR' });
  assert.deepEqual(readdirSync(snapshot.sourceWorkspace), ['app.js']);
});
