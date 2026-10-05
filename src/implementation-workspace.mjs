import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile, rename, rm, rmdir } from 'node:fs/promises';
import { resolve, relative, dirname, join, isAbsolute, sep } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const derived = name => /^(?:node_modules|\.venv|venv|dist|build|coverage|\.next)$/i.test(name);
const excluded = name => /^(?:\.git|node_modules|\.env(?:\..*)?|\.npmrc|\.pypirc|\.aws|\.ssh|\.codex|\.nexo-merge-lock|(?:config|mcp_config|settings)\.local\.json|credentials?(?:\..*)?|secrets?(?:\..*)?|private(?:[._-].*)?|auth(?:\..*)?|tokens?(?:\..*)?|\.venv|venv|dist|build|coverage|\.next)$/i.test(name) || /\.(?:pem|key|p12|pfx|keystore)$/i.test(name);
const identity = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value);
const overlaps = (a, b) => a === b || (!relative(a, b).startsWith('..' + sep) && !isAbsolute(relative(a, b))) || (!relative(b, a).startsWith('..' + sep) && !isAbsolute(relative(b, a)));

async function safePath(path) {
  const absolute = resolve(path);
  let cursor = absolute;
  while (true) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symbolic link path is forbidden.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return absolute;
}

function filePath(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..' || excluded(part)) || isAbsolute(name)) throw new Error('Unsafe manifest file path.');
  const path = resolve(root, ...name.split('/'));
  if (relative(root, path).startsWith('..') || isAbsolute(relative(root, path))) throw new Error('File escapes workspace.');
  return path;
}

async function scan(root, { rejectExcluded = false, skipSymlinks = false } = {}) {
  await safePath(root);
  const files = Object.create(null);
  let count = 0, total = 0;
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      // New symlinks are rejected even when their name resembles an ignored build.
      if (stat.isSymbolicLink()) { if (skipSymlinks) continue; throw new Error('Symbolic link introduced: ' + name); }
      if (excluded(entry.name)) {
        if (rejectExcluded && !derived(entry.name)) throw new Error('Excluded private path introduced: ' + name);
        continue;
      }
      if (stat.isDirectory()) { await walk(path, name + '/'); continue; }
      if (!stat.isFile()) throw new Error('Unsupported file type: ' + name);
      if (++count > 10000 || stat.size > 50 * 1024 * 1024 || (total += stat.size) > 200 * 1024 * 1024) throw new Error('Snapshot size limit exceeded.');
      const bytes = await readFile(path);
      files[name] = { sha256: digest(bytes), size: bytes.length, mode: stat.mode & 0o777 };
    }
  }
  await walk(root);
  return files;
}

export async function fingerprintWorkspace(workspace) {
  const files = await scan(workspace, { skipSymlinks: true });
  return { files, hash: digest(Buffer.from(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))))) };
}

/** No executor or deployment is started. Caller must separately authorize use. */
export async function createImplementationWorkspace({ workspace, isolationRoot, taskId, attemptId }) {
  if (!identity(taskId) || !identity(attemptId)) throw new Error('Invalid task or attempt identity.');
  if (typeof workspace !== 'string' || !isAbsolute(workspace) || typeof isolationRoot !== 'string' || !isAbsolute(isolationRoot)) throw new Error('Absolute workspace paths required.');
  const sourceWorkspace = await safePath(workspace), root = await safePath(isolationRoot);
  if (overlaps(sourceWorkspace, root)) throw new Error('Source and isolation root overlap.');
  if (!(await lstat(sourceWorkspace)).isDirectory()) throw new Error('Source workspace is not a directory.');
  await mkdir(root, { recursive: true });
  const container = join(root, `${taskId}--${attemptId}`);
  await mkdir(container); // Exclusive creation; never reuse another attempt.
  const snapshot = { sourceWorkspace, workspace: join(container, 'workspace'), manifestPath: join(container, 'baseline.json'), taskId, attemptId };
  try {
    await mkdir(snapshot.workspace);
    const baseline = await scan(sourceWorkspace, { skipSymlinks: true });
    for (const [name, before] of Object.entries(baseline)) {
      const source = filePath(sourceWorkspace, name);
      await safePath(source);
      const bytes = await readFile(source);
      if (digest(bytes) !== before.sha256) throw new Error('Source changed during snapshot: ' + name);
      const target = filePath(snapshot.workspace, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx', mode: before.mode });
    }
    const manifest = { version: 1, sourceWorkspace, taskId, attemptId, files: baseline };
    await writeFile(snapshot.manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    return snapshot;
  } catch (error) {
    await rm(container, { recursive: true, force: true });
    throw error;
  }
}

async function load(snapshot) {
  if (!snapshot || !identity(snapshot.taskId) || !identity(snapshot.attemptId)) throw new Error('Invalid snapshot identity.');
  for (const key of ['sourceWorkspace', 'workspace', 'manifestPath']) {
    if (typeof snapshot[key] !== 'string' || !isAbsolute(snapshot[key])) throw new Error('Invalid snapshot path.');
    await safePath(snapshot[key]);
  }
  const container = dirname(snapshot.manifestPath);
  if (snapshot.workspace !== join(container, 'workspace') || snapshot.manifestPath !== join(container, 'baseline.json') || overlaps(snapshot.sourceWorkspace, container)) throw new Error('Invalid snapshot layout.');
  const manifest = JSON.parse(await readFile(snapshot.manifestPath, 'utf8'));
  if (manifest.version !== 1 || manifest.sourceWorkspace !== snapshot.sourceWorkspace || manifest.taskId !== snapshot.taskId || manifest.attemptId !== snapshot.attemptId || !manifest.files || Array.isArray(manifest.files)) throw new Error('Invalid baseline manifest.');
  for (const [name, value] of Object.entries(manifest.files)) {
    filePath(snapshot.sourceWorkspace, name);
    if (!value || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 0) throw new Error('Invalid baseline fingerprint.');
  }
  return manifest;
}

export async function inspectImplementationChanges(snapshot) {
  const baseline = await load(snapshot);
  const current = await scan(snapshot.workspace, { rejectExcluded: true });
  const changes = [];
  for (const name of [...new Set([...Object.keys(baseline.files), ...Object.keys(current)])].sort()) {
    const before = baseline.files[name] || null, after = current[name] || null;
    if (before?.sha256 !== after?.sha256) changes.push({ path: name, kind: !before ? 'create' : !after ? 'delete' : 'update', before, after });
  }
  const ordered = files => Object.keys(files).sort().map(name => [name, files[name]]);
  const snapshot_digest = digest(Buffer.from(JSON.stringify({taskId:snapshot.taskId,attemptId:snapshot.attemptId,baseline:ordered(baseline.files),current:ordered(current)})));
  return { taskId: snapshot.taskId, attemptId: snapshot.attemptId, changes, snapshot_digest };
}

async function fingerprint(path) {
  await safePath(path);
  try {
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error('Conflict: canonical target is not a regular file.');
    return digest(await readFile(path));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Requires a real exclusive writer lease on canonical workspace from scheduler.
 * The internal lock coordinates this module only; it cannot stop arbitrary writers. */
export async function mergeImplementationChanges(snapshot, { exclusiveWriter = false, shouldContinue = () => true, signal, expectedSnapshotDigest } = {}) {
  if (exclusiveWriter !== true) throw new Error('An exclusive writer lease is required before merge.');
  if (typeof shouldContinue !== 'function') throw new Error('shouldContinue must be a synchronous function.');
  const checkpoint = () => {
    if (signal?.aborted || shouldContinue() !== true) {
      const error = new Error('Integration cancelled; isolated changes preserved.');
      error.name = 'AbortError'; error.code = 'ABORT_ERR'; throw error;
    }
  };
  // Only use this helper before canonical mutations. Applied mutations must be
  // recorded before checking cancellation so rollback includes the last write.
  const checked = async operation => { const value = await operation; checkpoint(); return value; };
  checkpoint();
  const report = await checked(inspectImplementationChanges(snapshot));
  if(expectedSnapshotDigest!==undefined&&report.snapshot_digest!==expectedSnapshotDigest)throw new Error('Reviewed snapshot changed; integration refused.');
  const lock = join(snapshot.sourceWorkspace, '.nexo-merge-lock');
  await checked(safePath(lock));
  checkpoint();
  await mkdir(lock); // Existing lock fails closed; never steal an unknown lease.
  const applied = [], staged = [], createdDirectories = [];
  let release = true;
  const ensureDirectory = async directory => {
    const missing = [];
    let current = directory;
    while (current !== snapshot.sourceWorkspace) {
      try { await checked(lstat(current)); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(current); current = dirname(current); }
    }
    for (const path of missing.reverse()) {
      checkpoint();
      await mkdir(path);
      createdDirectories.push(path);
      checkpoint();
    }
  };
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }), { flag: 'wx' });
    checkpoint();
    // All conflicts are discovered before touching ANY canonical file.
    const conflicts = [];
    for (const change of report.changes) {
      if (await checked(fingerprint(filePath(snapshot.sourceWorkspace, change.path))) !== (change.before?.sha256 ?? null)) conflicts.push(change.path);
    }
    if (conflicts.length) throw new Error('Conflict in canonical files: ' + conflicts.join(', '));
    for (const change of report.changes) {
      const target = filePath(snapshot.sourceWorkspace, change.path);
      const original = change.before ? await checked(readFile(target)) : null;
      let bytes = null;
      if (change.after) {
        bytes = await checked(readFile(filePath(snapshot.workspace, change.path)));
        if (digest(bytes) !== change.after.sha256) throw new Error('Isolated file changed during merge: ' + change.path);
      }
      staged.push({ change, target, original, bytes, temporary: join(dirname(target), '.nexo-' + randomUUID()) });
    }
    // Recheck the entire set after preparing bytes, still before writing.
    if(expectedSnapshotDigest!==undefined&&(await checked(inspectImplementationChanges(snapshot))).snapshot_digest!==expectedSnapshotDigest)throw new Error('Reviewed snapshot changed before merge.');
    for (const item of staged) {
      if (await checked(fingerprint(item.target)) !== (item.change.before?.sha256 ?? null)) throw new Error('Conflict before merge: ' + item.change.path);
    }
    // Durable plan, written before the first canonical mutation: a process that dies mid-merge leaves the lock, this journal and
    // the originals, so reconcileInterruptedMerge can restore or block explicitly. The lock directory keeps exclusivity meanwhile.
    await writeJournal(lock, snapshot, report, expectedSnapshotDigest, staged);
    for (const item of staged) {
      await checked(safePath(dirname(item.target)));
      checkpoint();
      await ensureDirectory(dirname(item.target));
      if (await checked(fingerprint(item.target)) !== (item.change.before?.sha256 ?? null)) throw new Error('Conflict during merge: ' + item.change.path);
      if (item.bytes) {
        const temporary = item.temporary;
        try {
          checkpoint();
          await checked(writeFile(temporary, item.bytes, { flag: 'wx', mode: item.change.after.mode }));
          checkpoint();
          await rename(temporary, item.target);
          applied.push(item);
          checkpoint();
        } finally { await rm(temporary, { force: true }); }
        checkpoint();
      } else { checkpoint(); await rm(item.target); applied.push(item); checkpoint(); }
    }
    checkpoint();
    return { ...report, merged: true };
  } catch (error) {
    for (const item of applied.reverse()) {
      // Under the required lease this restores our writes. Never overwrite an
      // unexpected concurrent write even if a caller violated that lease.
      if (await fingerprint(item.target) !== (item.change.after?.sha256 ?? null)) { release = false; throw new Error('Merge failed; concurrent write prevents rollback: ' + item.change.path, { cause: error }); }
      if (item.original) await writeFile(item.target, item.original);
      else await rm(item.target, { force: true });
    }
    for (const directory of createdDirectories.reverse()) {
      try { await rmdir(directory); }
      catch (cleanupError) { if (!['ENOENT', 'ENOTEMPTY'].includes(cleanupError.code)) throw cleanupError; }
    }
    throw error;
  } finally {
    // A clean finish or a complete rollback frees the lease; an unrecoverable rollback keeps lock and journal for reconciliation.
    if (release) await rm(lock, { recursive: true, force: true });
  }
}

async function writeJournal(lock, snapshot, report, expectedSnapshotDigest, staged) {
  const missingDirectories = new Set();
  for (const item of staged) {
    let current = dirname(item.target);
    const chain = [];
    while (current !== snapshot.sourceWorkspace) {
      try { await lstat(current); break; } catch (error) { if (error.code !== 'ENOENT') throw error; chain.push(current); current = dirname(current); }
    }
    for (const directory of chain) missingDirectories.add(directory);
  }
  const posix = path => relative(snapshot.sourceWorkspace, path).split(sep).join('/');
  const items = staged.map((item, index) => ({
    index, path: item.change.path, kind: item.change.kind, before: item.change.before?.sha256 ?? null, after: item.change.after?.sha256 ?? null,
    before_mode: item.change.before?.mode ?? null, backup: item.original ? 'backup-' + index : null, temporary: posix(item.temporary),
  }));
  for (const [index, item] of staged.entries()) if (item.original) await writeFile(join(lock, 'backup-' + index), item.original, { flag: 'wx' });
  const journal = { version: 1, task_id: snapshot.taskId, attempt_id: snapshot.attemptId, snapshot_digest: report.snapshot_digest, expected_snapshot_digest: expectedSnapshotDigest ?? null, created_at: new Date().toISOString(), items, directories: [...missingDirectories].map(posix).sort((a, b) => b.length - a.length) };
  await writeFile(join(lock, 'journal.json'), JSON.stringify(journal, null, 2), { flag: 'wx' });
}

/** Reconciles a merge whose process died. Call only when no merge can be in flight (startup, or an owner that is gone).
 * Per file the canonical content is compared with the journal: untouched, applied, or divergent. Divergent files are never
 * overwritten: the whole recovery is blocked and the lock, journal and originals stay in place. Otherwise applied files are
 * restored from the journaled originals, leftover temporary files and directories are removed, and the lock is released.
 * When every file is verified as applied the result says so; marking the integration complete stays with the caller. */
export async function reconcileInterruptedMerge({ sourceWorkspace, expectedSnapshotDigest } = {}) {
  if (typeof sourceWorkspace !== 'string' || !isAbsolute(sourceWorkspace)) throw new Error('Absolute source workspace required.');
  const root = await safePath(sourceWorkspace), lock = join(root, '.nexo-merge-lock');
  try { if (!(await lstat(lock)).isDirectory()) return { status: 'blocked', reason: 'lock_is_not_a_directory', items: [] }; }
  catch (error) { if (error.code === 'ENOENT') return { status: 'no_interruption', items: [] }; throw error; }
  let owner = null;
  try { owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')); } catch { /* a lock that never recorded an owner has no live merge behind it */ }
  if (owner?.pid && owner.pid !== process.pid) {
    let alive = false;
    try { process.kill(owner.pid, 0); alive = true; } catch (error) { alive = error.code !== 'ESRCH'; }
    if (alive) return { status: 'blocked', reason: 'lock_owner_alive', owner_pid: owner.pid, items: [] };
  }
  let journal;
  try { journal = JSON.parse(await readFile(join(lock, 'journal.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') { await rm(lock, { recursive: true, force: true }); return { status: 'cleared_no_mutation', items: [] }; }
    return { status: 'blocked', reason: 'journal_unreadable', items: [] };
  }
  if (journal?.version !== 1 || !Array.isArray(journal.items) || (expectedSnapshotDigest !== undefined && journal.snapshot_digest !== expectedSnapshotDigest)) return { status: 'blocked', reason: 'journal_mismatch', items: [] };
  const items = [];
  for (const entry of journal.items) {
    const current = await fingerprint(filePath(root, entry.path));
    const state = current === entry.after && current !== entry.before ? 'applied' : current === entry.before ? 'pending' : 'divergent';
    items.push({ ...entry, state });
  }
  const summary = list => list.map(({ index, path, kind, state }) => ({ index, path, kind, state }));
  const blocked = reason => ({ status: 'blocked', reason, snapshot_digest: journal.snapshot_digest, items: summary(items) });
  if (items.some(item => item.state === 'divergent')) return blocked('divergent_files');
  const temporaries = journal.items.map(entry => resolve(root, ...entry.temporary.split('/')));
  const removeTemporaries = async () => { for (const temporary of temporaries) await rm(temporary, { force: true }); };
  if (items.every(item => item.state === 'applied')) {
    await removeTemporaries();
    await rm(lock, { recursive: true, force: true });
    return { status: 'all_applied', verified: true, snapshot_digest: journal.snapshot_digest, items: summary(items) };
  }
  // Check every backup before touching anything, so a damaged journal cannot cause a half-restored tree.
  const restores = [];
  for (const item of items.filter(entry => entry.state === 'applied')) {
    if (item.before === null) { restores.push({ item, bytes: null }); continue; }
    let bytes;
    try { bytes = await readFile(join(lock, item.backup ?? 'missing')); } catch { return blocked('backup_missing'); }
    if (digest(bytes) !== item.before) return blocked('backup_corrupted');
    restores.push({ item, bytes });
  }
  for (const { item, bytes } of restores) {
    const target = filePath(root, item.path);
    if (bytes === null) await rm(target, { force: true });
    else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes, { mode: item.before_mode ?? undefined }); }
  }
  await removeTemporaries();
  for (const directory of journal.directories ?? []) {
    try { await rmdir(resolve(root, ...directory.split('/'))); } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
  await rm(lock, { recursive: true, force: true });
  return { status: 'rolled_back', snapshot_digest: journal.snapshot_digest, items: summary(items) };
}

// ---- Immutable before/after evidence per implementation attempt -------------------------------------------------------
// The reviewed snapshot only carries hashes, and once a merge lands the canonical "before" is gone. This archive keeps, per task
// and attempt, the exact before/after text of every created, updated and deleted file (content-addressed blobs plus a manifest
// written once), so a change can be reconstructed without Git and stays stable no matter what later missions do. Binary and very
// large files keep hashes and sizes only. Paths that the snapshot already excludes (credentials, keys, dependencies) never appear.
const TEXT_LIMIT = 256 * 1024;
const isText = bytes => {
  if (bytes.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
};
async function writeBlob(directory, bytes) {
  const name = digest(bytes);
  try { await writeFile(join(directory, name), bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return name;
}

export async function archiveAttemptEvidence(snapshot, report, { evidenceRoot, maxTextBytes = TEXT_LIMIT } = {}) {
  if (!snapshot || !identity(snapshot.taskId) || !identity(snapshot.attemptId)) throw new Error('Invalid snapshot identity.');
  if (typeof evidenceRoot !== 'string' || !isAbsolute(evidenceRoot)) throw new Error('Absolute evidence root required.');
  if (!report || !/^[a-f0-9]{64}$/.test(report.snapshot_digest ?? '') || !Array.isArray(report.changes)) throw new Error('Invalid change report.');
  const directory = join(await safePath(evidenceRoot), snapshot.taskId, snapshot.attemptId), manifestPath = join(directory, 'manifest.json'), blobs = join(directory, 'blobs');
  const described = (manifest, body) => ({ directory, manifest_path: manifestPath, manifest_sha256: digest(Buffer.from(body)), snapshot_digest: manifest.snapshot_digest, change_count: manifest.changes.length, stored_files: manifest.changes.filter(change => change.content === 'stored').length });
  try {
    const body = await readFile(manifestPath, 'utf8'), existing = JSON.parse(body);
    if (existing.snapshot_digest !== report.snapshot_digest) throw new Error('Evidence for this attempt already exists for a different snapshot.');
    return described(existing, body);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(blobs, { recursive: true });
  const changes = [];
  for (const change of report.changes) {
    let beforeBytes = null, afterBytes = null;
    if (change.before) {
      // The canonical file still equals the baseline until the reviewed merge; if it moved, the "before" text is not recoverable.
      try { const bytes = await readFile(filePath(snapshot.sourceWorkspace, change.path)); if (digest(bytes) === change.before.sha256) beforeBytes = bytes; } catch { /* reported as before_unavailable */ }
    }
    if (change.after) {
      afterBytes = await readFile(filePath(snapshot.workspace, change.path));
      if (digest(afterBytes) !== change.after.sha256) throw new Error('Isolated file changed while archiving evidence: ' + change.path);
    }
    const present = [beforeBytes, afterBytes].filter(Boolean);
    const content = present.some(bytes => !isText(bytes)) ? 'binary' : present.some(bytes => bytes.length > maxTextBytes) ? 'too_large' : change.before && !beforeBytes ? 'before_unavailable' : 'stored';
    const side = (meta, bytes) => meta ? { sha256: meta.sha256, size: meta.size, ...(bytes && ['stored', 'before_unavailable'].includes(content) ? { blob: null } : {}) } : null;
    const entry = { path: change.path, kind: change.kind, content, before: side(change.before, beforeBytes), after: side(change.after, afterBytes) };
    if (entry.before && 'blob' in entry.before) entry.before.blob = await writeBlob(blobs, beforeBytes);
    if (entry.after && 'blob' in entry.after) entry.after.blob = await writeBlob(blobs, afterBytes);
    changes.push(entry);
  }
  const manifest = { version: 1, task_id: snapshot.taskId, attempt_id: snapshot.attemptId, snapshot_digest: report.snapshot_digest, created_at: new Date().toISOString(), changes };
  const body = JSON.stringify(manifest, null, 2);
  await writeFile(manifestPath, body, { flag: 'wx' });
  return described(manifest, body);
}

/** Reconstructs one archived change, verifying every returned text against its recorded hash. */
export async function readAttemptEvidence(directory, path) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const change = manifest.changes.find(row => row.path === path);
  if (!change) throw new Error('Path is not part of this attempt evidence.');
  const text = async side => {
    if (!side) return null;
    if (!side.blob) return undefined;
    const bytes = await readFile(join(directory, 'blobs', side.blob));
    if (digest(bytes) !== side.sha256) throw new Error('Evidence blob does not match its recorded hash.');
    return bytes.toString('utf8');
  };
  return { path: change.path, kind: change.kind, content: change.content, before: await text(change.before), after: await text(change.after), before_sha256: change.before?.sha256 ?? null, after_sha256: change.after?.sha256 ?? null };
}
