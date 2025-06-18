# ==============================================================================
# Part 1: Configuration
# ==============================================================================

# A single, standardized map for converting the LLM's ratings into numerical scores.
# The scale is from -1.0 (very bad) to 1.0 (very good).
RATING_SCORES = {
    'Excellent': 10,
    'Good': 8,
    'Neutral': 5,
    'Poor': 0,
    'Unknown': 3, # Penalize unknown, but not too much
}

import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('scorer')

# ==============================================================================
# Part 2: Scorer Functions
# ==============================================================================

def generate_sustainability_breakdown(analysis_json: dict) -> dict:
    """
    Extracts the new three-category breakdown structure from the LLM's analysis.
    This creates the rich object used for both display and calculation.

    Args:
        analysis_json: The full structured JSON object from the analyzer.

    Returns:
        A dictionary containing the detailed sustainability breakdown.
    """
    logger.info(f"Input to generate_sustainability_breakdown: {json.dumps(analysis_json, indent=2)}")
    breakdown = {}
    # The new analysis is nested under the 'sustainability_analysis' key
    sustainability_analysis = analysis_json.get('sustainability_analysis', {})
    logger.info(f"Extracted sustainability_analysis: {json.dumps(sustainability_analysis, indent=2)}")
    # Iterate through our three main categories
    for category, details in sustainability_analysis.items():
        rating = details.get('rating', 'Unknown')
        logger.debug(f"Processing category: {category}, rating: {rating}")
        breakdown[category] = {
            "value": rating,  # The qualitative rating (e.g., "Good")
            "score": RATING_SCORES.get(rating, 0.0), # The quantitative score
            "analysis": details.get('analysis', 'No analysis provided.')
        }
    logger.info(f"Generated breakdown: {json.dumps(breakdown, indent=2)}")
    return breakdown


def calculate_weighted_score(sustainability_breakdown: dict, user_weights: dict | None = None) -> int:
    """
    Calculates the final 0-100 score from the breakdown object. No weights are used; all fields are equally weighted.
    """
    total_score = 0
    count = 0
    for category, breakdown_details in sustainability_breakdown.items():
        score = breakdown_details.get('score', 3)  # Unknown is 3
        normalized_score = (score - 5) / 5  # 0->-1, 5->0, 10->1, 3->-0.4
        total_score += normalized_score
        count += 1
    if count == 0:
        return 50
    normalized_score = 50 + 50 * (total_score / count)
    return max(0, min(100, round(normalized_score)))  # Use round() instead of int() to properly round values)