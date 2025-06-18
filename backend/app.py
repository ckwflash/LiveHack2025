#!/usr/bin/env python3
"""
Backend API for EcoShop sustainability data - Simplified

This Flask API receives product data from the EcoShop browser extension
and forwards it to the shopee_processor.py script for analysis.
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import os
import logging
from datetime import datetime, timezone 
import re

# Attempt to import the processor
try:
    from scripts.shopee_processor import process_shopee_product
    PROCESSOR_AVAILABLE = True
except ImportError as e:
    PROCESSOR_AVAILABLE = False
    PROCESSOR_IMPORT_ERROR = str(e)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('ecoshop_simplified_api')

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# --- MINIMAL LOGGING FOR EXTENSION REQUESTS ---
@app.before_request
def log_extension_payload():
    # Log only for the specific endpoint we care about
    if request.path == '/extract_and_rate':
        payload_to_log = ""
        if request.is_json:
            try:
                payload_to_log = json.dumps(request.get_json(silent=True) or {}, separators=(',', ':'))
            except Exception as e:
                payload_to_log = "[Could not parse JSON payload]"
                logger.error(f"Error parsing JSON payload: {e}")
        else:
            try:
                payload_to_log = request.get_data(as_text=True).strip()
            except Exception as e:
                payload_to_log = "[Could not decode text payload]"
                logger.error(f"Error decoding text payload: {e}")
        logger.info(f'EXT_PAYLOAD {request.path} ({request.content_type}): {payload_to_log[:1000]}...') # Log more of the payload

@app.route('/extract_and_rate', methods=['POST'])
def extract_and_rate_product():
    """
    Main endpoint for browser extension.
    Receives product info, writes it to entry.txt, and forwards to shopee_processor.
    """
    logger.info(f"--- /extract_and_rate: NEW REQUEST ---")
    entry_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'entry.txt')
    
    raw_text_content = None
    product_url = None # Initialize product_url

    try:
        # 1. Log raw request and write to entry.txt
        raw_data_bytes = request.get_data()
        try:
            # Try to decode as UTF-8 first
            raw_text_content = raw_data_bytes.decode('utf-8', errors='strict')
            logger.info(f"Successfully decoded request body as UTF-8.")
        except UnicodeDecodeError:
            logger.warning("Failed to decode request body as UTF-8, trying 'latin-1' as fallback.")
            try:
                raw_text_content = raw_data_bytes.decode('latin-1', errors='replace') # Common fallback
            except Exception as decode_err:
                logger.error(f"Could not decode request body with any known encoding: {decode_err}")
                # Write raw bytes to entry.txt if all decoding fails
                with open(entry_file_path, 'wb') as f_bytes:
                    f_bytes.write(b"Request Content-Type: " + request.content_type.encode('utf-8', 'replace') + b"\n")
                    f_bytes.write(b"Request Headers:\n" + json.dumps(dict(request.headers), indent=2).encode('utf-8', 'replace') + b"\n\n")
                    f_bytes.write(b"--- RAW BYTE CONTENT (DECODING FAILED) ---\n")
                    f_bytes.write(raw_data_bytes)
                logger.info(f"Raw request byte data written to {entry_file_path} due to decoding error.")
                return jsonify({'success': False, 'error': 'Request body encoding error'}), 400

        # Write decoded content (or indicate if it's None) to entry.txt
        with open(entry_file_path, 'w', encoding='utf-8', errors='replace') as f:
            f.write(f"Request Content-Type: {request.content_type}\n")
            f.write(f"Request Headers:\n{json.dumps(dict(request.headers), indent=2)}\n\n")
            f.write("--- RAW TEXT CONTENT (DECODED) ---\n")
            if raw_text_content is not None:
                f.write(raw_text_content)
            else:
                f.write("[No text content could be decoded or was empty]")
        logger.info(f"Request data (decoded) written to {entry_file_path}")

        # 2. Basic parsing for product_url from raw_text_content if it's plain text
        # This is a simplified parsing, shopee_processor will do the detailed one.
        if raw_text_content and 'text/plain' in request.content_type:
            url_match = re.search(r"URL: (https?://[^\s]+)", raw_text_content)
            if url_match:
                product_url = url_match.group(1).strip()
                logger.info(f"Parsed product_url from plain text: {product_url}")
        elif request.is_json:
            json_data = request.get_json(silent=True)
            if json_data and isinstance(json_data, dict):
                product_url = json_data.get('url')
                if not raw_text_content: # If JSON was primary and no plain text sent
                    raw_text_content = json_data.get('plainText') # As sent by some versions of extension
                logger.info(f"Parsed product_url from JSON: {product_url}")


        # 3. Check if processor is available
        if not PROCESSOR_AVAILABLE:
            logger.error(f"Shopee Processor not available due to import error: {PROCESSOR_IMPORT_ERROR}")
            return jsonify({
                'success': False, 
                'error': 'Backend processor module is not available.',
                'details': PROCESSOR_IMPORT_ERROR
            }), 503 # Service Unavailable

        # 4. Forward to shopee_processor
        start_time = datetime.now(timezone.utc)
        logger.info(f"--- CALLING Shopee Processor ---")
        logger.info(f"Passing to process_shopee_product - URL: {product_url or 'Not provided'}")
        logger.info(f"Passing to process_shopee_product - Text Length: {len(raw_text_content) if raw_text_content else 0}")
        
        # Ensure raw_text_content is not None before passing
        if raw_text_content is None:
            logger.error("Cannot call processor: raw_text_content is None after decoding attempts.")
            return jsonify({'success': False, 'error': 'Failed to decode request content for processor.'}), 400

        processed_result = process_shopee_product(
            url=product_url, # Can be None
            raw_text=raw_text_content # Should be a string
        )
        
        if not processed_result:
            logger.warning("Product processing by shopee_processor failed or returned no data.")
            return jsonify({
                'success': False,
                'error': 'Product analysis by shopee_processor failed.'
            }), 500
        
        processing_time_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
          # 5. Prepare and send response
        # The structure of 'result' should match what the extension expects
        # Based on previous logs, it seems shopee_processor returns a dict that can be directly used.
          # Debug the score extraction - check all possible score field names
        sustainability_score = processed_result.get('sustainability_score')
        alt_score = processed_result.get('score')
        default_score = processed_result.get('default_sustainability_score')
        
        logger.info(f"DEBUG: sustainability_score from processor: {sustainability_score}")
        logger.info(f"DEBUG: alt score field: {alt_score}")
        logger.info(f"DEBUG: default_sustainability_score: {default_score}")
        logger.info(f"DEBUG: processed_result keys: {list(processed_result.keys())}")
        
        # Use the first available score, prioritizing sustainability_score
        final_score = sustainability_score if sustainability_score is not None else (alt_score if alt_score is not None else (default_score if default_score is not None else 0))
        logger.info(f"DEBUG: Final score being sent to frontend: {final_score}")
        
        final_response_data = {
            'url': product_url or processed_result.get('url'), # Prioritize initially parsed URL
            'brand': processed_result.get('brand', 'Unknown'),
            'brand_name': processed_result.get('brand', 'Unknown'),  # For consistency with frontend
            'name': processed_result.get('product_name', processed_result.get('name', 'Unknown')),
            'category': processed_result.get('category', 'Unknown'),
            'score': final_score,
            'breakdown': processed_result.get('sustainability_breakdown', {}),
            'sustainability_breakdown': processed_result.get('sustainability_breakdown', {}),  # For consistency
            'recommendations': processed_result.get('recommendations', []),
            'raw_llm_response': processed_result.get('raw_llm_response', None), # For debugging LLM
            'processing_time_ms': processing_time_ms,
            'timestamp': datetime.now(timezone.utc).isoformat() + 'Z'
        }
        
        logger.info(f"--- FINAL RESPONSE TO EXTENSION (from shopee_processor) ---")
        logger.info(f"RESPONSE JSON: {json.dumps({'success': True, 'data': final_response_data}, indent=2)}")
        
        # Additional detailed logging for recommendations debugging
        if final_response_data.get('recommendations'):
            logger.info(f"=== RECOMMENDATIONS DETAILED LOGGING ===")
            logger.info(f"Number of recommendations: {len(final_response_data['recommendations'])}")
            for i, rec in enumerate(final_response_data['recommendations']):
                logger.info(f"Recommendation {i+1}: {json.dumps(rec, indent=2, default=str)}")
        else:
            logger.info("=== NO RECOMMENDATIONS IN RESPONSE ===")
            
        return jsonify({'success': True, 'data': final_response_data})

    except Exception as e:
        logger.error(f"CRITICAL ERROR in /extract_and_rate: {str(e)}", exc_info=True)
        # Also write the exception to entry.txt for easier debugging
        try:
            with open(entry_file_path, 'a', encoding='utf-8') as f_err: # Append mode
                f_err.write("\n\n--- SERVER EXCEPTION ---\n")
                import traceback
                f_err.write(traceback.format_exc())
        except Exception as e_file_err:
            logger.error(f"Could not write exception to entry.txt: {e_file_err}")
            
        return jsonify({'success': False, 'error': f'An internal server error occurred: {str(e)}'}), 500

@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
def catch_all(path):
    logger.info(f"Catch-all route hit for path: {path}, method: {request.method}")
    return jsonify({"status": "EcoShop Simplified API is running. Use /extract_and_rate for analysis.", "path_requested": path}), 200

if __name__ == '__main__':
    # Check if shopee_processor was imported correctly
    if not PROCESSOR_AVAILABLE:
        logger.error("CRITICAL: `shopee_processor.py` could not be imported.")
        logger.error(f"Import Error Details: {PROCESSOR_IMPORT_ERROR}")
        logger.error("The API will start, but /extract_and_rate will fail until this is resolved.")
    else:
        logger.info("`shopee_processor.py` imported successfully.")

    port = int(os.environ.get('PORT', 5000))
    logger.info(f"EcoShop Simplified Flask app starting on host 0.0.0.0, port {port}")
    # Turn off reloader for cleaner logs if not actively developing app.py itself
    app.run(host='0.0.0.0', port=port, debug=True, use_reloader=False)