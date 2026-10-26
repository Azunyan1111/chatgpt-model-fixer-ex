(() => {
  const {
    effortKey,
    effortTarget,
    matchingModel,
    modeName,
    preferenceKey,
    preferencesForMode,
    renderedElement,
  } = globalThis.ChatGPTPreferences;
  const triggerSelector = 'button[data-codex-intelligence-trigger="true"]';
  const itemSelector = '[role="menuitemradio"]';
  const effortSelector = '[data-model-picker-power-slider] [role="slider"]';
  const triggerSettleMs = 500;
  const triggerSeenAt = new WeakMap();
  let deferredRestore;
  let savedModel;
  let savedEffort;
  let savedMode;
  let savedSettings = {};
  let previousTrigger;
  let previousUrl;
  let restoring = false;
  let interrupted = false;
  let selectingModel = false;
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

  const currentTrigger = () => renderedElement(document.querySelectorAll(triggerSelector));

  function modelMenu(trigger) {
    const id = trigger?.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  function openedModelMenu() {
    const trigger = currentTrigger();
    return trigger?.getAttribute('aria-expanded') === 'true' ? modelMenu(trigger) : null;
  }

  function hasSavedSettings() {
    return Boolean(savedMode || savedModel || Number.isInteger(savedEffort));
  }

  // In Codex mode ChatGPT first renders a short-lived picker that still lists the Chat models,
  // then replaces it, so only a trigger that has stayed in place for a while is restored.
  function triggerIsSettling(trigger) {
    if (!triggerSeenAt.has(trigger)) triggerSeenAt.set(trigger, performance.now());
    return performance.now() - triggerSeenAt.get(trigger) < triggerSettleMs;
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

  // ChatGPT ignores events dispatched before hydration, so repeat the action until it takes effect.
  async function retry(action, find, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (!interrupted && Date.now() < deadline) {
      const found = find();
      if (found) return found;
      action();
      const value = await waitFor(find, 250);
      if (value) return value;
    }
    return null;
  }

  function pressTrigger() {
    const trigger = currentTrigger();
    if (trigger && trigger.getAttribute('aria-expanded') !== 'true') {
      trigger.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false,
      }));
    }
  }

  const openModelMenu = () => retry(pressTrigger, openedModelMenu);

  // ChatGPT may re-render or close the menu while it settles, so never keep a stale slider.
  const effortSlider = () => openedModelMenu()?.querySelector(effortSelector);

  // The mode is restored by pressing the Chat/Codex switch instead of reloading the page with
  // a surface parameter in the URL. Returns whether the switch was pressed.
  async function restoreMode() {
    if (!savedMode || selectedMode() === savedMode) return false;
    const button = () => modeButtons().find((candidate) => modeName(candidate) === savedMode);
    if (!button()) return false;
    return Boolean(await retry(() => button()?.click(), () => selectedMode() === savedMode));
  }

  async function restoreModel() {
    if (!savedModel) return;
    const menu = await openModelMenu();
    const item = menu && matchingModel(menu.querySelectorAll(itemSelector), savedModel, modelName);
    if (!item || item.getAttribute('aria-checked') === 'true') return;
    if (item.closest('[inert]')) {
      menu.querySelector('[data-model-picker-view-toggle]')?.click();
      if (!await waitFor(() => !item.closest('[inert]')) || interrupted) return;
    }
    item.click();
    await waitFor(() => item.getAttribute('aria-checked') === 'true' || !item.isConnected);
  }

  async function restoreEffort() {
    if (!Number.isInteger(savedEffort)) return;
    let slider = await retry(pressTrigger, effortSlider);
    if (!slider) return;

    const minimum = Number(slider.getAttribute('aria-valuemin'));
    const maximum = Number(slider.getAttribute('aria-valuemax'));
    const target = effortTarget(savedEffort, minimum, maximum);

    for (let attempt = 0; attempt <= maximum - minimum; attempt += 1) {
      const current = Number(slider.getAttribute('aria-valuenow'));
      if (current === target || interrupted) return;
      const key = effortKey(current, target);
      slider.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: key, bubbles: true, cancelable: true,
      }));
      slider = await retry(pressTrigger, () => {
        const candidate = effortSlider();
        return Number(candidate?.getAttribute('aria-valuenow')) !== current && candidate;
      }, 1000);
      if (!slider) return;
    }
  }

  async function restoreSettings() {
    if (restoring) return;
    const initialTrigger = currentTrigger();
    if (!initialTrigger) return;
    if (initialTrigger === previousTrigger && location.href === previousUrl) return;
    if (hasSavedSettings() && (triggerIsSettling(initialTrigger) || openedModelMenu())) {
      // Retry once the trigger has settled and the user has closed the menu.
      clearTimeout(deferredRestore);
      deferredRestore = setTimeout(restoreSettings, 250);
      return;
    }
    previousTrigger = initialTrigger;
    previousUrl = location.href;
    if (!hasSavedSettings()) return;
    restoring = true;
    interrupted = false;
    let modeChanged = false;

    try {
      modeChanged = await restoreMode();
      if (modeChanged) return;
      if (!await openModelMenu()) return;
      await restoreModel();
      await restoreEffort();
      if (!interrupted) {
        openedModelMenu()?.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', bubbles: true,
        }));
      }
    } finally {
      restoring = false;
      if (modeChanged) {
        // Switching the mode re-renders the picker, so the model and effort are restored
        // once the new picker has settled, exactly as after a mode switch by the user.
        previousTrigger = undefined;
        restoreSettings();
      } else if (!interrupted) {
        // Restoring can re-render the trigger; that must not start another restore.
        previousTrigger = currentTrigger();
      }
    }
  }

  // Lets the live test wait, from this isolated world, until restoring has finished.
  globalThis.ChatGPTModelFixer = {
    isSettled: () => !restoring && !selectingModel && !switchingMode
      && Boolean(currentTrigger())
      && currentTrigger() === previousTrigger
      && location.href === previousUrl,
  };

  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const item = event.target.closest(itemSelector);
    const trigger = currentTrigger();

    if (item && trigger && modelMenu(trigger)?.contains(item)) {
      selectingModel = true;
      const name = modelName(item);
      requestAnimationFrame(() => {
        if (name && item.getAttribute('aria-checked') === 'true') {
          savedModel = name;
          savePreference(selectedMode() || savedMode, 'model', savedModel);
        }
        requestAnimationFrame(() => {
          selectingModel = false;
          previousTrigger = currentTrigger();
          previousUrl = location.href;
        });
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
        switchingMode = false;
        previousTrigger = undefined;
        restoreSettings();
      });
    }
  }, true);

  // A user who starts using the picker while settings are being restored takes over.
  document.addEventListener('pointerdown', (event) => {
    if (!restoring || !event.isTrusted) return;
    const { target } = event;
    if (currentTrigger()?.contains(target) || openedModelMenu()?.contains(target)
      || modeButtons().some((button) => button.contains(target))) {
      interrupted = true;
    }
  }, true);

  const observer = new MutationObserver((mutations) => {
    if (!restoring || interrupted) {
      // A slider that has just been rendered reports no previous value; only user changes count.
      const effortChanged = [...mutations].reverse().find((mutation) =>
        mutation.type === 'attributes'
        && mutation.target.matches?.(effortSelector)
        && mutation.oldValue !== null
        && mutation.oldValue !== mutation.target.getAttribute('aria-valuenow')
        && !mutation.target.closest('[inert]'));
      if (effortChanged) {
        const effort = Number(effortChanged.target.getAttribute('aria-valuenow'));
        if (Number.isInteger(effort)) {
          savedEffort = effort;
          savePreference(selectedMode() || savedMode, 'effort', savedEffort);
        }
      }
    }
    if (!selectingModel && !switchingMode) restoreSettings();
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
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'aria-valuenow'],
      attributeOldValue: true,
    });
    restoreSettings();
  });
})();
