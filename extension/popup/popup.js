// EcoShop Popup Script
document.addEventListener('DOMContentLoaded', function() {
  // Elements
  chrome.storage.sync.get(['settings'], (data) => {
    const seniorEnabled = data.settings?.seniorMode === true;
    document.documentElement.setAttribute('data-senior', seniorEnabled ? 'true' : 'false');
    console.log('✅ Applied senior mode:', seniorEnabled);
    console.log('🔎 Final attribute:', document.documentElement.getAttribute('data-senior'));
  });
  const loadingElement = document.getElementById('loading');
  const loadingMessageElement = document.getElementById('loading-message');
  const noProductElement = document.getElementById('no-product');
  const productInfoElement = document.getElementById('product-info');
  const brandNameElement = document.getElementById('brand-name');  const scoreValueElement = document.getElementById('score-value');
  const sustainabilityMetricsContainer = document.getElementById('sustainability-metrics-container'); // New container
  const alternativesListElement = document.getElementById('alternatives-list');
  const optionsButton = document.getElementById('options-button');
  const learnMoreButton = document.getElementById('learn-more');
  const websiteBadge = document.getElementById('website-badge');

  // Initialize dark mode from storage
  initTheme();
  
  // Initialize theme from saved preference
  async function initTheme() {
    try {
      const result = await chrome.storage.sync.get({ 'darkMode': true });
      setTheme(result.darkMode);
    } catch (error) {
      console.error("Error loading theme preference:", error);
      setTheme(true); // Default to dark mode
    }
  }

  function setTheme(isDarkMode) {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }  // Show loading state initially - always fetch fresh data
  showLoadingState();
  
  // Start progressive loading messages after a short delay
  setTimeout(() => {
    showProgressiveLoading();
  }, 1000);
  
  chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
    if (tabs.length === 0) {
      showNoProductMessage();
      return;
    }
    const currentTab = tabs[0];
    const url = new URL(currentTab.url);
    websiteBadge.textContent = url.hostname;
    const isShopee = currentTab.url.includes('shopee.sg') || currentTab.url.includes('shopee.com');
    
    if (!isShopee) {
      showNoProductMessage("Visit Shopee to see sustainability ratings");
      return;
    }
    
    // ALWAYS fetch fresh data from database - no caching
    console.log("popup.js: Always fetching data from database for URL:", currentTab.url);
    
    chrome.tabs.sendMessage(currentTab.id, { action: "getProductInfo" }, function(response) {
      if (chrome.runtime.lastError || !response) {
        chrome.runtime.sendMessage({ 
          action: "checkCurrentPage", 
          url: currentTab.url,
          title: currentTab.title
        }, (backendResponse) => {
          handleSustainabilityData(backendResponse);
        });
        return;
      }
      if (response.productInfo) {
        chrome.runtime.sendMessage({
          action: "checkSustainability",
          productInfo: response.productInfo
        }, (backendResponse) => {
          handleSustainabilityData(backendResponse);
        });
      } else {
        showNoProductMessage("Couldn't identify product information");
      }
    });
  });

  // Listen for refresh message to re-apply weights and update scoring
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'refreshEcoShopPopup') {
      // Always reload the popup to fetch latest settings and recalculate
      window.location.reload();
    }
  });  // Handle fresh sustainability data from database - ALWAYS fresh, never cached
  function handleSustainabilityData(response) {
    console.log("=== POPUP.JS: FRESH DATA FROM DATABASE ===");
    console.log("Full response object:", JSON.stringify(response, null, 2));
    
    // Clear the progressive loading interval
    if (window.ecoshopLoadingInterval) {
      clearInterval(window.ecoshopLoadingInterval);
      window.ecoshopLoadingInterval = null;
    }
    
    // Hide loading state
    loadingElement.classList.add('hidden');
    
    if (!response || !response.success) {
      console.error("popup.js: Database response unsuccessful or missing.", response);
      if (response && response.error) {
        if (response.error.includes("Database connection") || response.error.includes("Backend service unavailable")) {
          showNoProductMessage("Database connection required. Please check your internet connection and ensure the backend service is running.");
        } else {
          showNoProductMessage(response.message || response.error);
        }
      } else {
        showNoProductMessage("No fresh sustainability data available from database");
      }
      return;
    }

    const data = response.data;
    console.log("popup.js: Fresh data object from database:", data);
    console.log("popup.js: Fresh backend score value:", data.score);
    console.log("popup.js: Fresh backend score type:", typeof data.score);    // Show product info section
    productInfoElement.classList.remove('hidden');
    
    // Calculate weighted score using the same algorithm as the badge
    const breakdown = data.sustainability_breakdown || data.breakdown;
    let displayScore = undefined;
    
    if (breakdown) {
      // Get user weights from settings (async operation)
      chrome.storage.sync.get(['settings'], (result) => {
        const settingsData = result.settings || {};
        const fieldWeightMap = {
          production_and_brand: settingsData.production_and_brand || 5,
          circularity_and_end_of_life: settingsData.circularity_and_end_of_life || 5,
          material_composition: settingsData.material_composition || 5
        };
        const fieldOrder = [
          'production_and_brand',
          'circularity_and_end_of_life',
          'material_composition'
        ];
        
        let weightedSum = 0;
        let totalWeight = 0;
        
        // Calculate total weight first
        fieldOrder.forEach(key => {
          totalWeight += fieldWeightMap[key] || 5;
        });
        
        // Calculate weighted sum
        fieldOrder.forEach(key => {
          const metricData = breakdown[key] || {};
          let fieldScore = typeof metricData.score === 'number' ? metricData.score : undefined;
          let summaryScore = (typeof fieldScore === 'number') ? fieldScore * fieldWeightMap[key] / totalWeight : 0;
          weightedSum += summaryScore;        });
        
        // Handle case where all fields are 0 (should display as 0, not undefined)
        displayScore = weightedSum >= 0 ? Math.round(weightedSum * 10) : undefined;
        
        console.log("popup.js: Calculated weighted score:", displayScore);
        console.log("popup.js: Weighted sum:", weightedSum);
        console.log("popup.js: Field weights:", fieldWeightMap);
        
        // Update the display with calculated score
        updateScoreDisplay(displayScore);
      });
    } else {
      console.warn("popup.js: No breakdown data available for score calculation");
      showNoProductMessage("Score calculation failed - no breakdown data available");
      return;
    }
    
    function updateScoreDisplay(calculatedScore) {
      // Allow 0 as a valid score (when all fields are 0)
      if (typeof calculatedScore !== 'number' || isNaN(calculatedScore) || calculatedScore < 0) {
        console.warn("popup.js: Calculated score not valid:", calculatedScore);
        showNoProductMessage("Score calculation failed. Please try again.");
        return;
      }
      
      // Update the main score display
      const scoreColor = getScoreColor(calculatedScore);
      scoreValueElement.style.color = '#FFF';
      scoreValueElement.parentElement.style.backgroundColor = scoreColor;
      brandNameElement.textContent = data.brand_name || data.brand || "Unknown Brand";
      scoreValueElement.textContent = calculatedScore;

      console.log("popup.js: Updated main score display with calculated score:", calculatedScore);

      // Update the browser action badge to match the popup score
      chrome.runtime.sendMessage({ action: "setBadgeScore", score: calculatedScore });
    }    // Render the breakdown details (but DON'T let this override the main score)
    sustainabilityMetricsContainer.innerHTML = '';
    // Use the same breakdown variable from above
    let detailsData = [];
    const fieldOrder = [
      { key: 'production_and_brand', label: 'Production And Brand' },
      { key: 'circularity_and_end_of_life', label: 'Circularity And End Of Life' },
      { key: 'material_composition', label: 'Material Composition' }
    ];
    
    if (breakdown) {
      fieldOrder.forEach(field => {
        const metricData = breakdown[field.key] || {};
        const value = metricData.value || metricData.rating;
        const score = typeof metricData.score === 'number' ? metricData.score : undefined;

        // Field ratings display the raw score out of 10, not weighted
        const displayFieldScore = (score !== undefined && score >= 0) ? Math.max(0, Math.min(10, score)) : undefined;
        const ratingText = (displayFieldScore !== undefined) ? `(Rating: ${displayFieldScore}/10)` : '(Rating: --/10)';

        let valueText;
        if (value && value !== "Unknown") {
          valueText = value;
        } else if (displayFieldScore !== undefined) {
          valueText = "Unknown";
        } else {
          valueText = "We could not find data";
        }
        
        detailsData.push({
          title: field.label,
          value: valueText,
          score: displayFieldScore,
          analysis: metricData.analysis || "We could not find data"
        });
        
        const metricElement = document.createElement('div');
        metricElement.className = 'metric';
        metricElement.innerHTML = `
          <h3>${field.label}</h3>
          <div class="metric-value">${valueText} ${ratingText}</div>
          <div class="meter">
            <div class="meter-bar" style="width: ${displayFieldScore ? displayFieldScore * 10 : 0}%; background-color: ${getScoreColor(displayFieldScore ? displayFieldScore * 10 : 0)};"></div>
          </div>
        `;
        sustainabilityMetricsContainer.appendChild(metricElement);
      });
    } else {
      // Always show the 3 default fields with placeholder values
      fieldOrder.forEach(field => {
        detailsData.push({
          title: field.label,
          value: "We could not find data",
          score: undefined,
          analysis: "We could not find data"
        });
        const metricElement = document.createElement('div');
        metricElement.className = 'metric';
        metricElement.innerHTML = `
          <h3>${field.label}</h3>
          <div class="metric-value">We could not find data (Rating: --/10)</div>
          <div class="meter">
            <div class="meter-bar" style="width: 0%; background-color: #ccc;"></div>
          </div>
        `;
        sustainabilityMetricsContainer.appendChild(metricElement);
      });
    }
    
    // Show Details button logic
    const showDetailsButton = document.getElementById('show-details');
    showDetailsButton.disabled = false;
    showDetailsButton.onclick = function() {
      chrome.storage.local.set({ sustainabilityDetails: { allFields: detailsData } }, function() {
        window.location.href = 'details.html';
      });
    }    // Show Recommendations button logic
    const showRecommendationsButton = document.getElementById('show-recommendations');
    const recommendations = data.recommendations || [];
    
    console.log('Recommendations from backend:', recommendations);
    
    // Check if the showAlternatives setting is enabled
    chrome.storage.sync.get(['settings'], (result) => {
      const settingsData = result.settings || {};
      const showAlternativesEnabled = settingsData.showAlternatives !== false; // Default to true
      
      console.log('Show alternatives setting:', showAlternativesEnabled);
      
      if (!showAlternativesEnabled) {
        // Hide the recommendations button if the setting is disabled
        showRecommendationsButton.style.display = 'none';
        console.log('Recommendations button hidden due to settings');
      } else if (recommendations.length > 0) {
        showRecommendationsButton.style.display = 'block';
        showRecommendationsButton.disabled = false;
        showRecommendationsButton.textContent = `View Recommendations (${recommendations.length})`;
        showRecommendationsButton.onclick = function() {
          console.log('Storing recommendations:', recommendations);
          chrome.storage.local.set({ 
            sustainabilityRecommendations: recommendations,
            currentProductCategory: data.category || 'Unknown'
          }, function() {
            window.location.href = 'recommendations.html';
          });
        }
      } else {
        showRecommendationsButton.style.display = 'block';
        showRecommendationsButton.disabled = true;        showRecommendationsButton.textContent = 'No Recommendations Available';
        showRecommendationsButton.style.opacity = '0.6';
      }
    });

    if (data.alternatives && data.alternatives.length > 0) {
      alternativesListElement.innerHTML = '';
      data.alternatives.forEach(alt => {
        const altElement = document.createElement('div');
        altElement.className = 'alternative-item';
        altElement.innerHTML = `
          <div class="alternative-name">${alt.brand}</div>
          <div class="alternative-score" style="background-color: ${getScoreColor(alt.score)}">${alt.score}</div>
        `;
        altElement.addEventListener('click', () => {
          window.open(`https://www.google.com/search?q=${encodeURIComponent(alt.brand)}+sustainable+products`, '_blank');
        });
        alternativesListElement.appendChild(altElement);
      });
    } else {
      document.querySelector('.alternatives-container').classList.add('hidden');
    }
  }

  function showNoProductMessage(message = "Please visit a product page to see sustainability information") {
    loadingElement.classList.add('hidden');
    productInfoElement.classList.add('hidden');
    noProductElement.classList.remove('hidden');
    noProductElement.querySelector('p').textContent = message;
  }

  function getScoreColor(score) {
    if (score === null || score === undefined || isNaN(score)) return '#ccc'; // Default for N/A
    if (score >= 70) return '#4caf50'; // Green
    if (score >= 40) return '#ff9800'; // Orange
    return '#f44336'; // Red
  }

  function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
  optionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Learn More button - opens GitHub homepage
  learnMoreButton.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://github.com/yourusername/yourrepository' });
  });// The "Show Details" button handles navigation to details page
  function showLoadingState() {
    loadingElement.classList.remove('hidden');
    noProductElement.classList.add('hidden');
    productInfoElement.classList.add('hidden');
    
    // Set loading indicators
    if (scoreValueElement) {
      scoreValueElement.textContent = '...';
      scoreValueElement.style.color = '#999';
    }
    if (brandNameElement) {
      brandNameElement.textContent = 'Loading...';
    }
    
    // Start progressive loading messages
    updateLoadingMessage("Fetching data from database...");
    
    console.log("popup.js: Showing loading state - fetching data from database");
  }
  
  function updateLoadingMessage(message) {
    if (loadingMessageElement) {
      loadingMessageElement.textContent = message;
    }
  }
    function showProgressiveLoading() {
    let step = 0;
    const messages = [
      "Fetching data from database...",
      "Analyzing sustainability metrics...",
      "Calculating scores and recommendations...",
      "Preparing detailed breakdown..."
    ];
    
    const interval = setInterval(() => {
      if (step < messages.length) {
        updateLoadingMessage(messages[step]);
        step++;
        
        // If we're past the first step and still loading, it's likely a cache miss with LLM analysis
        if (step >= 2) {
          updateLoadingMessage("Analyzing product sustainability...");
          clearInterval(interval);
        }
      }
    }, 3000); // Change message every 3 seconds for cache hit, then switch to analyzing for cache miss
    
    // Store interval ID to clear it when data arrives
    window.ecoshopLoadingInterval = interval;
  }
});