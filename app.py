import json
import os
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import aiohttp
import pandas as pd
from asyncio import Semaphore
import math
import logging

from crypto_utils import encrypt_data, decrypt_data

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RateLimiter:
    """Rate limiter: 120 requests per 10 minutes"""
    def __init__(self, max_requests: int = 120, time_window: int = 600):
        self.max_requests = max_requests
        self.time_window = time_window  # 10 minutes in seconds
        self.requests = []
        self.lock = asyncio.Lock()
    
    async def acquire(self):
        async with self.lock:
            now = datetime.now()
            # Remove requests older than time_window
            self.requests = [
                req_time for req_time in self.requests 
                if (now - req_time).total_seconds() < self.time_window
            ]
            
            if len(self.requests) >= self.max_requests:
                # Calculate wait time
                oldest_request = min(self.requests)
                wait_time = self.time_window - (now - oldest_request).total_seconds()
                logger.warning(f"Rate limit reached. Waiting {wait_time:.2f} seconds...")
                await asyncio.sleep(wait_time + 1)
                # Clear old requests after waiting
                self.requests = []
            
            self.requests.append(now)


class TokenCache:
    """Thread-safe token cache"""
    def __init__(self):
        self.token: Optional[str] = None
        self.expires_at: Optional[datetime] = None
        self.lock = asyncio.Lock()
    
    async def get(self) -> Optional[str]:
        async with self.lock:
            if self.token and self.expires_at:
                if datetime.now() < self.expires_at:
                    return self.token
            return None
    
    async def set(self, token: str, expires_in_minutes: int = 120):
        async with self.lock:
            self.token = token
            self.expires_at = datetime.now() + timedelta(minutes=expires_in_minutes)


class FRIClient:
    """Async FRI API Client with rate limiting and error handling"""
    
    BASE_URL = "https://fritestgateway.sancharsaathi.gov.in/fri/v1"
    
    def __init__(self, key_id: str, max_retries: int = 3, timeout: int = 30):
        self.key_id = key_id
        self.max_retries = max_retries
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.token_cache = TokenCache()
        self.rate_limiter = RateLimiter()
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            timeout=self.timeout,
            connector=aiohttp.TCPConnector(verify_ssl=False)
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def _make_request(
        self, 
        method: str, 
        url: str, 
        **kwargs
    ) -> Dict[str, Any]:
        """Make HTTP request with retry logic"""
        await self.rate_limiter.acquire()
        
        for attempt in range(self.max_retries):
            try:
                async with self.session.request(method, url, **kwargs) as response:
                    response.raise_for_status()
                    return await response.json()
            
            except aiohttp.ClientResponseError as e:
                logger.error(f"HTTP {e.status} error on attempt {attempt + 1}/{self.max_retries}: {e.message}")
                if e.status == 429:  # Rate limit
                    wait_time = 2 ** attempt  # Exponential backoff
                    logger.warning(f"Rate limited. Waiting {wait_time}s before retry...")
                    await asyncio.sleep(wait_time)
                elif e.status >= 500:  # Server error
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        raise
                else:
                    raise
            
            except aiohttp.ClientError as e:
                logger.error(f"Request error on attempt {attempt + 1}/{self.max_retries}: {str(e)}")
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise
            
            except asyncio.TimeoutError:
                logger.error(f"Timeout on attempt {attempt + 1}/{self.max_retries}")
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise
        
        raise Exception(f"Failed after {self.max_retries} retries")
    
    async def authenticate(self) -> str:
        """Authenticate and get token"""
        # Check cache first
        cached_token = await self.token_cache.get()
        if cached_token:
            logger.info("Using cached token")
            return cached_token
        
        logger.info("Authenticating...")
        
        # Get credentials
        email = os.getenv("FRI_EMAIL")
        password = os.getenv("FRI_PASSWORD")
        
        if not email or not password:
            raise ValueError("FRI_EMAIL and FRI_PASSWORD environment variables required")
        
        payload = {
            "email": email,
            "password": password
        }
        
        encrypted_payload = encrypt_data(payload, self.key_id)
        
        headers = {"Content-Type": "application/json"}
        
        try:
            response = await self._make_request(
                "POST",
                f"{self.BASE_URL}/auth",
                json=encrypted_payload,
                headers=headers
            )
            
            token = response.get('token')
            if not token:
                raise ValueError("No token in response")
            
            await self.token_cache.set(token)
            logger.info("Authentication successful")
            return token
        
        except Exception as e:
            logger.error(f"Authentication failed: {str(e)}")
            raise
    
    async def get_count(self, date: str) -> Dict[str, Any]:
        """Get count for a specific date"""
        token = await self.authenticate()
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": token
        }
        
        body = {"date": date}
        
        try:
            response = await self._make_request(
                "POST",
                f"{self.BASE_URL}/count",
                json=body,
                headers=headers
            )
            logger.info(f"Count retrieved: {response.get('count', 0)}")
            return response
        
        except Exception as e:
            logger.error(f"Failed to get count: {str(e)}")
            raise
    
    async def get_data(
        self, 
        date: str, 
        client_id: str, 
        offset: int, 
        count: int
    ) -> Dict[str, Any]:
        """Get data batch"""
        token = await self.authenticate()
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": token
        }
        
        body = {
            "date": date,
            "client_id": client_id,
            "offset": offset,
            "count": count
        }
        
        try:
            response = await self._make_request(
                "POST",
                f"{self.BASE_URL}/data",
                json=body,
                headers=headers
            )
            return response
        
        except Exception as e:
            logger.error(f"Failed to get data at offset {offset}: {str(e)}")
            raise
    
    async def fetch_and_decrypt_batch(
        self,
        date: str,
        client_id: str,
        offset: int,
        batch_size: int,
        batch_num: int,
        total_batches: int
    ) -> List[Dict[str, Any]]:
        """Fetch and decrypt a single batch"""
        try:
            logger.info(f"Fetching batch {batch_num + 1}/{total_batches} (offset: {offset}, size: {batch_size})")
            
            encrypted_payload = await self.get_data(date, client_id, offset, batch_size)
            decrypted_batch = decrypt_data(encrypted_payload)
            
            records = []
            if isinstance(decrypted_batch, str):
                try:
                    decrypted_json = json.loads(decrypted_batch)
                    if isinstance(decrypted_json, dict) and "data" in decrypted_json:
                        records = decrypted_json["data"]
                    elif isinstance(decrypted_json, list):
                        records = decrypted_json
                    else:
                        logger.warning(f"Unexpected decrypted format in batch {batch_num + 1}")
                except json.JSONDecodeError as e:
                    logger.error(f"JSON decode error in batch {batch_num + 1}: {str(e)}")
            
            elif isinstance(decrypted_batch, list):
                records = decrypted_batch
            else:
                logger.warning(f"Unexpected batch type: {type(decrypted_batch)}")
            
            logger.info(f"Batch {batch_num + 1}/{total_batches} completed ({len(records)} records)")
            return records
        
        except Exception as e:
            logger.error(f"Error processing batch {batch_num + 1}: {str(e)}")
            raise
    
    async def fetch_all_data(
        self,
        date: str,
        client_id: str,
        total_count: int,
        batch_size: int = 3000,
        max_concurrent: int = 5
    ) -> List[Dict[str, Any]]:
        """Fetch all data with concurrent requests"""
        num_batches = math.ceil(total_count / batch_size)
        logger.info(f"Fetching {total_count} records in {num_batches} batches")
        
        all_data = []
        semaphore = Semaphore(max_concurrent)
        
        async def fetch_with_semaphore(batch_num: int, offset: int, size: int):
            async with semaphore:
                return await self.fetch_and_decrypt_batch(
                    date, client_id, offset, size, batch_num, num_batches
                )
        
        tasks = []
        for batch_num in range(num_batches):
            offset = batch_num * batch_size
            current_batch_size = min(batch_size, total_count - offset)
            
            task = fetch_with_semaphore(batch_num, offset, current_batch_size)
            tasks.append(task)
        
        # Gather all results
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Batch {i + 1} failed: {str(result)}")
            else:
                all_data.extend(result)
        
        logger.info(f"Fetched total of {len(all_data)} records")
        return all_data


def save_to_excel(data: List[Dict[str, Any]], filename, columns: List[str]):
    """Save data to Excel file"""
    if not data:
        logger.warning("No data to save")
        return
    
    try:
        df = pd.DataFrame(data)
        df = df.reindex(columns=columns)
        
        # Handle file-like objects
        if hasattr(filename, 'write'):
            df.to_excel(filename, index=False, engine='openpyxl')
        else:
            df.to_excel(filename, index=False)
        
        logger.info(f"Data saved successfully with {len(data)} rows")
    
    except Exception as e:
        logger.error(f"Error saving to Excel: {str(e)}")
        raise


# Backward compatible wrapper functions
async def fri_auth(key_id: str) -> str:
    """Get FRI auth token"""
    async with FRIClient(key_id) as client:
        return await client.authenticate()


async def fri_count(key_id: str, count_date: str) -> Dict[str, Any]:
    """Get record count"""
    async with FRIClient(key_id) as client:
        return await client.get_count(count_date)


async def fri_data(
    key_id: str, 
    count: int, 
    offset: int, 
    date: str, 
    client_id: str
) -> Dict[str, Any]:
    """Get single batch of data"""
    async with FRIClient(key_id) as client:
        return await client.get_data(date, client_id, offset, count)


async def fetch_and_decrypt_all(
    key_id: str,
    total_count: int,
    date: str,
    client_id: str,
    batch_size: int = 3000
) -> List[Dict[str, Any]]:
    """Fetch and decrypt all data"""
    async with FRIClient(key_id) as client:
        return await client.fetch_all_data(date, client_id, total_count, batch_size)