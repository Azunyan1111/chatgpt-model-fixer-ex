((root) => {
  const normalizedText = (element) => element?.textContent.trim();

  function modeName(button) {
    const name = normalizedText(button)?.toLowerCase();
    if (name === 'chat') return 'chat';
    if (name === 'work' || name === 'codex') return 'codex';
  }

  function modelSlug(name) {
    if (!name || /^(default|デフォルト)$/i.test(name)) return null;
    return name.toLowerCase().replace(/\s+/g, '-');
  }

  function effortTarget(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function effortKey(current, target) {
    if (current === target) return null;
    return current < target ? 'ArrowRight' : 'ArrowLeft';
  }

  function matchingModel(items, target, nameOf = (item) => item) {
    return Array.from(items).find((item) => nameOf(item) === target);
  }

  function preferencesUrl(href, { savedModel, savedMode }) {
    const url = new URL(href);
    if (url.pathname !== '/') return href;

    const slug = modelSlug(savedModel);
    if (slug) url.searchParams.set('model', slug);
    else if (savedModel) url.searchParams.delete('model');

    if (savedMode === 'codex') url.searchParams.set('surface', 'work');
    else if (savedMode === 'chat' && url.searchParams.get('surface') === 'work') {
      url.searchParams.delete('surface');
    }

    return url.href;
  }

  const preferences = {
    effortKey,
    effortTarget,
    matchingModel,
    modeName,
    modelSlug,
    preferencesUrl,
  };
  root.ChatGPTPreferences = preferences;

  if (typeof module === 'object' && module.exports) {
    module.exports = preferences;
  }
})(globalThis);
