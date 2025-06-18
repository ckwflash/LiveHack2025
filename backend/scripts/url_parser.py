# scripts/url_parser.py (Robust, re-based Version)

import re
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('url_parser')

def parse_shopee_url(url: str) -> dict | None:
    """
    Parses a Shopee product URL robustly using regular expressions.

    This method is not "hardcoded" to a specific URL structure because it
    searches for the unique ID pattern (`i.shopId.itemId`) anywhere in the URL string.

    Args:
        url: The full Shopee product URL.

    Returns:
        A dictionary with parsed components:
        {
            "source_site": "shopee.sg",
            "listing_id": "shopId_itemId",
        }
        Returns None if the URL is not a valid or recognizable Shopee product URL.
    """
    if not url:
        logger.warning("No URL provided to parse_shopee_url.")
        return None

    try:
        # --- 1. Extract the hostname (e.g., 'shopee.sg') using string splitting ---
        # This part is simple enough that a regex is overkill.
        # It handles 'http://' and 'https://'
        domain_part = url.split('//')[1]
        source_site = domain_part.split('/')[0]

        # Ensure it's a valid Shopee domain
        if 'shopee' not in source_site:
            logger.warning(f"URL does not contain a valid Shopee domain: {url}")
            return None

        # --- 2. Define a regular expression to find the Shopee ID pattern ---
        # Pattern Breakdown:
        #   i\.          - Matches the literal characters "i."
        #   (\d+)        - This is a "capturing group" that matches one or more digits (the shopId)
        #   \.           - Matches the literal "."
        #   (\d+)        - A second capturing group for one or more digits (the itemId)
        pattern = r"i\.(\d+)\.(\d+)"

        # --- 3. Search for the pattern in the entire URL string ---
        match = re.search(pattern, url)

        # --- 4. If a match is found, extract the captured groups ---
        if match:
            shop_id = match.group(1)  # The first captured group (shopId)
            item_id = match.group(2)  # The second captured group (itemId)
            
            # Create our clean, composite ID for the database
            composite_listing_id = f"{shop_id}_{item_id}"
            
            logger.info(f"Parsed Shopee URL: source_site={source_site}, listing_id={composite_listing_id}")
            return {
                "source_site": source_site,
                "listing_id": composite_listing_id,
            }
        
        logger.warning(f"No valid Shopee ID pattern found in URL: {url}")
        return None

    except Exception as e:
        logger.error(f"Error parsing Shopee URL: {e}")
        return None

# This block allows you to test the file directly by running `python url_parser.py`
if __name__ == '__main__':
    print("--- Testing robust url_parser.py (re version) ---")
    
    test_urls = [
        # Standard URL with query parameters
        "https://shopee.sg/-NEW-PUMA-Unisex-Shuffle-Shoes-(White)-i.341363989.24033132727?sp_atk=123",
        # URL where the ID is NOT at the end (proves robustness)
        "https://shopee.co.id/Some-Product-Name-i.987654321.1234567890/similar?from=ads",
        # Invalid Shopee URL format
        "https://shopee.ph/product/12345/67890",
        # Not a Shopee URL
        "https://www.google.com"
    ]
    
    for url in test_urls:
        print(f"\nParsing URL: {url}")
        result = parse_shopee_url(url)
        if result:
            print(f"  ✅ Success: {result}")
        else:
            print("  ❌ Failed or Invalid Format")