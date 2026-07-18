// public/suggestions.js
// Apply-suggestions panel for the resume generator.
// One ES module: injects the panel below the existing buttons in the form,
// wires the file-pill UX, the free-text suggestions, and the
// POST /generate/applySuggestions + /generate/task/:taskId poll loop.

const DEFAULT_AUTO_ATTACH = [
  'ats-analysis.md',
  'job-description.txt',
  'other-input.txt',
  'structured-output-redacted.json',
];
const REDACTED_RESUME_NAME = 'structured-output-redacted.json';
const POLL_INTERVAL_MS = 5000;
const MAX_SUGGESTIONS_LENGTH = 4000;
const SLUG_WATCH_INTERVAL_MS = 1000;
const SLUG_WATCH_TIMEOUT_MS = 5 * 60 * 1000;

function el(id) { return document.getElementById(id); }

function fetchSuggestionsTemplate() {
  return fetch('suggestions.html', { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load suggestions.html: ${res.status}`);
      return res.text();
    })
    .then((html) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const tpl = doc.getElementById('suggestions-panel-template');
      const popover = doc.getElementById('suggestions-file-popover');
      const diffModal = doc.getElementById('suggestions-diff-modal');
      const allFound = [tpl, popover, diffModal].every(Boolean);
      if (!allFound) throw new Error('suggestions.html is missing expected nodes');
      return {
        tplContent: tpl.content.cloneNode(true),
        popover: popover.cloneNode(true),
        diffModal: diffModal.cloneNode(true),
      };
    });
}

function setStatus(node, message, kind) {
  if (!message) {
    node.className = 'status hidden';
    node.textContent = '';
    return;
  }
  node.className = 'status' + (kind ? ' ' + kind : '');
  node.textContent = message;
}

function fmtError(err) {
  if (err && err.message) return err.message;
  return String(err);
}

function getJobSlug() {
  const w = globalThis.__resumeOpencode;
  return w && w.lastJobDir ? w.lastJobDir : null;
}

function getCurrentModel() {
  const sel = el('model-select');
  return sel ? sel.value : undefined;
}

function createPill(name, removable, filePath) {
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.dataset.fileName = name;
  if (filePath) pill.dataset.filePath = filePath;
  pill.textContent = name;
  if (removable) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'pill-x';
    x.setAttribute('aria-label', `Remove ${name}`);
    x.textContent = '×';
    x.addEventListener('click', () => {
      pill.remove();
    });
    pill.appendChild(x);
  }
  return pill;
}

function initSuggestionsPanel({ tplContent, popover, diffModal }) {
  const form = el('resume-form');
  if (!form) throw new Error('resume-form not found; suggestions panel needs the form');
  const section = tplContent.querySelector('#suggestions-section');
  form.appendChild(section);
  document.body.appendChild(popover);
  document.body.appendChild(diffModal);

  const pills = el('suggestions-pills');
  const text = el('suggestions-text');
  const applyBtn = el('suggestions-apply-btn');
  const statusNode = el('suggestions-status');
  const resultNode = el('suggestions-result');
  const slugNode = el('suggestions-job-slug');
  const changeBtn = el('suggestions-change-folder');
  const addFileBtn = el('suggestions-add-file');
  const popoverRoot = el('suggestions-file-popover');
  const popoverList = el('suggestions-file-list');
  const popoverSearch = el('suggestions-file-search');
  const popoverCancel = el('suggestions-file-cancel');
  const pdfLink = el('suggestions-pdf-link');
  const backupPathNode = el('suggestions-backup-path');
  const sessionBlock = el('suggestions-session-block');
  const sessionIdNode = el('suggestions-session-id');
  const sessionCopyBtn = el('suggestions-session-copy');
  const webLink = el('suggestions-web-link');
  const diffModalRoot = el('suggestions-diff-modal');
  const diffTitle = el('suggestions-diff-title');
  const diffCloseBtn = el('suggestions-diff-close');
  const diffPre = el('suggestions-diff-pre');
  const diffPaths = el('suggestions-diff-paths');
  const diffEmpty = el('suggestions-diff-empty');
  const diffViewHunksBtn = el('diff-view-hunks');
  const diffViewFullBtn = el('diff-view-full');

  let lastKnownSlug = null;
  let slugWatchTimer = null;
  let diffModalTrigger = null;
  let lastUnifiedDiff = '';
  let cachedWordDiffHtml = null;
  let currentDiffSlug = '';
  let currentDiffVersion = '';

  function autoAttachDefaults() {
    for (const name of DEFAULT_AUTO_ATTACH) {
      if (pills.querySelector(`.pill[data-file-name="${CSS.escape(name)}"]`)) continue;
      const pill = createPill(name, true);
      if (name === REDACTED_RESUME_NAME) {
        pill.title = 'PII-stripped copy of structured-output.json — always sent to the model so it never sees your real name/email/phone';
      }
      pills.appendChild(pill);
    }
  }

  async function ensureRedactedResumeForCurrentJob() {
    const slug = getJobSlug();
    if (!slug) return;
    try {
      const res = await fetch('/generate/ensureRedactedResume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDir: slug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn('ensureRedactedResume failed:', data.error || res.status);
      }
    } catch (err) {
      console.warn('ensureRedactedResume network error:', err);
    }
  }

  function refreshSlug() {
    const slug = getJobSlug();
    if (slug && slug !== lastKnownSlug) {
      lastKnownSlug = slug;
      slugNode.textContent = slug;
      section.classList.remove('hidden');
      autoAttachDefaults();
      ensureRedactedResumeForCurrentJob();
    } else if (!slug) {
      slugNode.textContent = '(none — generate a resume first)';
      section.classList.add('hidden');
    }
  }

  function startSlugWatcher() {
    const startedAt = Date.now();
    if (slugWatchTimer) clearInterval(slugWatchTimer);
    slugWatchTimer = setInterval(() => {
      if (getJobSlug() && getJobSlug() !== lastKnownSlug) {
        refreshSlug();
        return;
      }
      if (Date.now() - startedAt > SLUG_WATCH_TIMEOUT_MS) {
        clearInterval(slugWatchTimer);
        slugWatchTimer = null;
      }
    }, SLUG_WATCH_INTERVAL_MS);
  }

  async function fetchFolderFiles() {
    const slug = getJobSlug();
    if (!slug) return [];
    const url = `/generate/listJobFiles?jobDir=${encodeURIComponent(slug)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to list files (${res.status})`);
    }
    const data = await res.json();
    return data.files || [];
  }

  function renderPopoverList(items, filter) {
    popoverList.innerHTML = '';
    const lower = filter.trim().toLowerCase();
    for (const f of items) {
      if (lower && !f.name.toLowerCase().includes(lower)) continue;
      if (pills.querySelector(`.pill[data-file-name="${CSS.escape(f.name)}"]`)) continue;
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = f.name;
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'button-tiny';
      addBtn.textContent = 'Add';
      addBtn.addEventListener('click', () => {
        pills.appendChild(createPill(f.name, true, f.path));
        li.remove();
      });
      li.appendChild(name);
      li.appendChild(addBtn);
      popoverList.appendChild(li);
    }
    if (!popoverList.children.length) {
      const empty = document.createElement('li');
      empty.className = 'popover-empty';
      empty.textContent = lower ? 'No matching files' : 'All files already attached';
      popoverList.appendChild(empty);
    }
  }

  function openFilePopover() {
    if (!getJobSlug()) {
      setStatus(statusNode, 'Generate a resume first so a job folder is available.', 'error');
      return;
    }
    popoverRoot.classList.remove('hidden');
    popoverSearch.value = '';
    fetchFolderFiles()
      .then((items) => renderPopoverList(items, ''))
      .catch(() => renderPopoverList([], ''));
    setTimeout(() => popoverSearch.focus(), 0);
  }

  function closeFilePopover() {
    popoverRoot.classList.add('hidden');
  }

  function renderDiffPaths(paths) {
    diffPaths.innerHTML = '';
    for (const p of paths) {
      const li = document.createElement('li');
      li.textContent = p;
      diffPaths.appendChild(li);
    }
    diffEmpty.classList.toggle('hidden', paths.length > 0);
  }

  async function fetchDiff(slug, version) {
    const url = `/generate/diffResume?jobDir=${encodeURIComponent(slug)}&version=v${version}&format=both`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  function renderDiffResponse(data) {
    lastUnifiedDiff = data.unifiedDiff || '';
    switchToHunksView(lastUnifiedDiff);
    const paths = (data.summary && data.summary.changedPaths) || [];
    renderDiffPaths(paths);
  }

  function switchToHunksView(unifiedDiff) {
    if (diffViewHunksBtn && diffViewFullBtn) {
      diffViewHunksBtn.classList.add('active');
      diffViewFullBtn.classList.remove('active');
    }
    diffPre.innerHTML = wrapDiffLinesWithSpans(unifiedDiff || '(no diff)');
  }

  function switchToFullView(wordDiffHtml) {
    if (diffViewHunksBtn && diffViewFullBtn) {
      diffViewHunksBtn.classList.remove('active');
      diffViewFullBtn.classList.add('active');
    }
    diffPre.innerHTML = wordDiffHtml;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function wrapDiffLinesWithSpans(diffText) {
    const lines = diffText.split('\n');
    return lines.map((line) => {
      if (line.startsWith('-')) {
        return '<span class="diff-removed">- ' + escapeHtml(line.slice(1)) + '</span>';
      }
      if (line.startsWith('+')) {
        return '<span class="diff-added">+ ' + escapeHtml(line.slice(1)) + '</span>';
      }
      return escapeHtml(line);
    }).join('\n');
  }

  async function openDiffModal(version, trigger) {
    const slug = getJobSlug();
    if (!slug) {
      setStatus(statusNode, 'Generate a resume first so a job folder is available.', 'error');
      return;
    }
    diffModalTrigger = trigger || null;
    currentDiffSlug = slug;
    currentDiffVersion = String(version);
    cachedWordDiffHtml = null;
    diffTitle.textContent = `Job: ${slug} · Backup: v${version}`;
    diffPre.textContent = 'Loading…';
    renderDiffPaths([]);
    diffModalRoot.classList.remove('hidden');
    setTimeout(() => diffCloseBtn.focus(), 0);
    try {
      const { ok, data } = await fetchDiff(slug, version);
      if (!ok) {
        diffPre.textContent = `Error: ${data.error || 'request failed'}`;
        return;
      }
      renderDiffResponse(data);
    } catch (err) {
      diffPre.textContent = `Network error: ${err && err.message ? err.message : err}`;
    }
  }

  function closeDiffModal() {
    diffModalRoot.classList.add('hidden');
    if (diffModalTrigger && typeof diffModalTrigger.focus === 'function') {
      diffModalTrigger.focus();
    }
    diffModalTrigger = null;
  }

  addFileBtn.addEventListener('click', openFilePopover);
  popoverCancel.addEventListener('click', closeFilePopover);
  popoverSearch.addEventListener('input', () => {
    fetchFolderFiles()
      .then((items) => renderPopoverList(items, popoverSearch.value))
      .catch(() => renderPopoverList([], popoverSearch.value));
  });
  popoverRoot.addEventListener('click', (e) => {
    if (e.target === popoverRoot) closeFilePopover();
  });
  diffCloseBtn.addEventListener('click', closeDiffModal);
  diffModalRoot.addEventListener('click', (e) => {
    if (e.target === diffModalRoot) closeDiffModal();
  });
  if (diffViewHunksBtn) {
    diffViewHunksBtn.addEventListener('click', () => {
      switchToHunksView(lastUnifiedDiff);
    });
  }
  if (diffViewFullBtn) {
    diffViewFullBtn.addEventListener('click', async () => {
      if (cachedWordDiffHtml) {
        switchToFullView(cachedWordDiffHtml);
        return;
      }
      if (!currentDiffSlug || !currentDiffVersion) {
        diffPre.innerHTML = '(full file diff unavailable)';
        return;
      }
      diffPre.innerHTML = '<span style="color:#888">Loading full file view…</span>';
      try {
        const url = `/generate/diffResume?jobDir=${encodeURIComponent(currentDiffSlug)}&version=v${currentDiffVersion}&format=word-diff`;
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (data.wordDiffHtml) {
          cachedWordDiffHtml = data.wordDiffHtml;
          switchToFullView(cachedWordDiffHtml);
        } else {
          diffPre.innerHTML = '(full file diff unavailable)';
        }
      } catch {
        diffPre.innerHTML = '(failed to load full file diff)';
      }
    });
  }
  changeBtn.addEventListener('click', () => {
    const slug = prompt('Enter job folder slug (the part after jobs/)', getJobSlug() || '');
    if (slug && slug.trim()) {
      globalThis.__resumeOpencode = globalThis.__resumeOpencode || {};
      globalThis.__resumeOpencode.lastJobDir = slug.trim();
      refreshSlug();
    }
  });

  async function waitForTask(taskId) {
    while (true) {
      const res = await fetch(`/generate/task/${taskId}`);
      const data = await res.json();
      if (data.status === 'complete') return data;
      if (data.status === 'error') {
        const err = new Error(data.error || 'Task failed');
        err.noOp = data.error === 'no-op';
        err.taskResult = data.result;
        throw err;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  function attachedFilePaths() {
    return Array.from(pills.querySelectorAll('.pill'))
      .map((p) => p.dataset.filePath || p.dataset.fileName)
      .filter(Boolean);
  }

  function showResult({ pdfUrl, sessionId, webLink: link, backupPath, backupVersion }) {
    pdfLink.href = pdfUrl;
    backupPathNode.innerHTML = '';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'button-link';
    trigger.textContent = `Compare with backup v${backupVersion}`;
    trigger.dataset.backupVersion = String(backupVersion);
    trigger.addEventListener('click', () => openDiffModal(backupVersion, trigger));
    backupPathNode.appendChild(trigger);
    if (backupPath) {
      const pathHint = document.createElement('span');
      pathHint.className = 'folder-path';
      pathHint.style.marginLeft = '8px';
      pathHint.textContent = `(${backupPath})`;
      backupPathNode.appendChild(pathHint);
    }
    if (sessionId) {
      sessionIdNode.textContent = sessionId;
      sessionBlock.classList.remove('hidden');
    } else {
      sessionBlock.classList.add('hidden');
    }
    if (link) {
      webLink.href = link;
      webLink.classList.remove('hidden');
    } else {
      webLink.classList.add('hidden');
    }
    resultNode.className = 'result';
  }

  function playSound(kind) {
    try {
      if (kind === 'success' && globalThis.playSuccessSound) globalThis.playSuccessSound();
      if (kind === 'failure' && globalThis.playFailureSound) globalThis.playFailureSound();
    } catch (e) { /* ignore */ }
  }

  function setApplyingUi(enabled) {
    applyBtn.disabled = !enabled;
    applyBtn.textContent = enabled ? 'Apply suggestions' : 'Applying…';
  }

  function validateClickInputs(slug, suggestions, attached) {
    if (!slug) return 'Generate a resume first so a job folder is available.';
    if (!suggestions) return 'Please enter at least one suggestion.';
    if (suggestions.length > MAX_SUGGESTIONS_LENGTH) {
      return `Suggestions too long (${suggestions.length} > ${MAX_SUGGESTIONS_LENGTH}).`;
    }
    if (!attached.length) return 'Attach at least one file.';
    return null;
  }

  async function postApplySuggestions(payload) {
    const res = await fetch('/generate/applySuggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Server error ${res.status}`);
    }
    return data;
  }

  function handleApplyError(err) {
    if (err && err.noOp) {
      const bp = err.taskResult && err.taskResult.backupPath;
      return {
        message: 'Model did not change the resume (no-op after retry). Your original files are untouched. Backup saved at ' + (bp || '(unknown)'),
        kind: 'error',
      };
    }
    return { message: 'Error: ' + fmtError(err), kind: 'error' };
  }

  function handleApplySuccess(task) {
    const r = task.result || {};
    showResult({
      pdfUrl: r.pdfUrl,
      sessionId: r.sessionId,
      webLink: r.webLink,
      backupPath: r.backupPath,
      backupVersion: r.backupVersion,
    });
    setStatus(statusNode, 'Done. The updated PDF is ready.', 'success');
    playSound('success');
  }

  applyBtn.addEventListener('click', async () => {
    const slug = getJobSlug();
    const suggestions = text.value.trim();
    const attached = attachedFilePaths();
    const validationError = validateClickInputs(slug, suggestions, attached);
    if (validationError) {
      setStatus(statusNode, validationError, 'error');
      return;
    }

    setApplyingUi(false);
    setStatus(statusNode, 'Backing up current resume and calling the model…');
    resultNode.className = 'result hidden';

    try {
      const { taskId } = await postApplySuggestions({
        jobDir: slug,
        userSuggestions: suggestions,
        attachedFilePaths: attached,
        modelSelect: getCurrentModel(),
      });
      setStatus(statusNode, 'Model is working on your suggestions…');
      const task = await waitForTask(taskId);
      handleApplySuccess(task);
    } catch (err) {
      const { message, kind } = handleApplyError(err);
      setStatus(statusNode, message, kind);
      playSound('failure');
    } finally {
      setApplyingUi(true);
    }
  });

  sessionCopyBtn.addEventListener('click', async () => {
    const value = sessionIdNode.textContent || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      const original = sessionCopyBtn.textContent;
      sessionCopyBtn.textContent = 'Copied!';
      setTimeout(() => { sessionCopyBtn.textContent = original; }, 1200);
    } catch (e) { console.error('clipboard write failed', e); }
  });

  refreshSlug();
  startSlugWatcher();
}

function bootstrap() {
  fetchSuggestionsTemplate()
    .then(initSuggestionsPanel)
    .catch((err) => {
      console.error('Failed to initialise suggestions panel:', err);
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
