// This function is serialized by chrome.scripting.executeScript into the isolated world.
// Keep its helpers inside the function so they are available after serialization.
async function semanticPageOperation(request) {
  const stateKey = '__cdpBridgeSemanticStateV1';
  const lifetimeMs = 60000;
  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const roleOf = el => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'textarea' || el.isContentEditable) return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (['checkbox', 'radio'].includes(type)) return type;
      if (type === 'search') return 'searchbox';
      if (type === 'number') return 'spinbutton';
      return 'textbox';
    }
    return tag;
  };
  const nameOf = el => {
    const root = el.getRootNode();
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const labelled = labelledBy.map(id => root.getElementById?.(id)?.textContent || '').join(' ');
    if (normalize(labelled)) return normalize(labelled);
    if (normalize(el.getAttribute('aria-label'))) return normalize(el.getAttribute('aria-label'));
    if (el.labels?.length) return normalize([...el.labels].map(label => label.textContent).join(' '));
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type) && el.value) {
      return normalize(el.value);
    }
    return normalize(el.innerText || el.textContent || el.getAttribute('placeholder') ||
      el.getAttribute('title') || el.getAttribute('name') || '');
  };
  const visible = el => {
    if (!el.isConnected || el.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const describe = (el, ref) => {
    const rect = el.getBoundingClientRect();
    const description = {
      ref,
      role: roleOf(el),
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      in_viewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
    if (el.tagName === 'INPUT') {
      description.type = el.type || 'text';
      if (['checkbox', 'radio'].includes(el.type)) description.checked = el.checked;
      else if (el.type === 'password') description.has_value = Boolean(el.value);
      else description.value = String(el.value || '').slice(0, 160);
    } else if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      description.value = String(el.value || '').slice(0, 160);
    }
    return description;
  };
  const signatureOf = el => [
    roleOf(el), nameOf(el), el.tagName, el.getAttribute('type') || '',
    el.getAttribute('href') || '', el.closest('form')?.getAttribute('action') || ''
  ].join('|');
  const candidates = () => {
    const selector = 'button, a[href], input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
    const found = [];
    const visit = root => {
      for (const el of root.querySelectorAll(selector)) if (visible(el)) found.push(el);
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(document);
    return found;
  };
  const textLines = () => [...new Set((document.body?.innerText || '').slice(0, 20000)
    .split(/\n+/).map(normalize).filter(Boolean))];
  const summary = () => ({ url: location.href, title: document.title, lines: textLines() });
  const diff = (before, after) => {
    const beforeLines = new Set(before.lines);
    const afterLines = new Set(after.lines);
    return {
      url_changed: before.url !== after.url,
      title_changed: before.title !== after.title,
      added_text: after.lines.filter(line => !beforeLines.has(line)).slice(0, 10),
      removed_text: before.lines.filter(line => !afterLines.has(line)).slice(0, 10)
    };
  };

  if (request.method === 'summary') return { status: 'success', ...summary() };

  if (request.method === 'observe') {
    const limit = Math.max(1, Math.min(Number(request.limit) || 80, 150));
    const all = candidates();
    const refs = new Map();
    const controls = all.slice(0, limit).map((el, index) => {
      const ref = `e${index + 1}`;
      const control = describe(el, ref);
      refs.set(ref, { el, signature: signatureOf(el) });
      return control;
    });
    const randomBytes = crypto.getRandomValues(new Uint8Array(16));
    const pageRevision = [...randomBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    globalThis[stateKey] = { pageRevision, url: location.href, expiresAt: Date.now() + lifetimeMs, refs };
    return {
      status: 'success', page_revision: pageRevision, expires_in_ms: lifetimeMs,
      url: location.href, title: document.title, controls, total_controls: all.length,
      truncated: all.length > controls.length
    };
  }

  if (request.method !== 'act') return { status: 'error', error: 'Unknown semantic operation' };
  const state = globalThis[stateKey];
  if (!state || request.page_revision !== state.pageRevision ||
      location.href !== state.url || Date.now() > state.expiresAt) {
    return { status: 'stale', error: 'Observation expired or page changed. Call browser_observe again.' };
  }
  const target = state.refs.get(request.ref);
  if (!target || !visible(target.el) || signatureOf(target.el) !== target.signature) {
    return { status: 'stale', error: 'Target changed or disappeared. Call browser_observe again.' };
  }
  const el = target.el;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
    return { status: 'error', error: 'Target is disabled.' };
  }
  if (!['click', 'fill'].includes(request.action)) {
    return { status: 'error', error: 'action must be click or fill.' };
  }
  if (request.action === 'fill') {
    const textInput = el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'hidden'].includes(el.type);
    if (!textInput && !(el instanceof HTMLTextAreaElement) && !el.isContentEditable) {
      return { status: 'error', error: 'Target cannot be filled.' };
    }
  }

  const before = summary();
  const targetBefore = describe(el, request.ref);
  delete globalThis[stateKey]; // References are single use, including after a failed page action.
  try {
    if (request.action === 'click') {
      el.click();
    } else {
      const value = String(request.value ?? '');
      if (el.isContentEditable) {
        el.textContent = value;
      } else {
        const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // A click can navigate immediately; waiting in the page would lose the result.
    if (request.action === 'fill') await new Promise(resolve => setTimeout(resolve, 80));
    const after = summary();
    return {
      status: 'success', action: request.action, target_before: targetBefore,
      target_after: el.isConnected ? describe(el, request.ref) : null,
      diff: diff(before, after), requires_observe: true, _before_summary: before
    };
  } catch (error) {
    return { status: 'error', error: error.message || String(error), requires_observe: true };
  }
}
