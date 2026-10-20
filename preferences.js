((root) => {
  const normalizedText = (element) => element?.textContent.trim();

  function modeName(button) {
    const name = normalizedText(button)?.toLowerCase();
    if (name === 'chat') return 'chat';
    if (name === 'work' || name === 'codex') return 'codex';
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

  function preferenceKey(mode, setting) {
    const modeName = mode === 'codex' ? 'Codex' : 'Chat';
    const settingName = setting === 'effort' ? 'Effort' : 'Model';
    return `saved${modeName}${settingName}`;
  }

  function preferencesForMode(settings, mode) {
    return {
      savedEffort: settings[preferenceKey(mode, 'effort')] ?? settings.savedEffort,
      savedModel: settings[preferenceKey(mode, 'model')] ?? settings.savedModel,
    };
  }

  // ChatGPT does not recognise model slugs derived from display names and resets the model
  // to its default when it reads one, so only the mode is carried in the URL.
  function preferencesUrl(href, { savedMode }) {
    const url = new URL(href);
    if (url.pathname !== '/') return href;

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
    preferenceKey,
    preferencesForMode,
    preferencesUrl,
  };
  root.ChatGPTPreferences = preferences;

  if (typeof module === 'object' && module.exports) {
    module.exports = preferences;
  }
})(globalThis);
