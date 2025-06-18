# utils.py - Utility functions for the EcoShop backend
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('utils')

def clean_specifications(specs):
    """Remove review and rating text from product specifications."""
    logger.debug(f"Cleaning specifications: {specs}")
    if isinstance(specs, dict):
        cleaned = {}
        for k, v in specs.items():
            # Remove keys that are obviously reviews/ratings
            if any(word in k.lower() for word in ["review", "rating", "comment", "report abuse", "5.0 out of 5", "star", "media", "helpful?"]):
                logger.info(f"Removed key from specs: {k}")
                continue
            # Remove values that contain review/rating patterns
            if isinstance(v, str):
                lower_v = v.lower()
                if any(word in lower_v for word in ["review", "ratings", "comments", "report abuse", "5.0 out of 5", "star", "media", "helpful?"]):
                    for word in ["review", "ratings", "comments", "report abuse", "5.0 out of 5", "star", "media", "helpful?"]:
                        idx = lower_v.find(word)
                        if idx != -1:
                            logger.info(f"Truncated value for key {k} at word '{word}'")
                            v = v[:idx]
                            break
                cleaned[k] = v.strip()
            else:
                cleaned[k] = v
        logger.debug(f"Cleaned dict specs: {cleaned}")
        return cleaned
    elif isinstance(specs, str):
        lower_s = specs.lower()
        for word in ["review", "ratings", "comments", "report abuse", "5.0 out of 5", "star", "media", "helpful?"]:
            idx = lower_s.find(word)
            if idx != -1:
                logger.info(f"Truncated string specs at word '{word}'")
                return specs[:idx].strip()
        return specs
    return specs

def generate_sustainability_advice(factors: dict) -> dict:
    """Generate specific advice based on sustainability factors."""
    logger.debug(f"Generating advice for factors: {factors}")
    advice = {}
    if factors.get('co2e', 0) > 7:
        advice['co2e'] = "Consider reducing carbon emissions through supply chain optimizations and renewable energy."
        logger.info("Added CO2e advice.")
    if factors.get('water_usage', 0) > 7:
        advice['water'] = "Implement water conservation practices in manufacturing and processing."
        logger.info("Added water usage advice.")
    if factors.get('waste', 0) > 7:
        advice['waste'] = "Develop circular economy practices and reduce packaging waste."
        logger.info("Added waste advice.")
    if factors.get('labor', 10) < 5:
        advice['labor'] = "Improve labor conditions and ensure fair wages throughout the supply chain."
        logger.info("Added labor advice.")
    if factors.get('recycled_materials', 0) < 30:
        advice['materials'] = "Increase use of recycled and sustainably sourced materials."
        logger.info("Added recycled materials advice.")
    logger.debug(f"Generated advice: {advice}")
    return advice
