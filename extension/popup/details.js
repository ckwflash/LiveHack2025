document.addEventListener('DOMContentLoaded', function () {
  const detailsTitleElement = document.getElementById('details-title');
  const detailsContentElement = document.getElementById('details-content');
  const backButton = document.getElementById('back-button');

  chrome.storage.local.get(['sustainabilityDetails'], function (result) {
    if (result.sustainabilityDetails && result.sustainabilityDetails.allFields) {
      // Get user weights from settings (default to 5 if missing)
      chrome.storage.sync.get(['settings'], (settingsData) => {
        const userWeights = settingsData.settings || {};        const fieldWeightMap = {
          production_and_brand: userWeights.production_and_brand || 5,
          circularity_and_end_of_life: userWeights.circularity_and_end_of_life || 5,
          material_composition: userWeights.material_composition || 5
        };
        let totalWeights = fieldWeightMap.production_and_brand + fieldWeightMap.circularity_and_end_of_life + fieldWeightMap.material_composition;
        const allFields = result.sustainabilityDetails.allFields;
        let html = '';        allFields.forEach(field => {
          // Display raw score from field.score, not weighted
          let displayScore = field.score;
          if (typeof displayScore === 'number' && displayScore > 10) displayScore = Math.round(displayScore / 10);
          let scoreText = (displayScore === undefined || displayScore === null) ? '--' : displayScore;
          html += `<div class="details-section">
            <h2>${field.title}</h2>
            <div><strong>Rating:</strong> ${field.value} (${scoreText}/10)</div>
            <div><strong>Details:</strong> <p>${field.analysis.replace(/\n/g, '<br>')}</p></div>
          </div><hr>`;
        });
        detailsContentElement.innerHTML = html;
        chrome.storage.local.remove(['sustainabilityDetails']);
      });
    } else {
      detailsContentElement.innerHTML = '<p>Could not load sustainability details. Please try again.</p>';
    }
  });

  backButton.addEventListener('click', function () {
    window.location.href = 'popup.html';
  });

  // Initialize theme
  chrome.storage.sync.get(['darkMode', 'settings'], (data) => {
    const isDarkMode = data.darkMode !== undefined ? data.darkMode : true;
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    
    const seniorEnabled = data.settings?.seniorMode === true;
    document.documentElement.setAttribute('data-senior', seniorEnabled ? 'true' : 'false');
  });
});
