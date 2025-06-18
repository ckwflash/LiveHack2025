// Content script that runs on supported e-commerce pages
(function() {
  // Flag to prevent repeated error toasts
  let hasShownErrorToast = false;
  // Flag to prevent multiple requests for the same page
  let hasRequestedData = false;
  // Track extracted product to prevent repeated extraction
  let lastExtractedProduct = null;
    // Reset flag when page URL changes (for single-page apps)
  let currentUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      hasRequestedData = false;
      hasShownErrorToast = false;
      lastExtractedProduct = null;
      // Fade/clear badge immediately on navigation
      let badge = document.getElementById('ecoshop-sustainability-badge');
      if (badge) {
        badge.style.opacity = '0.3';
        badge.style.filter = 'grayscale(1)';
        setTimeout(() => { if (badge.parentNode) badge.parentNode.removeChild(badge); }, 400);
      }
      console.log("EcoShop: Page URL changed, resetting flags and re-initializing observer");
      
      // Reset the observer
      if (window.ecoshopObserver) {
        window.ecoshopObserver.disconnect();
      }
      
      // Wait for the DOM to update after navigation before setting up observer and first extraction
      setTimeout(() => {
        // Try initial extraction
        const productInfo = extractProductInfo();
        if (productInfo && (productInfo.brand || productInfo.name)) {
          sendToServiceWorker(productInfo);
        } else {
          // If initial extraction fails, set up observer for dynamic content loading
          if (window.ecoshopObserver) {
            window.ecoshopObserver.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: false,
              characterData: false
            });
            console.log("EcoShop: Observer reinitialized after URL change");
          }
        }
      }, 1000);
    }
  }, 1000);
  
  // Check if current page is a product page by looking for product sections
  function isProductPage() {
    // Look for indicators that this is a product page
    const productIndicators = [
      // Text-based indicators
      () => document.body.textContent.includes('Product Specifications'),
      () => document.body.textContent.includes('Product Details'),
      () => document.body.textContent.includes('Product Description'),
      
      // Structure-based indicators
      () => document.querySelector('.product-specs, .specifications, .product-specifications'),
      () => document.querySelector('.product-details, .details, .product-info'),
      () => document.querySelector('.description, .product-description'),
      
      // Shopee-specific indicators
      () => document.querySelector('.qPNIqx'), // Brand selector
      () => document.querySelector('.YPqix5'), // Product name selector
      () => document.body.textContent.includes('Category') && 
            document.body.textContent.includes('Brand') && 
            document.body.textContent.includes('Stock')
    ];
    
    // Check if any indicator matches
    for (const indicator of productIndicators) {
      try {
        if (indicator()) {
          console.log("EcoShop: Detected product page");
          return true;
        }
      } catch (e) {
        // Ignore errors from selectors
      }
    }
    
    console.log("EcoShop: Not a product page");
    return false;
  }  function extractProductInfo() {
    const url = window.location.hostname;
    let productInfo = {
      brand: null,
      name: null,
      url: window.location.href,
      specifications: [], // For Product Specifications
      description: [] // For Product Description
    };
    
    // Only extract if this is a supported site AND a product page
    if (url.includes('shopee.sg') || url.includes('shopee.com')) {
      console.log("EcoShop: Detected Shopee website");
      
      // Check if this is actually a product page
      if (!isProductPage()) {
        console.log("EcoShop: Not a product page, skipping extraction");
        return null;
      }
      
      // Extract product name
      const nameSelectors = [
        '.YPqix5', 
        '.product-name',
        '.product-title',
        '.item-name',
        '.product-detail__name',
        'h1' 
      ];
      
      for (const selector of nameSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent?.trim()) {
          productInfo.name = element.textContent.trim();
          console.log("EcoShop: Found product name", productInfo.name);
          break;
        }
      }      // Extract brand name (shop name)
      const brandSelectors = [
        '.fV3TIn',  // Shopee shop name class
        '.qPNIqx', 
        '[data-testid="shopBrandName"]',
        '.shop-name',
        '.seller-name',
        '.brand-name'
      ];
      
      for (const selector of brandSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent?.trim()) {
          let brandText = element.textContent.trim();
          
          // Clean up shop name - remove "Active xx mins ago" or similar patterns
          if (selector === '.fV3TIn') {
            console.log("EcoShop: Raw shop text:", brandText);
            
            // Remove "Active" followed by time patterns
            brandText = brandText.replace(/Active\s+\d+\s+(min|mins|minute|minutes|hour|hours|hr|hrs|day|days|second|seconds|sec|secs)\s+ago/gi, '').trim();
            
            // Remove any trailing time indicators
            brandText = brandText.replace(/\s+\d+\s+(min|mins|minute|minutes|hour|hours|hr|hrs|day|days|second|seconds|sec|secs)\s+ago$/gi, '').trim();
            
            // Remove any remaining "Active" text at start or end
            brandText = brandText.replace(/^Active\s*/gi, '').replace(/\s*Active$/gi, '').trim();
            
            // If there are multiple lines/parts, take the first substantial part (likely the shop name)
            const parts = brandText.split(/\n|\s{2,}/).filter(part => part.trim().length > 0);
            if (parts.length > 0) {
              brandText = parts[0].trim();
            }
            
            console.log("EcoShop: Cleaned shop text:", brandText);
          }
          
          if (brandText && brandText.length > 0) {
            productInfo.brand = brandText;
            console.log("EcoShop: Found brand/shop name", productInfo.brand);
            break;
          }
        }
      }
        // Fallback: try to extract brand from meta tags
      if (!productInfo.brand) {
        const metaBrand = document.querySelector('meta[property="product:brand"]')?.content ||
                         document.querySelector('meta[property="og:brand"]')?.content;
        if (metaBrand) {
          productInfo.brand = metaBrand;
        }
      }
      
      // Fallback: try to extract brand from product name
      if (!productInfo.brand && productInfo.name) {
        // Look for common brand patterns in product names
        const brandPatterns = [
          /^\[?([A-Z][a-zA-Z0-9\s&]+)\]/i,  // [Brand Name] at start
          /^([A-Z][a-zA-Z0-9\s&]+)\s+[-]/i,  // Brand Name - Product
          /^([A-Z][a-zA-Z0-9\s&]{2,15})\s+/i  // First word(s) if capitalized
        ];
        
        for (const pattern of brandPatterns) {
          const match = productInfo.name.match(pattern);
          if (match && match[1]) {
            productInfo.brand = match[1].trim();
            console.log("EcoShop: Extracted brand from name:", productInfo.brand);
            break;
          }
        }
      }
        // Extract Product Specifications section
      extractProductSection(productInfo, "specifications");
      
      // Extract Product Description section
      extractProductSection(productInfo, "description");
      
      // Log the raw extracted data before formatting
      console.log("EcoShop: Raw extracted product info:", JSON.stringify(productInfo, null, 2));
    }
    
    // Helper to format product info as plain text for LLM and backend
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
      
      // Log what we're generating
      console.log("EcoShop: formatAsPlainText generated:", lines);
      
      return lines.join('\n');
    }
    
    productInfo.plainText = formatAsPlainText(productInfo);
    console.log("EcoShop: Generated plainText:", productInfo.plainText);
    
    console.log("EcoShop extracted product info:", productInfo);
    return productInfo;
  }
    // Extract specific product section (specifications, details, or description)
  function extractProductSection(productInfo, sectionType) {
    // Define selectors based on section type
    let headings, sectionSelectors;
    
    if (sectionType === "specifications") {
      headings = ["Product Specifications", "Specifications", "Specs"];
      sectionSelectors = ['.product-specs', '.specifications', '.product-specifications', '.spec-section'];
    } else if (sectionType === "description") {
      headings = ["Description", "Overview", "Summary", "Product Description"];
      sectionSelectors = ['.description', '.product-description', '.desc', '.overview'];
    }
    
    // Try to find the section container
    let sectionContainer = null;
    
    // First try: look for headings that contain our target text
    for (const heading of headings) {
      // Try to find heading elements
      const headingSelectors = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '.heading', '.title', 'div', 'span'];
      
      for (const selector of headingSelectors) {
        const elements = Array.from(document.querySelectorAll(selector));
        for (const el of elements) {
          const text = el.textContent?.trim();
          if (text && (text === heading || text.includes(heading))) {
            console.log(`EcoShop: Found ${sectionType} heading:`, text);
            
            // For specifications, look for the parent container that has the data
            if (sectionType === "specifications") {
              // Try to find the container with all the spec rows
              let parent = el.parentElement;
              while (parent && parent !== document.body) {
                const rows = parent.querySelectorAll('div, tr, li');
                if (rows.length > 3) { // Likely contains the spec data
                  sectionContainer = parent;
                  break;
                }
                parent = parent.parentElement;
              }
            } else {
              // For details/description, get the next sibling or parent container
              sectionContainer = el.nextElementSibling || el.parentElement;
              // Sometimes we need to go up to find the content container
              if (sectionContainer && sectionContainer.textContent.trim().length < 100) {
                sectionContainer = sectionContainer.parentElement;
              }
            }
            
            if (sectionContainer) {
              console.log(`EcoShop: Found ${sectionType} section via heading:`, heading);
              break;
            }
          }
        }
        if (sectionContainer) break;
      }
      if (sectionContainer) break;
    }
    
    // Second try: look for sections with specific class names
    if (!sectionContainer) {
      for (const selector of sectionSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          sectionContainer = element;
          console.log(`EcoShop: Found ${sectionType} section via selector:`, selector);
          break;
        }
      }
    }
    
    // Third try: For specifications, look for common patterns in Shopee
    if (!sectionContainer && sectionType === "specifications") {
      // Look for elements that might contain "Category", "Brand", "Stock" etc.
      const possibleContainers = document.querySelectorAll('div, section');
      for (const container of possibleContainers) {
        const text = container.textContent;
        if (text.includes('Category') && text.includes('Brand') && text.includes('Stock')) {
          sectionContainer = container;
          console.log('EcoShop: Found specifications via content pattern');
          break;
        }
      }
    }
    
    // If we're looking for description on Shopee, use special logic
    if (!sectionContainer && sectionType === "description" && 
        (window.location.hostname.includes('shopee.sg') || window.location.hostname.includes('shopee.com'))) {
      sectionContainer = extractShopeeDescription();
    }
    
    // If we found a section, extract its content
    if (sectionContainer) {
      const sectionData = sectionType === "specifications" ? 
        productInfo.specifications : 
        productInfo.description;
      
      if (sectionType === "specifications") {
        // For specifications, extract key-value pairs (improved logic)
        extractShopeeSpecificationPairs(sectionContainer, sectionData);
      } else {
        // For description, extract the text content
        const text = sectionContainer.textContent.trim();
        if (text && text.length > 10) {
          // Remove redundant whitespace in the description
          const cleanedText = text.replace(/\s+/g, ' ').trim();
          sectionData.push({ header: 'Content', text: cleanedText });
          console.log(`EcoShop: Extracted ${sectionType} content (${cleanedText.length} chars)`);
        }
      }
    } else {
      console.log(`EcoShop: Could not find ${sectionType} section`);
    }
  }
  
  // Special function to extract description from Shopee product pages
  function extractShopeeDescription() {
    console.log("EcoShop: Attempting specialized Shopee description extraction");
    
    // Most Shopee descriptions are in either:
    // 1. Tab panels with description content
    // 2. Large text blocks below specifications
    // 3. Product detail sections with multiple paragraphs
    
    // APPROACH 1: Find tab panels that might contain description
    const tabContainers = document.querySelectorAll('[role="tabpanel"], [class*="product-detail__content"], [class*="product-detail-tab"], [class*="detail-content"]');
    
    for (const tab of tabContainers) {
      // Skip if it has specification-like content
      const tabText = tab.textContent.trim();
      
      // Skip tabs that are clearly not description (they contain specs-like content)
      if (tabText.includes('Category:') && tabText.includes('Brand:') && tabText.includes('Stock:')) {
        continue;
      }
      
      // Skip tabs with short content or that are clearly not descriptions
      if (tabText.length < 50 || 
          tabText.includes('Add to Cart') || 
          tabText.includes('Buy Now') ||
          tabText.includes('View shop')) {
        continue;
      }
      
      console.log(`EcoShop: Found potential description in tab panel (${tabText.length} chars)`);
      return tab;
    }
    
    // APPROACH 2: Look for large text blocks (paras with substantial text)
    let longestParagraph = null;
    let maxLength = 100; // Minimum threshold for description length
    
    const paragraphs = document.querySelectorAll('p, div > div:not(:has(*)), [class*="description"]');
    for (const para of paragraphs) {
      const text = para.textContent.trim();
      
      // Skip elements that are likely not description
      if (text.includes('Category:') || text.includes('Brand:') || 
          text.includes('Add to Cart') || text.includes('Buy Now')) {
        continue;
      }
      
      if (text.length > maxLength) {
        maxLength = text.length;
        longestParagraph = para;
        console.log(`EcoShop: Found potential description paragraph (${text.length} chars)`);
      }
    }
    
    if (longestParagraph) {
      return longestParagraph;
    }
    
    // APPROACH 3: Look for any containers with substantial text content
    const potentialContainers = Array.from(document.querySelectorAll('div')).filter(div => {
      const text = div.textContent.trim();
      const childElementCount = div.childElementCount;
      
      // Good candidates have substantial text but not too many child elements
      return text.length > 100 && 
             childElementCount < 10 && 
             !text.includes('Category:') &&
             !text.includes('Brand:') &&
             !text.includes('Add to Cart');
    });
    
    // Sort by text length (descending)
    potentialContainers.sort((a, b) => 
      b.textContent.trim().length - a.textContent.trim().length);
    
    if (potentialContainers.length > 0) {
      console.log(`EcoShop: Found potential description container with ${potentialContainers[0].textContent.trim().length} chars`);
      return potentialContainers[0];
    }
    
    console.log("EcoShop: Could not find specific description element");
    return null;
  }
  
  // Helper function to extract Shopee specification key-value pairs
  function extractShopeeSpecificationPairs(container, sectionArr) {
    console.log("EcoShop: Extracting Shopee specifications from", container);
    
    // STRATEGY 1: Try grid-based layout (typical Shopee specs)
    // Find all rows (each row is a flex or grid container)
    const rows = Array.from(container.querySelectorAll(':scope > div'));
    console.log("EcoShop: Found " + rows.length + " potential spec rows");
    
    for (const row of rows) {
      const children = Array.from(row.children);
      if (children.length < 2) continue;
      
      const headerEl = children[0];
      const valueEl = children[1];
      const header = headerEl.textContent.trim();
      
      // Special handling for Category row (breadcrumb)
      if (header.toLowerCase() === 'category') {
        let categoryParts = [];
        // Look for links (Shopee uses links for category breadcrumbs)
        const links = valueEl.querySelectorAll('a');
        if (links.length > 0) {
          for (const link of links) {
            categoryParts.push(link.textContent.trim());
          }
        } else {
          // Fallback: check for arrow icons between text nodes
          for (const node of valueEl.childNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === 'A' || node.tagName === 'SPAN') {
                categoryParts.push(node.textContent.trim());
              } else if (node.tagName === 'IMG' && node.alt) {
                categoryParts.push(node.alt.trim());
              }
            } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              categoryParts.push(node.textContent.trim());
            }
          }
        }
        
        // Clean up category parts and join with ">"
        const filteredCategoryParts = categoryParts
          .map(p => p.trim())
          .filter(p => p && !p.includes('icon') && p !== '>' && p !== 'icon arrow right');
        
        if (filteredCategoryParts.length > 0) {
          sectionArr.push({ header: 'Category', text: filteredCategoryParts.join(' > ') });
          console.log("EcoShop: Extracted category:", filteredCategoryParts.join(' > '));
        }
        continue;
      }
        // For all other fields, handle different element structures
      // Special case: Brand value might be in an <a> with nested <meta> tags
      if (header.toLowerCase() === 'brand') {
        // First try if there's a meta tag with content attribute that represents brand
        const metaTags = valueEl.querySelectorAll('meta');
        let brandValue = null;
        
        for (const meta of metaTags) {
          if (meta.getAttribute('content')) {
            brandValue = meta.getAttribute('content').trim();
            console.log(`EcoShop: Brand value found in meta tag: ${brandValue}`);
            break;
          }
        }
        
        // If we didn't find a good meta tag, fallback to text content
        if (!brandValue) {
          brandValue = valueEl.textContent.trim();
        }
        
        if (header && brandValue) {
          sectionArr.push({ header, text: brandValue });
          console.log(`EcoShop: Extracted brand spec: ${header}: ${brandValue}`);
        }
      } else {
        // For all other fields, first look for <meta> tags with content
        const metaTag = valueEl.querySelector('meta[content]');
        let value = null;
        
        if (metaTag && metaTag.getAttribute('content')) {
          value = metaTag.getAttribute('content').trim();
          console.log(`EcoShop: Value found in meta tag: ${value}`);
        } else {
          // Fallback to text content
          value = valueEl.textContent.trim();
        }
        
        if (header && value) {
          sectionArr.push({ header, text: value });
          console.log(`EcoShop: Extracted spec: ${header}: ${value}`);
        }
      }
    }
    
    // STRATEGY 2: Look for specification table (alternative Shopee layout)
    if (sectionArr.length === 0) {
      const tables = container.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
          const headerCell = row.querySelector('th') || row.cells[0];
          const valueCell = row.querySelector('td') || (row.cells.length > 1 ? row.cells[1] : null);
          
          if (headerCell && valueCell) {
            const header = headerCell.textContent.trim();
            const value = valueCell.textContent.trim();
            
            if (header && value) {
              sectionArr.push({ header, text: value });
              console.log(`EcoShop: Extracted spec from table: ${header}: ${value}`);
            }
          }
        }
      }
    }
    
    // STRATEGY 3: Shopee sometimes uses definition lists
    if (sectionArr.length === 0) {
      const dts = container.querySelectorAll('dt');
      for (const dt of dts) {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD') {
          const header = dt.textContent.trim();
          const value = dd.textContent.trim();
          
          if (header && value) {
            sectionArr.push({ header, text: value });
            console.log(`EcoShop: Extracted spec from dl: ${header}: ${value}`);
          }
        }
      }
    }
    
    // STRATEGY 4: Look for all direct child divs and extract key-value pairs based on styling 
    if (sectionArr.length === 0) {
      // This handles the case where specs are in a grid with alternating cells
      const allChildren = Array.from(container.children);
      for (let i = 0; i < allChildren.length; i += 2) {
        if (i + 1 < allChildren.length) {
          const header = allChildren[i].textContent.trim();
          const value = allChildren[i + 1].textContent.trim();
          
          if (header && value) {
            sectionArr.push({ header, text: value });
            console.log(`EcoShop: Extracted spec from grid: ${header}: ${value}`);
          }
        }
      }
    }
    
    // FALLBACK: Parse lines with colon for robustness
    const text = container.textContent;
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    // If we still haven't extracted much, try line-by-line parsing
    if (sectionArr.length < 3) {
      console.log("EcoShop: Using fallback line-by-line specs extraction");
      
      for (const line of lines) {
        if (line.includes(':')) {
          const colonIndex = line.indexOf(':');
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          
          if (key && value && key.length < 50 && value.length < 200 && !key.toLowerCase().includes('category')) {
            sectionArr.push({ header: key, text: value });
            console.log(`EcoShop: Extracted spec from line: ${key}: ${value}`);
          }
        }
      }
    }
    
    // If extraction is really poor, dump the entire text as a raw spec
    if (sectionArr.length === 0 && text.trim().length > 0) {
      console.log("EcoShop: No structured specs found, using raw text");
      sectionArr.push({ 
        header: 'Raw Specifications', 
        text: text.replace(/\s+/g, ' ').trim().substring(0, 500)  // Limit length 
      });
    }
    
    console.log("EcoShop: Extracted " + sectionArr.length + " specification items");
  }
    // Send product info to the service worker
  function sendToServiceWorker(productInfo) {
    // Prevent multiple requests for the same page
    if (hasRequestedData) {
      console.log("EcoShop: Already requested data for this page, skipping");
      return;
    }
    
    // Don't send if productInfo is null (not a product page)
    if (!productInfo) {
      console.log("EcoShop: No product info to send");
      return;
    }
    
    // Check if we've already extracted the same product (same name + brand)
    const productKey = `${productInfo.name || ''}_${productInfo.brand || ''}`;
    if (lastExtractedProduct === productKey) {
      console.log("EcoShop: Same product already extracted, skipping");
      return;
    }
      lastExtractedProduct = productKey;
    hasRequestedData = true;
    console.log("EcoShop: Extraction successful, setting flags but keeping observer active");
    console.log("EcoShop: Sending to service worker for fresh database data", productInfo);
      // Show loading toast while fetching data from database
    showToast("EcoShop: Fetching fresh data from database...", 3000);
    
    // Actually fetch the data immediately when toast is shown
    chrome.runtime.sendMessage({ 
      action: "checkSustainability", 
      productInfo: productInfo 
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message:", chrome.runtime.lastError);
        showToast("EcoShop: Extension error - please try refreshing the page", 5000);
        return;
      }
      
      if (response && response.success) {
        console.log("EcoShop: Fresh data received from database, displaying badge");
        showToast("EcoShop: Fresh data loaded from database!", 2000);
        displaySustainabilityBadge(response.data);
      } else if (response && response.error) {
        console.error("Error getting fresh sustainability data:", response.error);
        if (response.error.includes("Database connection") && !hasShownErrorToast) {
          hasShownErrorToast = true;
          showToast("EcoShop: Database connection required. Please check your internet connection.", 5000);
        } else if (!hasShownErrorToast && !response.error.includes("Database connection")) {
          hasShownErrorToast = true;
          showToast(`EcoShop: ${response.message || response.error}`, 4000);
        }
      } else {
        console.error("Unknown error getting fresh sustainability data:", response);
        if (!hasShownErrorToast) {
          hasShownErrorToast = true;
          showToast("EcoShop: Unable to load sustainability data", 4000);
        }
      }
    });
  }
    // Get user preference for badge position and dark mode
  async function getUserPreferences() {
    return new Promise(resolve => {
      chrome.storage.sync.get(
        {
          darkMode: true,
          settings: {
            badgePosition: 'bottom-right',
            seniorMode: false,
            showBadge: true
          }
        },
        (result) => resolve({
          darkMode: result.darkMode,
          badgePosition: result.settings?.badgePosition || 'bottom-right',
          seniorMode: result.settings?.seniorMode ?? false,
          showBadge: result.settings?.showBadge ?? true
        })
      );
    });
  }

  // Display a sustainability badge on the page  
  async function displaySustainabilityBadge(sustainabilityData) {
    console.log("=== CONTENT.JS: displaySustainabilityBadge called ===");
    console.log("content.js: Raw sustainabilityData received:", JSON.stringify(sustainabilityData, null, 2));
    
    // Get user preferences
    const preferences = await getUserPreferences();
    const darkMode = preferences.darkMode;
    const seniorMode = preferences.seniorMode;
      // Calculate weighted score using the same algorithm as popup and badge
    const breakdown = sustainabilityData.sustainability_breakdown || sustainabilityData.breakdown;
    let displayScore = undefined;
    
    if (breakdown) {
      // Get user weights from settings
      const result = await new Promise(resolve => {
        chrome.storage.sync.get(['settings'], (result) => {
          resolve(result);
        });
      });
      
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
        weightedSum += summaryScore;
      });
      
      displayScore = weightedSum > 0 ? Math.round(weightedSum * 10) : undefined;
      
      console.log("content.js: Calculated weighted score:", displayScore);
      console.log("content.js: Weighted sum:", weightedSum);
      console.log("content.js: Field weights:", fieldWeightMap);
    } else {
      console.warn("content.js: No breakdown data available for score calculation");
      return; // Don't show badge if no breakdown data
    }
    
    // Validate the calculated score
    if (typeof displayScore !== 'number' || isNaN(displayScore)) {
      console.warn("content.js: Calculated score invalid, not showing badge:", displayScore);
      return; // Don't show badge if no valid calculated score
    }
    
    console.log("content.js: Final calculated display score:", displayScore);
      // Always update the browser action badge with calculated weighted score
    chrome.runtime.sendMessage({ action: "setBadgeScore", score: displayScore });
    // If showBadge is disabled, don't show the floating badge but still set browser action badge
    if (!preferences.showBadge) {
      console.log("EcoShop: Floating badge disabled by user preference, but browser action badge updated with fresh score");
      return;
    }
    
    // Check if there's already a floating badge
    let badge = document.getElementById('ecoshop-sustainability-badge');
    if (badge) {
      document.body.removeChild(badge);
    }
    // Create floating badge
    badge = document.createElement('div');
    badge.id = 'ecoshop-sustainability-badge';    
    // Apply position based on user preference
    let positionStyles = '';
    switch (preferences.badgePosition) {
      case 'bottom-right':
        positionStyles = 'bottom: 50px; right: 5px;'; // Moved up by 50px to avoid Shopee chat button
        break;
      case 'bottom-left':
        positionStyles = 'bottom: 50px; left: 5px;'; // Also moved up for consistency
        break;
      case 'top-right':
        positionStyles = 'top: 20px; right: 5px;';
        break;
      case 'top-left':
        positionStyles = 'top: 20px; left: 5px;';
        break;
      default:
        positionStyles = 'bottom: 50px; right: 5px;';
    }
    
    const fontSize = seniorMode ? '2.25rem' : '2rem';         // main score
    const titleSize = seniorMode ? '1.25rem' : '1rem';        // heading
    const subtitleSize = seniorMode ? '1rem' : '0.875rem';    // description
    const paddingSize = seniorMode ? '1.5em' : '1em';
    const badgeWidth = seniorMode ? '22vw' : '18vw';          // viewport-based for flexibility

    badge.style.cssText = `
      position: fixed;
      ${positionStyles}
      background-color: ${darkMode ? '#222' : 'white'};
      color: ${darkMode ? '#fff' : '#333'};
      border: 0.125rem solid #${getColorForScore(sustainabilityData.score)};
      border-radius: 0.5rem;
      padding: ${paddingSize};
      width: ${badgeWidth};
      z-index: 10000;
      box-shadow: 0 0.125rem 0.625rem rgba(0,0,0,0.3);
      font-family: Arial, sans-serif;
      cursor: pointer;
      transition: opacity 0.4s cubic-bezier(0.4,0,0.2,1), transform 0.4s cubic-bezier(0.4,0,0.2,1);
    `;


    badge.innerHTML = `
      <h3 style="margin: 0 0 0.625rem 0; font-size: ${titleSize}; color: ${darkMode ? '#fff' : '#333'};">
        Sustainability Score
      </h3>
      <div style="font-size: ${fontSize}; font-weight: bold; color: #${getColorForScore(displayScore)};">
        ${displayScore}/100
      </div>
      <p style="margin: 0.625rem 0 0 0; font-size: ${subtitleSize};">
        Click for details
      </p>
      <div style="margin-top: 0.5rem; font-size: ${subtitleSize}; color: ${darkMode ? '#ccc' : '#666'};">
        Or click the extension icon in the toolbar
      </div>    `;
    badge.style.opacity = '0';
    document.body.appendChild(badge);
    setTimeout(() => { badge.style.transition = 'opacity 0.5s'; badge.style.opacity = '1'; }, 10);

    // Disconnect the observer so the badge doesn't reappear after removal
    if (window.ecoshopObserver && typeof window.ecoshopObserver.disconnect === 'function') {
      window.ecoshopObserver.disconnect();
    }

    // Add hover effect
    badge.addEventListener('mouseenter', () => {
      badge.style.transform = 'translateY(-5px) scale(1.04)';
      badge.style.boxShadow = '0 5px 15px rgba(0,0,0,0.4)';
    });
    badge.addEventListener('mouseleave', () => {
      badge.style.transform = 'translateY(0) scale(1)';
      badge.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
    });

    // Only allow one click to remove the badge
    let badgeClicked = false;
    function badgeClickHandler(e) {
      if (badgeClicked) return;
      badgeClicked = true;
      badge.style.pointerEvents = 'none';
      e.preventDefault();
      e.stopPropagation();
      badge.style.opacity = '0';
      badge.style.transform = 'scale(0.8)';
      setTimeout(() => {
        if (badge.parentNode) badge.parentNode.removeChild(badge);
        showToast('For more details, please click the EcoShop extension icon in your browser toolbar.');
      }, 420);
    }
    badge.addEventListener('click', badgeClickHandler);
  }
  
  // Show a toast notification
  function showToast(message, duration = 3500) {
    // Check if a toast already exists
    let toast = document.getElementById('ecoshop-toast');
    if (toast) {
      document.body.removeChild(toast);
    }
    
    // Create the toast
    toast = document.createElement('div');
    toast.id = 'ecoshop-toast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 24px;
      border-radius: 4px;
      z-index: 10001;
      font-family: Arial, sans-serif;
      font-size: 14px;
      text-align: center;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Fade in
    setTimeout(() => {
      toast.style.opacity = '1';
    }, 10);
    
    // Fade out and remove
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentNode) {
          document.body.removeChild(toast);
        }
      }, 300);
    }, duration);
  }
  
  // Get color based on sustainability score
  function getColorForScore(score) {
    if (score >= 70) return '4CAF50'; // Green
    if (score >= 40) return 'FFC107'; // Yellow/Amber
    return 'F44336'; // Red  
  }
  
  // Handle messages from background script or popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getProductInfo") {
      const productInfo = extractProductInfo();
      sendResponse({ productInfo });
    }
    return true;
  });
  
  // Wait for the page to fully load
  window.addEventListener('load', () => {
    // First attempt to extract product info
    setTimeout(() => {
      const productInfo = extractProductInfo();
      if (productInfo && (productInfo.brand || productInfo.name)) {
        sendToServiceWorker(productInfo);
      } else {
        console.log("EcoShop: Initial extraction failed or not a product page, trying again in 2 seconds");
        // Try again after a longer delay for dynamic content
        setTimeout(() => {
          const productInfo = extractProductInfo();
          if (productInfo && (productInfo.brand || productInfo.name)) {
            sendToServiceWorker(productInfo);
          } else {
            console.log("EcoShop: Could not extract product information or not a product page");
          }
        }, 2000);
      }
    }, 1000);
  });
  // Create a debounced extraction function to avoid too many calls
  let extractionTimeout = null;
  const debouncedExtraction = () => {
    clearTimeout(extractionTimeout);
    extractionTimeout = setTimeout(() => {
      if (!document.getElementById('ecoshop-sustainability-badge') && !hasRequestedData) {
        if (isProductPage()) {
          console.log("EcoShop: Observer detected likely product content, attempting extraction");
          const productInfo = extractProductInfo();
          if (productInfo && (productInfo.brand || productInfo.name)) {
            sendToServiceWorker(productInfo);
          }
        }
      }
    }, 1000); // Wait 1 second after DOM changes before extracting
  };

  // Set up an observer to watch for important page changes
  window.ecoshopObserver = new MutationObserver((mutations) => {
    // Look for significant DOM changes that might indicate product content has loaded
    const significantChange = mutations.some(mutation => {
      // Check for added product-related elements
      if (mutation.addedNodes && mutation.addedNodes.length) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node contains product indicators
            if (node.querySelector) {
              const hasProductNodes = node.querySelector('.product-specs, .specifications, .description, .qPNIqx, .YPqix5');
              if (hasProductNodes) return true;
              
              // Check text content for common indicators
              if (node.textContent && 
                  (node.textContent.includes('Product Specifications') || 
                   node.textContent.includes('Brand') ||
                   node.textContent.includes('Category'))) {
                return true;
              }
            }
          }
        }
      }
      return false;
    });
    
    // If we detected significant changes, try extraction
    if (significantChange) {
      debouncedExtraction();
    }
  });

  // Start observing once the initial page is loaded
  setTimeout(() => {
    window.ecoshopObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true, // Watch for attribute changes too
      attributeFilter: ['class', 'id', 'style'], // Only these attributes matter for content loading
      characterData: false
    });
    console.log("EcoShop: Observer started");
  }, 2000);
  // Listen for fade out badge message
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fadeEcoShopBadge") {
      const badge = document.getElementById('ecoshop-sustainability-badge');
      if (badge) {
        badge.style.transition = 'opacity 0.5s cubic-bezier(0.4,0,0.2,1)';
        badge.style.opacity = '0';
        setTimeout(() => {
          if (badge.parentNode) badge.parentNode.removeChild(badge);
          // After fade out, re-evaluate if badge should be shown again
          // Only show badge if on a product page and settings allow
          setTimeout(async () => {
            const productInfo = extractProductInfo();
            if (productInfo && (productInfo.brand || productInfo.name)) {
              // Check if badge should be shown based on user settings
              const preferences = await getUserPreferences();
              if (preferences.showBadge) {
                sendToServiceWorker(productInfo);
              }
            }
          }, 100); // Short delay to allow DOM update
        }, 500);
      }
    }
  });
})();