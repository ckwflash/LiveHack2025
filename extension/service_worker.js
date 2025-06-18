// Service worker for EcoShop sustainability extension - Production Version with SSE
// This extension requires database connectivity and uses Server-Sent Events for real-time updates

console.log("EcoShop Service Worker starting up...");
console.log("EcoShop Service Worker ACTIVE: [main service_worker.js] - v2025-06-17");

// Note: No caching - always fetch fresh data from database
console.log("EcoShop Service Worker: Always fetching data from database");

// Store product data history for reference
let scrapedProductsHistory = [];

// Store cached data by tab ID for badge restoration (minimal UI state only)
let tabDataCache = {};

// Store active SSE connections by task ID
let activeConnections = new Map();

// API Base URL
const API_BASE_URL = 'https://api.lxkhome.duckdns.org'; // Previous public URL
// const API_BASE_URL = 'http://127.0.0.1:5000'; // For local development

console.log("EcoShop Service Worker initialized, API:", API_BASE_URL);

// List of API endpoints to try for sustainability data
const API_ENDPOINTS = [
  // Primary API (replace with your actual API if different)
  // `${API_BASE_URL}/sustainability/analyze`, // Example: if your backend has a specific path
  // `${API_BASE_URL}/score`, // Example
  // `${API_BASE_URL}/product/analyze`, // Example

  // Using the specific endpoints from your app.py for now, assuming they are hosted under API_BASE_URL
  `${API_BASE_URL}/extract_and_rate`, // This seems to be the main endpoint from your app.py
  `${API_BASE_URL}/rate_product` // This is another endpoint in your app.py
  
  // Fallback APIs (consider removing if you only want to use your backend)
  // 'https://api.sustainabilitydata.com/analyze',
  // 'https://sustainability-api.herokuapp.com/score',
  // 'https://api.ecodata.org/product/analyze'
];

console.log("Using API endpoints:", API_ENDPOINTS.join(', '));

// Function to generate fallback data structure
function getFallbackProductData(productInfo = {}) {
  return {
    product_name: productInfo.name || "Product Information",
    brand_name: productInfo.brand || "Brand Information",
    // Remove default_sustainability_score, rely on backend only
    message: "Service unavailable. Displaying placeholder information. Please check your connection or try again later.",
    breakdown: {
      production_and_brand: { rating: "Unknown", score: 0.0, analysis: "Service unavailable" },
      circularity_and_end_of_life: { rating: "Unknown", score: 0.0, analysis: "Service unavailable" },
      material_composition: { rating: "Unknown", score: 0.0, analysis: "Service unavailable" }
    },
    certainty: "none",
    alternatives: [],
    isFallback: true // Custom flag to indicate this is fallback data
  };
}

// Main message listener - Edge-compatible single listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Service worker received message:", message.action, message);
  
  try {
    if (message.action === "checkSustainability") {
      console.log("Starting sustainability check...");
      
      // Call the handler and ensure response
      (async () => {
        try {
          // Ensure productInfo is passed, even if it's an empty object
          const productInfoForHandler = message.productInfo || {};
          await handleSustainabilityCheck(productInfoForHandler, sendResponse, sender);
        } catch (error) {
          console.error("Handler failed for checkSustainability, sending fallback data:", error);
          sendResponse({
            success: true, // Indicate success to allow popup to render fallback
            data: getFallbackProductData(message.productInfo || {})
          });
        }
      })();
      
      return true; // Required for async response    } else if (message.action === "openPopup") {
      if (sender.tab && sender.tab.id) {
        chrome.action.setPopup({ tabId: sender.tab.id, popup: "popup/popup.html" });
        // Remove the badge number - always set empty text
        chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: [41, 121, 255, 255], tabId: sender.tab.id });
        let flashCount = 0;
        const flashInterval = setInterval(() => {
          if (flashCount >= 3) {
            clearInterval(flashInterval);
            const cachedData = getCachedDataForTab(sender.tab.id);
            if (cachedData && cachedData.score) {
              updateBadgeForTab(sender.tab.id, cachedData.score);
            }
            return;
          }
          chrome.action.setBadgeBackgroundColor({ 
            color: flashCount % 2 === 0 ? [255, 82, 82, 255] : [41, 121, 255, 255], 
            tabId: sender.tab.id 
          });
          flashCount++;
        }, 500);
      }
      sendResponse({ success: true });
      return false;
    } else if (message.action === "checkCurrentPage") {
      const productInfo = {
        brand: extractBrandFromTitle(message.title),
        name: message.title,
        url: message.url
      };
      
      (async () => {
        try {
          await handleSustainabilityCheck(productInfo, sendResponse, sender);
        } catch (error) {
          console.error("Handler failed for checkCurrentPage, sending fallback data:", error);
          sendResponse({
            success: true, // Indicate success to allow popup to render fallback
            data: getFallbackProductData(productInfo)
          });
        }
      })();
      
      return true;
    } else if (message.action === "getMostRecentProductInfo") {
      try {
        if (scrapedProductsHistory.length > 0) {
          sendResponse({
            success: true,
            product: scrapedProductsHistory[0]
          });
        } else {
          sendResponse({ success: false, error: "No product info available." });
        }
      } catch (e) {
        console.log("Response error:", e);
        sendResponse({ success: false, error: "Error retrieving product info" });
      }
      return true;
    } else if (message.action === "showToast" && message.message) {
      if (typeof showToast === 'function') {
        showToast(message.message, 4000);
      }
      sendResponse({ success: true });
      return true;
    } else if (message.action === "refreshEcoShopBadge" && message.tabId) {
      // Try to get the latest cached data for this tab and update the badge
      const cachedData = getCachedDataForTab(message.tabId);
      if (cachedData) {
        updateBadgeForTab(message.tabId, cachedData);
      }
      sendResponse && sendResponse({ success: true });
      return true;    } else if (message.action === "setBadgeScore" && typeof message.score === 'number') {
      if (sender && sender.tab && sender.tab.id) {
        // Remove the badge number - always set empty text
        chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
        let color = '#FFC107';
        if (message.score >= 70) color = '#4CAF50';
        else if (message.score < 40) color = '#F44336';
        chrome.action.setBadgeBackgroundColor({ color, tabId: sender.tab.id });
      }
      sendResponse && sendResponse({ success: true });
      return true;
    }
  } catch (err) {
    console.error("Service worker error:", err);
    try { 
      // For general errors not caught by specific handlers, also send fallback
      sendResponse({ 
        success: true, 
        data: getFallbackProductData(),
        error: 'Internal error in service worker: ' + err.message 
      }); 
    } catch (e) {
      console.log("Failed to send error response with fallback:", e);
    }
    return false; // Return false as sendResponse might have been called
  }
  
  // Default fallback for unknown actions - consider if this should also send structured fallback
  console.log("Unknown message action:", message.action);
  sendResponse({ success: false, error: "Unknown action" });
  return false;
});

function getCachedDataForTab(tabId) {
  return tabDataCache[tabId];
}

// Extract brand name from page title (fallback method)
function extractBrandFromTitle(title) {
  if (!title) return null;
  
  const brandPatterns = [
    /by\\s+([A-Za-z0-9\\s]+)/i,
    /([A-Za-z0-9\\s]+)\\s+official/i,
    /([A-Za-z0-9\\s]+)\\s+store/i,
  ];
  
  for (const pattern of brandPatterns) {
    const match = title.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  const words = title.split(' ');
  if (words[0] && words[0][0] === words[0][0].toUpperCase()) {
    return words[0];
  }
  
  return null;
}

// Send toast message to content script
function sendToastToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, { action: "showToast", message });
}

// Poll for product updates after it's been inserted for processing
// Create a new analysis task
async function createAnalysisTask(productInfo) {
  try {
    const response = await fetch(`${API_BASE_URL}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task_type: 'sustainability_analysis',
        product_url: productInfo.url,
        product_name: productInfo.name,
        product_brand: productInfo.brand,
        specifications: productInfo.specifications || {}
      })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error creating analysis task:', error);
    return { success: false, error: error.message };
  }
}

// Monitor task progress using Server-Sent Events
function monitorTaskWithSSE(taskId, productInfo, sender, sendResponse) {
  console.log(`Starting SSE monitoring for task ${taskId}`);
  
  // Don't create duplicate connections
  if (activeConnections.has(taskId)) {
    console.log(`SSE connection already exists for task ${taskId}`);
    return;
  }

  const eventSource = new EventSource(`${API_BASE_URL}/watch/${taskId}`);
  activeConnections.set(taskId, eventSource);

  eventSource.onmessage = function(event) {
    try {
      const update = JSON.parse(event.data);
      console.log(`SSE update for task ${taskId}:`, update);

      if (update.error) {
        console.error(`SSE error for task ${taskId}:`, update.error);
        if (sender && sender.tab && sender.tab.id) {
          sendToastToTab(sender.tab.id, `EcoShop: Error during analysis: ${update.error}`);
        }
        eventSource.close();
        activeConnections.delete(taskId);
        return;
      }

      // Handle different update types
      if (update.status === 'completed' && update.data) {
        console.log(`Task ${taskId} completed successfully`);
        
        // Cache the result
        const cacheKey = productInfo.brand?.toLowerCase();
        if (cacheKey) {
          sustainabilityCache[cacheKey] = update.data;
        }

        // Update UI
        if (sender && sender.tab && sender.tab.id) {
          updateBadgeForTab(sender.tab.id, update.data.score);
          tabDataCache[sender.tab.id] = update.data;
          sendToastToTab(sender.tab.id, `EcoShop: Analysis complete! Score: ${update.data.score}`);
        }

        // Send final result (this might not reach the original caller, but useful for future requests)
        sendResponse({
          success: true,
          data: update.data
        });

        eventSource.close();
        activeConnections.delete(taskId);
        
      } else if (update.status === 'processing') {
        console.log(`Task ${taskId} is processing...`);
        if (sender && sender.tab && sender.tab.id) {
          sendToastToTab(sender.tab.id, `EcoShop: ${update.message || 'Processing...'}`);
        }
        
      } else if (update.status === 'failed') {
        console.error(`Task ${taskId} failed:`, update.error);
        if (sender && sender.tab && sender.tab.id) {
          sendToastToTab(sender.tab.id, `EcoShop: Analysis failed: ${update.error || 'Unknown error'}`);
        }
        eventSource.close();
        activeConnections.delete(taskId);
      }
      
    } catch (error) {
      console.error(`Error parsing SSE message for task ${taskId}:`, error);
    }
  };

  eventSource.onerror = function(error) {
    console.error(`SSE connection error for task ${taskId}:`, error);
    if (sender && sender.tab && sender.tab.id) {
      sendToastToTab(sender.tab.id, `EcoShop: Connection error during analysis`);
    }
    eventSource.close();
    activeConnections.delete(taskId);
  };

  // Set a timeout to close connection after 5 minutes
  setTimeout(() => {
    if (activeConnections.has(taskId)) {
      console.log(`Closing SSE connection for task ${taskId} due to timeout`);
      eventSource.close();
      activeConnections.delete(taskId);
      if (sender && sender.tab && sender.tab.id) {
        sendToastToTab(sender.tab.id, `EcoShop: Analysis timed out`);
      }
    }
  }, 300000); // 5 minutes
}

// Handle sustainability data lookup - Production version requires database connection
async function handleSustainabilityCheck(productInfo, sendResponse, sender) {
  console.log("=== Starting handleSustainabilityCheck (API-first) ===");
  console.log("Product info (raw):", productInfo);
  try {
    // Use plainText if available, else fallback to formatting
    const plainText = productInfo.plainText || (typeof formatAsPlainText === 'function' ? formatAsPlainText(productInfo) : '');
    console.log("Using plainText:", plainText);
    const transformed = { text: plainText };
    
    // Add to history
    if (transformed.text) {
      const productWithTimestamp = {
        ...transformed,
        timestamp: new Date().toISOString()
      };
      scrapedProductsHistory.unshift(productWithTimestamp);
      if (scrapedProductsHistory.length > 100) scrapedProductsHistory.pop();
    }    // ALWAYS fetch fresh data from database - no caching
    console.log("Service worker: Always fetching data from database...");
    const startTime = Date.now();
    const cacheKey = productInfo.url || (productInfo.brand || productInfo.name)?.toLowerCase();

    // 1. Try backend API - ALWAYS call database for most accurate info
    try {
      console.log("Service worker: Calling backend API for fresh database data...");
      const apiData = await fetchFromApi(transformed, productInfo.brand);
      const processingTime = Date.now() - startTime;
      
      if (apiData && typeof apiData.score === 'number' && !isNaN(apiData.score)) {
        console.log("=== SERVICE WORKER: BACKEND API SUCCESS ===");
        console.log("Fresh data from database:", JSON.stringify(apiData, null, 2));
        console.log("Specifically, fresh score from database:", apiData.score);
        console.log(`Processing took ${processingTime}ms`);
        
        // Don't cache - always fresh data
        // Add timestamp and processing time for logging purposes only
        apiData.timestamp = Date.now();
        apiData.processingTimeMs = processingTime;
        
        if (sender?.tab?.id) {
          updateBadgeForTab(sender.tab.id, apiData.score);
          tabDataCache[sender.tab.id] = apiData;
          
          // Show different toast messages based on processing time
          if (processingTime > 8000) {
            sendToastToTab(sender.tab.id, `EcoShop: Analysis complete! Score: ${apiData.score} (full analysis)`);
          } else {
            sendToastToTab(sender.tab.id, `EcoShop: Fresh data loaded! Score: ${apiData.score}`);
          }
        }
        
        // Send the fresh response
        const responseToSend = { success: true, data: apiData };
        console.log("Service worker sending fresh database response:", responseToSend);
        sendResponse(responseToSend);
        return;
      } else {
        console.warn("Service worker: Backend API returned invalid data - score missing or invalid");
        throw new Error("Backend returned invalid score data");
      }    } catch (apiError) {
      console.error("Service worker: Backend API failed:", apiError);
      // Don't fallback to test data - let user know backend is needed
      sendResponse({ 
        success: false, 
        error: "Backend service unavailable. Please check connection and try again.",
        details: apiError.message 
      });
      return;
    }
  } catch (error) {
    console.error("Error in handleSustainabilityCheck:", error);
    sendResponse({ success: false, error: error.message });
  }
  console.log("=== Completed handleSustainabilityCheck ===");
}

// Update fetchFromApi to use new structure
async function fetchFromApi(transformedTextPayload, brandForFallback) {
  try {
    if (!transformedTextPayload || !transformedTextPayload.text) {
      throw new Error("Missing product information");
    }

    const settingsData = await new Promise(resolve => {
      chrome.storage.sync.get(['settings', 'apiEndpoint'], (result) => {
        const settings = result.settings || {};
        const directApiEndpoint = result.apiEndpoint;
        resolve({ 
          settings: settings,
          directApiEndpoint: directApiEndpoint
        });
      });
    });
    
    // Ensure the globally defined API_BASE_URL is used for all API calls
    const apiBaseUrl = API_BASE_URL; 
    
    // console.log("User settings directApiEndpoint:", settingsData.directApiEndpoint);
    // console.log("User settings settings.apiEndpoint:", settingsData.settings && settingsData.settings.apiEndpoint);
    console.log("Forcing usage of API_BASE_URL:", apiBaseUrl);

    // The original logic for cleaning up /api/score or trailing slashes can remain,
    // though it might be less relevant if API_BASE_URL is always clean.
    let cleanApiBaseUrl = apiBaseUrl;
    if (cleanApiBaseUrl.endsWith('/api/score')) {
      cleanApiBaseUrl = cleanApiBaseUrl.replace('/api/score', '');
    }
    cleanApiBaseUrl = cleanApiBaseUrl.replace(/\/$/, ''); // Ensure no trailing slash
    
    const postApiUrl = cleanApiBaseUrl + '/extract_and_rate';
    
    console.log("Using API endpoint for POST:", postApiUrl);
    console.log("Sending product text:", transformedTextPayload.text);
    console.log("Text length:", transformedTextPayload.text?.length);
      const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // Increased to 30 seconds
    
    try {
      console.log("Making API request to:", postApiUrl);
      const response = await fetch(postApiUrl, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-cache',
        signal: controller.signal,
        headers: {
          'Content-Type': 'text/plain'
        },
        body: transformedTextPayload.text
      });
      
      console.log("API response status:", response.status);
      console.log("API response ok:", response.ok);
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.error(`API response not OK: ${response.status} - ${response.statusText}`);
        
        // Try simpler brand lookup endpoint
        console.log("Falling back to simple brand lookup");
        const fallbackUrl = cleanApiBaseUrl + `/rate_product?brand=${encodeURIComponent(brandForFallback)}`;
        console.log("Trying fallback GET request to:", fallbackUrl);
        const fallbackResponse = await fetch(fallbackUrl, {
          method: 'GET',
          mode: 'cors',
          cache: 'no-cache'
        });
        
        if (!fallbackResponse.ok) {
          throw new Error(`Fallback API returned ${fallbackResponse.status}: ${fallbackResponse.statusText} (Original error: ${response.status} - ${response.statusText})`);
        }
        
        const fallbackData = await fallbackResponse.json();
        console.log("Fallback API response:", fallbackData);
        
        if (fallbackData && fallbackData.success && fallbackData.data) {
          return fallbackData.data;
        } else {
          throw new Error("No data available for this brand");
        }
      }
        const responseData = await response.json();
      console.log("=== SERVICE WORKER: RAW API RESPONSE ===");
      console.log("API response:", JSON.stringify(responseData, null, 2));
        if (responseData && responseData.data) {
        console.log("=== SERVICE WORKER: API DATA DETAILED ===");
        console.log("Data keys:", Object.keys(responseData.data));
        console.log("Score from backend:", responseData.data.score);
        console.log("Score type:", typeof responseData.data.score);
        console.log("Recommendations in response:", responseData.data.recommendations);
        console.log("Recommendations count:", responseData.data.recommendations ? responseData.data.recommendations.length : 0);
        
        if (responseData.data.recommendations && responseData.data.recommendations.length > 0) {
          console.log("=== SERVICE WORKER: RECOMMENDATIONS DETAILED ===");
          responseData.data.recommendations.forEach((rec, index) => {
            console.log(`Recommendation ${index + 1}:`, JSON.stringify(rec, null, 2));
          });
        }
      }
      
      if (responseData && responseData.success) {
        if (responseData.status === 'found') {
          return responseData.data;
        } else if (responseData.status === 'processing') {
          return {
            ...responseData.data,
            product_id: responseData.product_id
          };
        } else if (responseData.data) {
          return responseData.data;
        }
      }
      
      throw new Error("Invalid response format from API");
      
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        throw new Error("API request timed out");
      }
      throw fetchError;
    }
  } catch (error) {
    console.error("API fetch error:", error);
    throw error;
  }
}

// Fallback API function for testing when primary backend is down
async function tryFallbackApi(productInfo) {
  try {
    // For faster testing, skip external APIs and generate test score directly
    console.log("Generating test score directly for faster testing");
    return generateTestScore(productInfo);
    
    // (External API code commented out for faster testing)
    /*
    // Try external sustainability API endpoints
    const fallbackEndpoints = [
      'https://api.sustainabilitydata.com/analyze',
      'https://sustainability-api.herokuapp.com/score',
      'https://api.ecodata.org/product/analyze'
    ];
    
    for (const endpoint of fallbackEndpoints) {
      try {
        console.log(`Trying fallback endpoint: ${endpoint}`);
        
        const response = await fetch(endpoint, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            brand: productInfo.brand,
            name: productInfo.name,
            specifications: productInfo.specifications || {},
            details: productInfo.details || {},
            description: productInfo.description || {}
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data && data.score) {
            return {
              brand: productInfo.brand,
              score: data.score,
              co2e: data.co2e || 'unknown',
              waterUsage: data.waterUsage || 'unknown',
              wasteGenerated: data.wasteGenerated || 'unknown',
              laborPractices: data.laborPractices || 'unknown',
              certainty: 'fallback_api',
              message: `Sustainability data from fallback API for ${productInfo.brand}`
            };
          }
        }
      } catch (endpointError) {
        console.log(`Fallback endpoint ${endpoint} failed:`, endpointError);
        continue;
      }
    }
    */
    
    // If all external APIs fail, generate a test score based on scraped data
    console.log("All fallback APIs failed, generating test score");
    return generateTestScore(productInfo);
    
  } catch (error) {
    console.error("Fallback API error:", error);
    return null;
  }
}

// Update generateTestScore to use new structure
function generateTestScore(productInfo) {
  let score = 50;
  
  // Analyze the plain text for sustainability clues
  const allText = (productInfo.text || '').toLowerCase();
  
  console.log("Analyzing text for sustainability indicators:", allText.substring(0, 200));
  
  // Positive indicators
  if (allText.includes('eco') || allText.includes('green') || allText.includes('sustainable')) {
    score += 15;
    console.log("Found eco/green/sustainable indicators +15");
  }
  if (allText.includes('recycled') || allText.includes('renewable')) {
    score += 10;
    console.log("Found recycled/renewable indicators +10");
  }
  if (allText.includes('energy efficient') || allText.includes('low power') || allText.includes('battery')) {
    score += 10;
    console.log("Found energy efficient indicators +10");
  }
  if (allText.includes('organic') || allText.includes('natural')) {
    score += 8;
    console.log("Found organic/natural indicators +8");
  }
  
  // Quality indicators (suggest longer lifespan)
  if (allText.includes('warranty') || allText.includes('durable') || allText.includes('quality')) {
    score += 5;
    console.log("Found quality indicators +5");
  }
  
  // Brand-based adjustments (known sustainable brands)
  const sustainableBrands = ['patagonia', 'tesla', 'fairphone', 'seventh generation', 'method', 'bose'];
  if (sustainableBrands.some(b => allText.includes(b))) {
    score += 20;
    console.log("Found sustainable brand +20");
  }
  
  // Category-based adjustments
  if (allText.includes('electronics') && allText.includes('warranty')) score += 5;
  if (allText.includes('clothing') && allText.includes('cotton')) score -= 5;
  
  // Negative indicators
  if (allText.includes('disposable') || allText.includes('single use')) {
    score -= 20;
    console.log("Found disposable indicators -20");
  }
  
  // Cap the score
  score = Math.min(Math.max(score, 10), 100);
  
  console.log("Final calculated score:", score);
  
  return {
    score: score,
    co2e: score > 70 ? 'low' : score > 40 ? 'medium' : 'high',
    waterUsage: score > 70 ? 'low' : score > 40 ? 'medium' : 'high',
    wasteGenerated: score > 70 ? 'low' : score > 40 ? 'medium' : 'high',
    laborPractices: score > 60 ? 'good' : score > 30 ? 'fair' : 'poor',
    certainty: 'estimated',
    message: `Test score generated from scraped data`,
    scraped_text: productInfo.text || ''
  };
}

// Handle extension icon badge updates
async function updateBadgeForTab(tabId, backendDataOrScore, displayScoreFromContent) {
  let score = displayScoreFromContent;
  if (typeof score !== 'number') {
    // fallback to old logic if not provided
    score = backendDataOrScore;
    if (typeof backendDataOrScore === 'object' && backendDataOrScore !== null) {
      const breakdown = backendDataOrScore.sustainability_breakdown || backendDataOrScore.breakdown;
      if (breakdown) {
        const settingsData = await new Promise(resolve => {
          chrome.storage.sync.get(['settings'], (result) => {
            resolve(result.settings || {});
          });
        });
        const fieldWeightMap = {
          production_and_brand: settingsData.production_and_brand || 5,
          circularity_and_end_of_life: settingsData.circularity_and_end_of_life || 5,
          material_composition: settingsData.material_composition || 5
        };
        const fieldOrder = [
          'production_and_brand',
          'circularity_and_end_of_life',
          'material_composition'
        ];        let weightedSum = 0;
        let totalWeight = 0;
        
        // Calculate total weight first
        fieldOrder.forEach(key => {
          totalWeight += fieldWeightMap[key] || 5;
        });
          fieldOrder.forEach(key => {
          const metricData = breakdown[key] || {};
          let value = metricData.value || metricData.rating || "Unknown";
          let fieldScore = typeof metricData.score === 'number' ? metricData.score : undefined;
          let summaryScore = (typeof fieldScore === 'number') ? fieldScore * fieldWeightMap[key] / totalWeight : 0;
          weightedSum += summaryScore;
        });
        
        score = weightedSum > 0 ? Math.round(weightedSum * 10) : undefined;
      }
    }  }
  // Remove the badge number - always set empty text
  chrome.action.setBadgeText({ text: '', tabId });
  if (typeof score === 'number' && !isNaN(score)) {
    let color = '#FFC107';
    if (score >= 70) color = '#4CAF50';
    else if (score < 40) color = '#F44336';
    chrome.action.setBadgeBackgroundColor({ color, tabId });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#888', tabId });
  }
}

// Helper function to format product info as plain text (fallback if content.js doesn't provide it)
function formatAsPlainText(info) {
  let lines = [];
  lines.push(`URL: ${info.url || ''}`);
  lines.push(`Product Brand: ${info.brand || ''}`);
  lines.push(`Product Name: ${info.name || ''}`);
  
  // Product Specifications - format as new lines for better readability
  let specLines = [];
  if (Array.isArray(info.specifications) && info.specifications.length > 0) {
    // First check if there's a Category spec and put it first
    const categorySpec = info.specifications.find(spec => 
      spec && spec.header && spec.header.toLowerCase() === 'category');
    
    if (categorySpec) {
      specLines.push(`Category: ${categorySpec.text}`);
    }
    
    // Then add all other specs
    info.specifications.forEach(spec => {
      if (spec && spec.header && spec.header.toLowerCase() !== 'category' && spec.text) {
        specLines.push(`${spec.header}: ${spec.text}`);
      } else if (spec && spec.text && !spec.header) {
        specLines.push(spec.text);
      }
    });
  }
  
  // Join specs with newlines for better structure
  if (specLines.length > 0) {
    lines.push(`Product Specifications:\n${specLines.join('\n')}`);
  } else {
    lines.push('Product Specifications:');
  }
  
  // Product Description
  let desc = '';
  if (Array.isArray(info.description) && info.description.length > 0) {
    desc = info.description
      .map(item => (item && item.text) ? item.text : '')
      .filter(Boolean)
      .join('\n\n');
  } else if (typeof info.description === 'object' && info.description && info.description.content) {
    desc = info.description.content;
  } else if (typeof info.description === 'string') {
    desc = info.description;
  }
  
  // Clean up description
  if (desc) {
    desc = desc.replace(/\xa0/g, ' ')
               .replace(/\s+/g, ' ')
               .replace(/\n\s*\n/g, '\n')
               .trim();
  }
  
  lines.push(`Product Description: ${desc || 'No description available'}`);
  
  return lines.join('\n');
}

// Listen for direct badge update from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "setBadgeScore" && typeof message.score === 'number') {
    if (sender && sender.tab && sender.tab.id) {
      updateBadgeForTab(sender.tab.id, undefined, message.score);
    }
    sendResponse && sendResponse({ success: true });
    return true;
  }
  // ...existing code...
});