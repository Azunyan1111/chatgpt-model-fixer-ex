(() => {
  const {
    effortKey,
    effortTarget,
    matchingModel,
    modeName,
    preferenceKey,
    preferencesForMode,
    preferencesUrl,
  } = globalThis.ChatGPTPreferences;
  const triggerSelector = 'button[data-codex-intelligence-trigger="true"]';
  const itemSelector = '[role="menuitemradio"]';
  const effortSelector = '[data-model-picker-power-slider] [role="slider"]';
  let savedModel;
  let savedEffort;
  let savedMode;
  let savedSettings = {};
  let previousTrigger;
  let previousUrl;
  let restoring = false;
  let switchingMode = false;

  const normalizedText = (element) => element?.textContent.trim();

  const modelName = (item) =>
    normalizedText(item.querySelector('[data-menu-row-content] span'));

  function modeButtons() {
    return Array.from(document.querySelectorAll('[role="group"]')).flatMap((group) => {
      const buttons = Array.from(group.querySelectorAll(':scope > button[aria-pressed]'));
      const modes = buttons.map(modeName);
      return modes.includes('chat') && modes.includes('codex') ? buttons : [];
    });
  }

  function selectedMode() {
    return modeName(modeButtons().find((button) => button.getAttribute('aria-pressed') === 'true'));
  }

  function loadPreferences(mode) {
    ({ savedEffort, savedModel } = preferencesForMode(savedSettings, mode));
  }

  function savePreference(mode, setting, value) {
    const key = preferenceKey(mode, setting);
    savedSettings[key] = value;
    chrome.storage.local.set({ [key]: value });
  }

  function syncUrl(reload = false) {
    const url = preferencesUrl(location.href, { savedModel, savedMode });
    if (url === location.href) return false;
    if (reload) location.replace(url);
    else history.replaceState(history.state, '', url);
    return true;
  }

  function modelMenu(trigger) {
    return document.getElementById(trigger.getAttribute('aria-controls'));
  }

  function waitFor(find, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => finish(null), timeoutMs);

      function finish(value) {
        observer.disconnect();
        clearTimeout(timeout);
        resolve(value);
      }

      function check() {
        const value = find();
        if (value) finish(value);
      }

      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      check();
    });
  }

  function openModelMenu(trigger) {
    if (trigger.getAttribute('aria-expanded') !== 'true') {
      trigger.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false,
      }));
    }
    return waitFor(() => modelMenu(trigger));
  }

  async function restoreMode() {
    if (!savedMode || selectedMode() === savedMode) return;
    const button = modeButtons().find((candidate) => modeName(candidate) === savedMode);
    if (!button) return;
    button.click();
    await waitFor(() => selectedMode() === savedMode);
  }

  async function restoreModel(menu) {
    if (!savedModel) return;
    const item = matchingModel(menu.querySelectorAll(itemSelector), savedModel, modelName);
    if (!item || item.getAttribute('aria-checked') === 'true') return;
    if (item.closest('[inert]')) {
      menu.querySelector('[data-model-picker-view-toggle]')?.click();
      if (!await waitFor(() => !item.closest('[inert]'))) return;
    }
    item.click();
    await waitFor(() => item.getAttribute('aria-checked') === 'true' || !item.isConnected);
  }

  async function restoreEffort(trigger) {
    if (!Number.isInteger(savedEffort)) return;
    const menu = await openModelMenu(trigger);
    const slider = menu && await waitFor(() => menu.querySelector(effortSelector));
    if (!menu || !slider) return;

    const minimum = Number(slider.getAttribute('aria-valuemin'));
    const maximum = Number(slider.getAttribute('aria-valuemax'));
    const target = effortTarget(savedEffort, minimum, maximum);

    for (let attempt = 0; attempt <= maximum - minimum; attempt += 1) {
      const current = Number(slider.getAttribute('aria-valuenow'));
      if (current === target) return;
      const key = effortKey(current, target);
      slider.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: key, bubbles: true, cancelable: true,
      }));
      if (!await waitFor(
        () => Number(slider.getAttribute('aria-valuenow')) !== current,
        1000,
      )) return;
    }
  }

  async function restoreSettings() {
    if (restoring) return;
    const initialTrigger = document.querySelector(triggerSelector);
    if (!initialTrigger) return;
    if (initialTrigger === previousTrigger && location.href === previousUrl) return;
    previousTrigger = initialTrigger;
    previousUrl = location.href;
    restoring = true;

    try {
      await restoreMode();
      const trigger = document.querySelector(triggerSelector);
      if (!trigger) return;
      const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
      const menu = await openModelMenu(trigger);
      if (!menu) return;
      await restoreModel(menu);
      await restoreEffort(document.querySelector(triggerSelector));
      if (!wasOpen) {
        modelMenu(document.querySelector(triggerSelector))?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', bubbles: true,
          }),
        );
      }
    } finally {
      restoring = false;
    }
  }

  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const item = event.target.closest(itemSelector);
    const trigger = document.querySelector(triggerSelector);

    if (item && trigger && modelMenu(trigger)?.contains(item)) {
      const name = modelName(item);
      requestAnimationFrame(() => {
        if (!name || item.getAttribute('aria-checked') !== 'true') return;
        savedModel = name;
        savePreference(selectedMode() || savedMode, 'model', savedModel);
        syncUrl();
      });
      return;
    }

    if (modeButtons().includes(event.target.closest('button'))) {
      switchingMode = true;
      requestAnimationFrame(() => {
        const mode = selectedMode();
        if (!mode) {
          switchingMode = false;
          return;
        }
        savedMode = mode;
        loadPreferences(savedMode);
        chrome.storage.local.set({ savedMode });
        syncUrl();
        switchingMode = false;
        previousTrigger = undefined;
        restoreSettings();
      });
    }
  }, true);

  const observer = new MutationObserver((mutations) => {
    if (!restoring) {
      const effortChanged = mutations.some((mutation) =>
        mutation.type === 'attributes' && mutation.target.matches?.(effortSelector));
      if (effortChanged) {
        const effort = Number(document.querySelector(effortSelector)?.getAttribute('aria-valuenow'));
        if (Number.isInteger(effort)) {
          savedEffort = effort;
          savePreference(selectedMode() || savedMode, 'effort', savedEffort);
        }
      }
    }
    if (!switchingMode) restoreSettings();
  });

  chrome.storage.local.get([
    'savedChatEffort',
    'savedChatModel',
    'savedCodexEffort',
    'savedCodexModel',
    'savedEffort',
    'savedMode',
    'savedModel',
  ]).then((settings) => {
    savedSettings = settings;
    savedMode = settings.savedMode;
    loadPreferences(savedMode);
    if (syncUrl(true)) return;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'aria-valuenow'],
    });
    restoreSettings();
  });
})();
