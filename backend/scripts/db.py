# db.py
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import certifi
import ssl
import logging

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('db')

# Import configuration variables from config.py (same directory)
try:
    logger.info("Attempting to import config from db.py...")
    import os
    logger.debug(f"db.py current working directory: {os.getcwd()}")
    logger.debug(f"db.py file location: {os.path.abspath(__file__)}")
    logger.debug(f"db.py directory: {os.path.dirname(os.path.abspath(__file__))}")
    from config import MONGO_URI, MONGO_PRODUCTS_COLLECTION, MONGO_DB
    logger.info("Config import successful in db.py")
except ImportError as e:
    logger.error(f"ImportError in db.py: {e}")
    logger.error("Error: config.py not found or missing required variables.")
    # Set to None so the application can gracefully handle the missing config
    MONGO_URI = None
    MONGO_DB = None
    MONGO_PRODUCTS_COLLECTION = None

# Global variable to hold the collection object
products_collection = None

def connect_to_db():
    """
    Establishes a connection to the MongoDB database and returns the collection object.
    """
    global products_collection

    if MONGO_URI and MONGO_DB and MONGO_PRODUCTS_COLLECTION:
        try:
            # Create a new client and connect to the server
            client = MongoClient(MONGO_URI, tls=True, tlsCAFile=certifi.where())
            logger.info("MongoClient created.")

            # Send a ping to confirm a successful connection
            client.admin.command('ping')
            logger.info("Pinged your deployment. You successfully connected to MongoDB!")

            # Get the database and collection
            db = client[MONGO_DB]
            products_collection = db[MONGO_PRODUCTS_COLLECTION]
            logger.info(f"Ensuring unique index exists on collection: '{MONGO_PRODUCTS_COLLECTION}'...")
            products_collection.create_index([("source_site", 1), ("listing_id", 1)], unique=True)
            logger.info("Index is ready.")

            return products_collection

        except ConnectionFailure as e:
            logger.error(f"Could not connect to MongoDB: {e}")
            return None
        except Exception as e:
            logger.error(f"An error occurred: {e}")
            return None
    else:
        logger.error("Missing MongoDB configuration variables.")
        return None

# Initialize the connection when this module is imported
products_collection = connect_to_db()