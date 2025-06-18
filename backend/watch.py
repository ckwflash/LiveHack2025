#!/usr/bin/env python3
"""
MongoDB Change Streams helper for real-time task monitoring.
Replaces polling with efficient push-based updates.
"""

import json
import time
import logging
from typing import Generator, Optional, Dict, Any
from bson import ObjectId
from pymongo import MongoClient
from pymongo.errors import PyMongoError

logger = logging.getLogger(__name__)


def stream_task_changes(
    mongo_client: MongoClient, 
    db_name: str, 
    collection_name: str, 
    task_id: str,
    timeout_seconds: int = 300
) -> Generator[str, None, None]:
    """
    Stream changes for a specific task using MongoDB Change Streams.
    
    Args:
        mongo_client: MongoDB client instance
        db_name: Database name
        collection_name: Collection name (e.g., 'tasks')
        task_id: Task ID to monitor
        timeout_seconds: Maximum time to keep stream open
        
    Yields:
        SSE-formatted strings for client consumption
    """
    try:
        logger.info(f"Starting stream_task_changes for task_id={task_id}")
        # Convert string ID to ObjectId
        try:
            object_id = ObjectId(task_id)
        except Exception as e:
            logger.error(f"Invalid task ID: {task_id}")
            yield f"event: error\ndata: {json.dumps({'error': 'Invalid task ID'})}\n\n"
            return
        
        db = mongo_client[db_name]
        collection = db[collection_name]
        
        # Check if task exists
        task = collection.find_one({"_id": object_id})
        if not task:
            logger.warning(f"Task not found: {task_id}")
            yield f"event: error\ndata: {json.dumps({'error': 'Task not found'})}\n\n"
            return
        
        # If task is already done, send immediate completion
        if task.get('status') in ['done', 'error']:
            logger.info(f"Task {task_id} already completed with status: {task.get('status')}")
            yield f"event: done\ndata: {json.dumps(task, default=str)}\n\n"
            return
        
        # Send initial state
        logger.info(f"Sending initial state for task {task_id}")
        yield f"event: status\ndata: {json.dumps(task, default=str)}\n\n"
        
        # Create change stream pipeline to watch this specific task
        pipeline = [
            {
                '$match': {
                    'fullDocument._id': object_id,
                    'operationType': {'$in': ['insert', 'update', 'replace']}
                }
            }
        ]
        
        start_time = time.time()
        last_ping = time.time()
        
        with collection.watch(pipeline, full_document='updateLookup') as stream:
            logger.info(f"Started change stream for task {task_id}")
            
            while stream.alive and (time.time() - start_time) < timeout_seconds:
                try:
                    # Non-blocking check for changes
                    change = stream.try_next()
                    
                    if change is not None:
                        document = change['fullDocument']
                        logger.info(f"Change detected for task {task_id}: {document.get('status')}")
                        
                        # Send the updated document
                        yield f"event: update\ndata: {json.dumps(document, default=str)}\n\n"
                        
                        # If task is complete, send done event and exit
                        if document.get('status') in ['done', 'error']:
                            yield f"event: done\ndata: {json.dumps(document, default=str)}\n\n"
                            break
                    
                    # Send keep-alive ping every 15 seconds
                    if time.time() - last_ping > 15:
                        yield f"event: ping\ndata: {json.dumps({'timestamp': int(time.time())})}\n\n"
                        last_ping = time.time()
                    
                    # Small sleep to prevent tight loop
                    time.sleep(0.5)
                    
                except Exception as e:
                    logger.error(f"Error in change stream: {str(e)}")
                    yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
                    break
        
        logger.info(f"Change stream ended for task {task_id}")
        
    except PyMongoError as e:
        logger.error(f"MongoDB error in change stream: {str(e)}")
        yield f"event: error\ndata: {json.dumps({'error': f'Database error: {str(e)}'})}\n\n"
    except Exception as e:
        logger.error(f"Unexpected error in change stream: {str(e)}")
        yield f"event: error\ndata: {json.dumps({'error': f'Unexpected error: {str(e)}'})}\n\n"


def create_task_document(
    product_name: str,
    brand: str,
    price: Optional[str] = None,
    url: Optional[str] = None,
    raw_html: Optional[str] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    Create a standardized task document for MongoDB.
    
    Args:
        product_name: Product name from Shopee
        brand: Brand name
        price: Product price string
        url: Product URL
        raw_html: Raw HTML for analysis
        **kwargs: Additional metadata
        
    Returns:
        Task document ready for MongoDB insertion
    """
    now = time.time()
    
    return {
        "productName": product_name,
        "brand": brand,
        "price": price,
        "url": url,
        "rawHtml": raw_html,
        "status": "new",
        "score": None,
        "summary": None,
        "createdAt": now,
        "updatedAt": now,
        "metadata": kwargs
    }


def update_task_status(
    mongo_client: MongoClient,
    db_name: str,
    collection_name: str,
    task_id: str,
    status: str,
    **update_fields
) -> bool:
    """
    Update task status and other fields.
    
    Args:
        mongo_client: MongoDB client
        db_name: Database name
        collection_name: Collection name
        task_id: Task ID to update
        status: New status ('processing', 'done', 'error')
        **update_fields: Additional fields to update (score, summary, etc.)
        
    Returns:
        True if update was successful
    """
    try:
        object_id = ObjectId(task_id)
        db = mongo_client[db_name]
        collection = db[collection_name]
        
        update_doc = {
            "status": status,
            "updatedAt": time.time(),
            **update_fields
        }
        
        result = collection.update_one(
            {"_id": object_id},
            {"$set": update_doc}
        )
        
        return result.modified_count > 0
        
    except Exception as e:
        logger.error(f"Error updating task {task_id}: {str(e)}")
        return False
