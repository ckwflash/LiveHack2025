// EcoShop Options Script
document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const productionAndBrandWeightInput = document.getElementById('production-and-brand-weight');
  const materialCompositionWeightInput = document.getElementById('material-composition-weight');
  const circularityAndEndOfLifeWeightInput = document.getElementById('circularity-and-end-of-life-weight');

  const productionAndBrandWeightValue = document.getElementById('production-and-brand-weight-value');
  const materialCompositionWeightValue = document.getElementById('material-composition-weight-value');
  const circularityAndEndOfLifeWeightValue = document.getElementById('circularity-and-end-of-life-weight-value');
  const showBadgeCheckbox = document.getElementById('show-badge');
  const showAlternativesCheckbox = document.getElementById('show-alternatives');
  const badgePositionSelect = document.getElementById('badge-position');
  const darkModeCheckbox = document.getElementById('dark-mode');

  const restoreDefaultsButton = document.getElementById('restore-defaults');
  const saveSettingsButton = document.getElementById('save-settings');
  const statusMessage = document.getElementById('status-message');  // Default settings
  const defaultSettings = {
    carbonWeight: 3,
    waterWeight: 3,
    wasteWeight: 3,
    laborWeight: 3,
    showBadge: true,
    seniorMode: false,
    showAlternatives: true,
    badgePosition: 'bottom-right',
    darkMode: true
  };

  // Initialize theme from storage
  initTheme();

  // Load settings when the page loads
  loadSettings();

  // Initialize theme from saved preference
  async function initTheme() {
    try {
      const result = await chrome.storage.sync.get({ 'darkMode': true });
      setTheme(result.darkMode);
    } catch (error) {
      console.error("Error loading theme preference:", error);
      // Default to dark mode
      setTheme(true);
    }
  }

  // Set theme on page
  function setTheme(isDarkMode) {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }

  function applySeniorMode(enabled) {
    document.documentElement.setAttribute('data-senior', enabled ? 'true' : 'false');
  }


  // Update display when sliders change
  productionAndBrandWeightInput.addEventListener('input', () => {
    productionAndBrandWeightValue.textContent = productionAndBrandWeightInput.value;
  });
  materialCompositionWeightInput.addEventListener('input', () => {
    materialCompositionWeightValue.textContent = materialCompositionWeightInput.value;
  });
  circularityAndEndOfLifeWeightInput.addEventListener('input', () => {
    circularityAndEndOfLifeWeightValue.textContent = circularityAndEndOfLifeWeightInput.value;
  });

  // Save settings when the save button is clicked
  saveSettingsButton.addEventListener('click', saveSettings);

  // Restore defaults when the restore button is clicked
  restoreDefaultsButton.addEventListener('click', restoreDefaults);

  // Toggle dark mode preview
  darkModeCheckbox.addEventListener('change', () => {
    const isDarkMode = darkModeCheckbox.checked;
    setTheme(isDarkMode);
    chrome.storage.sync.set({ 'darkMode': isDarkMode });
  });

  // Save all current settings to storage
  function saveSettings() {
    const settings = {
      production_and_brand: parseInt(productionAndBrandWeightInput.value),
      material_composition: parseInt(materialCompositionWeightInput.value),
      circularity_and_end_of_life: parseInt(circularityAndEndOfLifeWeightInput.value),
      showBadge: showBadgeCheckbox.checked,
      showAlternatives: showAlternativesCheckbox.checked,
      badgePosition: badgePositionSelect.value,
      darkMode: darkModeCheckbox.checked,
      seniorMode: document.getElementById('senior-mode').checked
    };

    // Save both 'settings' object and the separate 'darkMode' setting for easier access
    chrome.storage.sync.set({ 
      settings: settings,
      darkMode: settings.darkMode
    }, () => {
      showStatus('Settings saved successfully!', 'success');
      applySeniorMode(settings.seniorMode);
      // Notify the service worker that settings have changed
      chrome.runtime.sendMessage({ 
        action: "settingsUpdated", 
        settings: settings 
      });
      // Force all open popups to refresh their scoring
      chrome.tabs.query({}, function(tabs) {
        tabs.forEach(tab => {
          // Fade out the badge first
          chrome.tabs.sendMessage(tab.id, { action: "fadeEcoShopBadge" });
        });
        setTimeout(() => {
          tabs.forEach(tab => {
            // Recalculate and redisplay the badge and browser action badge
            chrome.tabs.sendMessage(tab.id, { action: "refreshEcoShopPopup" });
            chrome.runtime.sendMessage({ action: "refreshEcoShopBadge", tabId: tab.id });
          });
        }, 500); // Wait for fade out animation (0.5s)
      });
    });
  }

  // Load saved settings from storage
  function loadSettings() {
    chrome.storage.sync.get(['settings', 'darkMode'], (data) => {
      const settings = data.settings || defaultSettings;

      // If darkMode is set separately (from popup or content script), use that value
      const darkMode = data.darkMode !== undefined ? data.darkMode : settings.darkMode;

      // Apply loaded settings to UI
      productionAndBrandWeightInput.value = settings.production_and_brand || 3;
      productionAndBrandWeightValue.textContent = settings.production_and_brand || 3;

      materialCompositionWeightInput.value = settings.material_composition || 3;
      materialCompositionWeightValue.textContent = settings.material_composition || 3;

      circularityAndEndOfLifeWeightInput.value = settings.circularity_and_end_of_life || 3;
      circularityAndEndOfLifeWeightValue.textContent = settings.circularity_and_end_of_life || 3;      showBadgeCheckbox.checked = settings.showBadge;
      showAlternativesCheckbox.checked = settings.showAlternatives;
      badgePositionSelect.value = settings.badgePosition;
      darkModeCheckbox.checked = darkMode;
      document.getElementById('senior-mode').checked = settings.seniorMode;
      applySeniorMode(settings.seniorMode);

      // Apply dark mode if enabled
      setTheme(darkMode);
    });
  }

  // Restore default settings
  function restoreDefaults() {
    // Apply default settings to UI
    productionAndBrandWeightInput.value = defaultSettings.production_and_brand || 3;
    productionAndBrandWeightValue.textContent = defaultSettings.production_and_brand || 3;

    materialCompositionWeightInput.value = defaultSettings.material_composition || 3;
    materialCompositionWeightValue.textContent = defaultSettings.material_composition || 3;

    circularityAndEndOfLifeWeightInput.value = defaultSettings.circularity_and_end_of_life || 3;
    circularityAndEndOfLifeWeightValue.textContent = defaultSettings.circularity_and_end_of_life || 3;    showBadgeCheckbox.checked = defaultSettings.showBadge;
    showAlternativesCheckbox.checked = defaultSettings.showAlternatives;
    badgePositionSelect.value = defaultSettings.badgePosition;
    darkModeCheckbox.checked = defaultSettings.darkMode;

    applySeniorMode(defaultSettings.seniorMode);

    setTheme(defaultSettings.darkMode);

    showStatus('Default settings restored. Click Save to apply.', 'success');
  }
  // Display status message with improved fading
  function showStatus(message, type) {
    // Clear any existing timeout
    if (window.statusTimeout) {
      clearTimeout(window.statusTimeout);
    }
    
    // Reset message state
    statusMessage.textContent = message;
    statusMessage.className = 'status-message';
    
    // Force reflow to ensure the reset is applied
    statusMessage.offsetHeight;
    
    // Apply the success/error class to trigger the fade-in
    setTimeout(() => {
      statusMessage.className = 'status-message ' + type;
    }, 50);

    // Set timeout to fade out after 3 seconds
    window.statusTimeout = setTimeout(() => {
      statusMessage.className = 'status-message';
    }, 3000);
  }
});