# scripts/analyzer.py (With Dynamic Category Extraction)

import json
import google.generativeai as genai
from google.generativeai.types import Tool, FunctionDeclaration
import sys
import os
import logging

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('analyzer')

# --- Path Correction and Config Import ---
try:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, project_root)
    # --- CHANGE HERE: We no longer need to import APP_CATEGORIES ---
    from config import GOOGLE_API_KEY
    logger.info("Successfully imported config variables.")
except ImportError:
    logger.critical("CRITICAL: Could not import GOOGLE_API_KEY from config.py.")
    sys.exit(1)

# --- Configure Google AI Client ---
try:
    genai.configure(api_key=GOOGLE_API_KEY)
    logger.info("Google AI client configured.")
except Exception as e:
    logger.critical(f"CRITICAL: Failed to configure Google AI. Error: {e}")
    sys.exit(1)

# --- Define the Tools ---

# Tool 1: Google Search (for information gathering)
google_search_tool = FunctionDeclaration(
    name="google_search",
    description="Performs a Google search to find public information about a company's sustainability practices or product materials.",
    parameters={
        "type": "object",
        "properties": {"query": {"type": "string", "description": "A specific search query."}},
        "required": ["query"]
    }
)

# Tool 2: The Final Answer Formatter (for structured output)
analysis_submission_tool = FunctionDeclaration(
    name="submit_sustainability_analysis",
    description="Submits the complete, final sustainability analysis once all information has been gathered and synthesized.",
    parameters={
        "type": "object",
        "properties": {
            "product_name": {"type": "string", "description": "The main title of the product, from the provided text."},
            "brand": {"type": "string", "description": "The brand name of the product, from the provided text."},
            "category": {
                "type": "string",
                "description": "The product's most specific category, derived directly from the provided text. Follow these rules strictly: 1. **Prioritize a structured path**: Look for a 'Category > ... > ...' breadcrumb trail at the start of the text and use the most specific term (e.g., 'Sneakers'). 2. **Fallback to Title**: If no structured path exists, infer the category from the product's main title. 3. **Aggressively Ignore**: You MUST ignore any text related to 'shop ratings', 'specifications', 'reviews', 'size charts', and 'shipping information' when determining the category. If no category can be reliably determined from the title or path, and only then, use 'Unknown'."
            },
            "sustainability_analysis": {
                "type": "object",
                "properties": {
                    "material_composition": {
                        "type": "object",
                        "properties": {
                            "analysis": {"type": "string"}, "rating": {"type": "string", "enum": ["Excellent", "Good", "Neutral", "Poor", "Unknown"]}, "reasoning": {"type": "string"}
                        },
                        "required": ["analysis", "rating", "reasoning"]
                    },
                    "production_and_brand": {
                        "type": "object",
                        "properties": {
                            "analysis": {"type": "string"}, "rating": {"type": "string", "enum": ["Excellent", "Good", "Neutral", "Poor", "Unknown"]}, "reasoning": {"type": "string"}
                        },
                        "required": ["analysis", "rating", "reasoning"]
                    },
                    "circularity_and_end_of_life": {
                        "type": "object",
                        "properties": {
                            "analysis": {"type": "string"}, "rating": {"type": "string", "enum": ["Excellent", "Good", "Neutral", "Poor", "Unknown"]}, "reasoning": {"type": "string"}
                        },
                        "required": ["analysis", "rating", "reasoning"]
                    }
                },
                "required": ["material_composition", "production_and_brand", "circularity_and_end_of_life"]
            }
        },
        "required": ["product_name", "brand", "category", "sustainability_analysis"]
    }
)

model = genai.GenerativeModel(
    model_name='gemini-2.5-flash-preview-05-20', 
    tools=[google_search_tool, analysis_submission_tool]
)


def get_full_product_analysis(raw_text: str) -> dict | None:
    """
    Analyzes raw text using Gemini with Google Search and forces a structured
    output via function calling.
    """
    # The prompt now focuses on telling the model its goal: call the submission function.
    prompt = f"""
    Your task is to analyze the following product information.
    First, use the provided text.
    Then, use your `google_search` tool to find any missing information, especially about the brand's reputation, labor practices, and specific material details.
    Once you have gathered and synthesized all the information, you MUST call the `submit_sustainability_analysis` function with the complete, final analysis.    Here is the product text dump:
    ---
    {raw_text}
    ---
    """

    try:
        # We force the model to call our submission tool, which guarantees a structured output
        response = model.generate_content(
            prompt,
            tool_config={'function_calling_config': {'mode': 'any', 'allowed_function_names': ['submit_sustainability_analysis']}}
        )
        
        # The result is not in response.text, but in the function_calls part of the response
        function_call = response.candidates[0].content.parts[0].function_call
        
        if function_call.name == "submit_sustainability_analysis":
            # The arguments of the function call are our structured data!
            analysis_args = function_call.args
            
            # Helper function to recursively convert MapComposite objects to regular dicts
            def convert_to_dict(obj):
                if hasattr(obj, '__iter__') and hasattr(obj, 'keys'):
                    # This is a MapComposite or similar dict-like object
                    return {key: convert_to_dict(value) for key, value in obj.items()}
                elif isinstance(obj, (list, tuple)):
                    # This is a list or tuple
                    return [convert_to_dict(item) for item in obj]
                else:
                    # This is a primitive value
                    return obj
            
            # Convert the arguments (which are in a special format) to a standard Python dictionary
            final_json = {
                "product_name": convert_to_dict(analysis_args.get("product_name")),
                "brand": convert_to_dict(analysis_args.get("brand")),
                "category": convert_to_dict(analysis_args.get("category")),
                "sustainability_analysis": convert_to_dict(analysis_args.get("sustainability_analysis")),
            }
            logger.info(f"LLM final_json output: {json.dumps(final_json, indent=2)}")
            return final_json
        else:
            raise ValueError("LLM did not call the expected submission function.")

    except Exception as e:
        logger.error(f"An error occurred during Google Gemini API analysis: {e}", exc_info=True)
        return {
            "error": "LLM analysis failed.",            "details": str(e)
        }