// public/suggestions.js
// Apply-suggestions panel for the resume generator.
// One ES module: injects the panel below the existing buttons in the form,
// wires the file-pill UX, the free-text suggestions, and the
// POST /generate/applySuggestions + /generate/task/:taskId poll loop.

const DEFAULT_AUTO_ATTACH = ['ats-analysis.md', 'job-description.txt', 'other-input.txt'];
const RESUME_JSON_NAME = 'structured-output.json';
const POLL_INTERVAL_MS = 5000;
const MAX_SUGGESTIONS_LENGTH = 4000;

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
      if (!tpl || !popover) throw new Error('suggestions.html is missing expected nodes');
      return { tplContent: tpl.content.cloneNode(true), popover: popover.cloneNode(true) };
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

function getJobsPath() {
  const w = globalThis.__resumeOpencode;
  return w && w.jobsPath ? w.jobsPath : '';
}

function getCurrentModel() {
  const sel = el('model-select');
  return sel ? sel.value : undefined;
}

function createPill(name, removable) {
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.dataset.fileName = name;
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

function initSuggestionsPanel({ tplContent, popover }) {
  const form = el('resume-form');
  if (!form) throw new Error('resume-form not found; suggestions panel needs the form');
  const section = tplContent.querySelector('#suggestions-section');
  form.appendChild(section);
  document.body.appendChild(popover);

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

  function refreshSlug() {
    const slug = getJobSlug();
    if (slug) {
      slugNode.textContent = slug;
      section.classList.remove('hidden');
      autoAttachDefaults();
    } else {
      slugNode.textContent = '(none — generate a resume first)';
      section.classList.add('hidden');
    }
  }

  function autoAttachDefaults() {
    for (const name of DEFAULT_AUTO_ATTACH) {
      if (pills.querySelector(`.pill[data-file-name="${CSS.escape(name)}"]`)) continue;
      pills.appendChild(createPill(name, true));
    }
    if (!pills.querySelector(`.pill[data-file-name="${CSS.escape(RESUME_JSON_NAME)}"]`)) {
      const p = createPill(RESUME_JSON_NAME, false);
      p.title = 'Sent as a file path so the model can read the original resume JSON';
      pills.appendChild(p);
    }
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
        pills.appendChild(createPill(f.name, true));
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
      alert('Generate a resume first so a job folder is available.');
      return;
    }
    popoverRoot.classList.remove('hidden');
    popoverSearch.value = '';
    fetchFolderFiles()
      .then((items) => renderPopoverList(items, ''))
      .catch((err) => renderPopoverList([], ''));
    setTimeout(() => popoverSearch.focus(), 0);
  }

  function closeFilePopover() {
    popoverRoot.classList.add('hidden');
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

  function attachedFileNames() {
    return Array.from(pills.querySelectorAll('.pill')).map((p) => p.dataset.fileName);
  }

  function showResult({ pdfUrl, sessionId, webLink: link, backupPath }) {
    pdfLink.href = pdfUrl;
    backupPathNode.textContent = `Backup: ${backupPath}`;
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

  applyBtn.addEventListener('click', async () => {
    const slug = getJobSlug();
    if (!slug) {
      alert('Generate a resume first so a job folder is available.');
      return;
    }
    const suggestions = text.value.trim();
    if (!suggestions) {
      setStatus(statusNode, 'Please enter at least one suggestion.', 'error');
      return;
    }
    if (suggestions.length > MAX_SUGGESTIONS_LENGTH) {
      setStatus(statusNode, `Suggestions too long (${suggestions.length} > ${MAX_SUGGESTIONS_LENGTH}).`, 'error');
      return;
    }
    const attached = attachedFileNames();
    if (!attached.length) {
      setStatus(statusNode, 'Attach at least one file.', 'error');
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';
    setStatus(statusNode, 'Backing up current resume and calling the model…');
    resultNode.className = 'result hidden';

    try {
      const res = await fetch('/generate/applySuggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDir: slug,
          userSuggestions: suggestions,
          attachedFilePaths: attached,
          modelSelect: getCurrentModel(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }
      setStatus(statusNode, 'Model is working on your suggestions…');
      const task = await waitForTask(data.taskId);
      const r = task.result || {};
      showResult({
        pdfUrl: r.pdfUrl,
        sessionId: r.sessionId,
        webLink: r.webLink,
        backupPath: r.backupPath,
      });
      setStatus(statusNode, 'Done. The updated PDF is ready.', 'success');
      playSound('success');
    } catch (err) {
      if (err && err.noOp) {
        const bp = err.taskResult && err.taskResult.backupPath;
        setStatus(
          statusNode,
          'Model did not change the resume (no-op after retry). Your original files are untouched. Backup saved at ' + (bp || '(unknown)'),
          'error'
        );
      } else {
        setStatus(statusNode, 'Error: ' + fmtError(err), 'error');
      }
      playSound('failure');
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply suggestions';
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
