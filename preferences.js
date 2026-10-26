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

  // ChatGPT keeps the picker button of the previous composer in the DOM, no longer rendered,
  // while it navigates between a conversation and a new chat; only a rendered one is in use.
  function renderedElement(elements) {
    return Array.from(elements).find((element) => element.getClientRects().length > 0) ?? null;
  }

  function preferencesForMode(settings, mode) {
    return {
      savedEffort: settings[preferenceKey(mode, 'effort')] ?? settings.savedEffort,
      savedModel: settings[preferenceKey(mode, 'model')] ?? settings.savedModel,
    };
  }

  const preferences = {
    effortKey,
    effortTarget,
    matchingModel,
    modeName,
    preferenceKey,
    preferencesForMode,
    renderedElement,
  };
  root.ChatGPTPreferences = preferences;

  if (typeof module === 'object' && module.exports) {
    module.exports = preferences;
  }
})(globalThis);
