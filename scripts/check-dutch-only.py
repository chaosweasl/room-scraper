#!/usr/bin/env python3
"""
Dutch-Only Listing Checker
==========================
Reads the room-scraper SQLite database, fetches each listing's full page,
checks for Dutch-only language requirements using structured data (Kamernet)
and text analysis (all platforms).

Usage:
  python3.11 scripts/check-dutch-only.py [--db path/to/housing.db] [--max N] [--format json|table]

Output: JSON with each listing flagged dutch_only=True/False + reason.
The cron uses this to filter out Dutch-only listings from the report.
"""

import sqlite3
import os
import sys
import json
import re
import time
import argparse
import urllib.request
import urllib.error
import ssl
import gzip
import io

# --- Configuration ---
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "housing.db")
MAX_CHECK = 80
FETCH_TIMEOUT = 12
RATE_LIMIT_DELAY = 0.8  # Seconds between fetches

# Language ID map for Kamernet __NEXT_DATA__
# Based on observation: 1 = Dutch, other IDs likely include English
# We need to fetch the page to inspect what IDs are available
LANG_ID_DUTCH = 1


def extract_kamernet_language_ids(html: str) -> dict:
    """
    Extract structured language requirement data from Kamernet's __NEXT_DATA__.
    Returns: {
        "desired_languages": [int],
        "current_languages": [int],
        "has_language_data": bool
    }
    """
    result = {"desired_languages": [], "current_languages": [], "has_language_data": False}
    
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if not match:
        return result
    
    try:
        data = json.loads(match.group(1))
        details = data.get("props", {}).get("pageProps", {}).get("targetPageProps", {}).get("listingDetails", {})
        
        desired = details.get("desiredTenantLanguagesSpokenID")
        current = details.get("currentResidentsLanguagesSpokenID")
        
        if desired is not None:
            result["desired_languages"] = desired
            result["has_language_data"] = True
        if current is not None:
            result["current_languages"] = current
            
        return result
    except (json.JSONDecodeError, KeyError, TypeError):
        return result


def check_kamernet_via_api(html: str) -> tuple:
    """
    Check Kamernet listing via structured __NEXT_DATA__ language IDs.
    Returns (is_dutch_only, confidence, reason).
    """
    lang_data = extract_kamernet_language_ids(html)
    if not lang_data["has_language_data"]:
        # Fall back to text analysis
        return None
    
    desired = lang_data["desired_languages"]
    
    # If only language ID 1 (Dutch) is listed as desired, it's Dutch-only
    if desired == [LANG_ID_DUTCH]:
        return (True, 0.95, "kamernet_language_id_dutch_only")
    
    # If desired languages include more than just Dutch, it's open
    if len(desired) > 0 and LANG_ID_DUTCH not in desired:
        # They don't even list Dutch — probably international-friendly
        return (False, 0.8, "kamernet_no_dutch_requirement")
    
    if len(desired) > 1:
        return (False, 0.9, f"kamernet_multi_language_{desired}")
    
    return None  # Can't determine from API alone


# Dutch-only text signals for non-Kamernet pages
DUTCH_ONLY_PATTERNS = [
    r'\bonly\s+[Dd]utch\b',
    r'\b[Dd]utch\s+only\b',
    r'\ballen\s+[Nn]ederlands\b',
    r'[Nn]ederlands\s+alleen\b',
    r'[Nn]ederlandstalig\b',
    r'[Dd]utch[- ]?speaking\b',
    r'[Nn]ederlands\s+sprekend\b',
    r'[Mm]oet\s+[Nn]ederlands\s+(spreken|kunnen)\b',
    r'[Mm]ust\s+speak\s+[Dd]utch\b',
    r'[Dd]utch\s+language\s+(required|only)\b',
    r'[Nn]ederlandse\s+taal\s+(vereist|verplicht|nodig)\b',
    r'[Vv]oertaal\s+is\s+[Nn]ederlands\b',
    r'[Gg]een\s+[Ee]ngels\b',
    r'[Nn]o\s+[Ee]nglish\b',
    r'[Bb]eheersing\s+van\s+de\s+[Nn]ederlandse\s+taal\b',
    r'[Nn]ederlands\s+(spreken|praten)\s+(we|wij)\b',
    r'[Ww]e\s+speak\s+[Dd]utch\b',
    r'[Ss]amen\s+[Nn]ederlands\s+(spreken|praten)\b',
    r'[Dd]utch\s+[Ss]tudenten?\b',
    r'[Nn]ederlandse\s+[Ss]tudenten?\b',
    r'[Ee]nkel\s+[Nn]ederlandstalig\b',
    r'[Ww]e\s+zijn\s+een\s+[Nn]ederlands\s+(huis|studentenhuis|gezin)\b',
    r'[Nn]ederlandse?\s+(cultuur|gezelligheid|traditie)\b',
]

INTERNATIONAL_PATTERNS = [
    r'[Ee]nglish[- ]?speaking\b',
    r'[Ss]peak\s+[Ee]nglish\b',
    r'[Ee]ngels\s+sprekend\b',
    r'[Ii]nternational\s+students?\s+(welcome|encouraged|accepted)\b',
    r'[Ii]nternationals?\s+(welcome|accepted|encouraged)\b',
    r'[Ee]ngels\s+(is\s+)?(prima|ok|goed|geen\s+probleem)\b',
    r'[Ee]nglish\s+(is\s+)?(fine|ok|welcome|no\s+problem)\b',
    r'[Ii]nternational\s+(environment|house|home|atmosphere)\b',
    r'[Ee]ngelstalig\b',
    r'[Ww]e\s+speak\s+[Ee]nglish\b',
    r'[Ww]ij\s+spreken\s+[Ee]ngels\b',
    r'[Ii]nternationals?\b',
    r'[Oo]pen\s+to\s+[Ii]nternationals?\b',
    r'[Tt]aal\s+maakt\s+niet\s+uit\b',
    r'[Ll]anguage\s+(does not|doesn\'t\s+)?(matter|not\s+important)\b',
]


def fetch_page_text(url: str) -> str | None:
    """Fetch a URL and return the raw HTML. Returns None on failure."""
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
        }
    )
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        resp = urllib.request.urlopen(req, timeout=FETCH_TIMEOUT, context=ctx)
        raw = resp.read()
        
        # Handle gzip decompression
        content_encoding = resp.headers.get('Content-Encoding', '')
        if 'gzip' in content_encoding:
            buf = io.BytesIO(raw)
            with gzip.GzipFile(fileobj=buf) as f:
                html = f.read().decode('utf-8', errors='replace')
        else:
            html = raw.decode('utf-8', errors='replace')
        
        return html
    except urllib.error.HTTPError as e:
        # Marktplaats often returns 410 for listing detail pages
        if e.code in (410, 403, 404):
            return None
        return None
    except Exception as e:
        return None


def check_text_for_dutch_only(html: str, title: str, description: str) -> tuple:
    """
    Check listing text for Dutch-only signals.
    Returns (is_dutch_only: bool, confidence: float, reason: str)
    """
    if not html:
        return (False, 0.0, "no_text_to_analyze")
    
    # Strip tags for text analysis
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text).strip()
    combined = f"{title} {description} {text}".lower()
    
    # First check for international-friendly signals (overrides Dutch-only)
    for pattern in INTERNATIONAL_PATTERNS:
        if re.search(pattern, combined):
            return (False, 0.0, f"international_friendly_text")
    
    # Check for strong Dutch-only signals
    for pattern in DUTCH_ONLY_PATTERNS:
        if re.search(pattern, combined):
            return (True, 0.85, f"dutch_only_text_match")
    
    return (False, 0.0, "no_signals_detected")


def check_listing(listing: dict) -> dict:
    """Check a single listing for Dutch-only requirements. Returns result dict."""
    listing_id = listing['id']
    url = listing.get('url', '')
    title = listing.get('title', '') or ''
    description = listing.get('description', '') or ''
    rent = listing.get('rent', 0)
    source = listing.get('source', '')
    address = listing.get('address', '') or ''
    
    result = {
        "id": listing_id,
        "url": url,
        "title": title[:80],
        "rent": rent,
        "address": address,
        "source": source,
        "dutch_only": False,
        "confidence": 0.0,
        "reason": "not_checked",
    }
    
    # Fetch the page
    html = fetch_page_text(url)
    
    if html is None:
        # Page couldn't be fetched (Marktplaats 410, etc.)
        # Flag with low confidence — let the cron agent try browser check
        result["dutch_only"] = False  # Don't exclude — might be fine
        result["confidence"] = 0.0
        result["reason"] = "page_unfetchable"
        return result
    
    # For Kamernet: check structured language data first (most reliable)
    if source == 'kamernet':
        api_result = check_kamernet_via_api(html)
        if api_result is not None:
            result["dutch_only"] = api_result[0]
            result["confidence"] = api_result[1]
            result["reason"] = api_result[2]
            return result
    
    # Fallback: text analysis for all sources
    text_result = check_text_for_dutch_only(html, title, description)
    result["dutch_only"] = text_result[0]
    result["confidence"] = text_result[1]
    result["reason"] = text_result[2]
    
    return result


def main():
    parser = argparse.ArgumentParser(description="Check listings for Dutch-only requirements")
    parser.add_argument('--db', default=DB_PATH, help='Path to housing.db')
    parser.add_argument('--max', type=int, default=MAX_CHECK, help='Max listings to check')
    parser.add_argument('--format', choices=['json', 'table'], default='table',
                       help='Output format')
    args = parser.parse_args()
    
    if not os.path.exists(args.db):
        print(f"❌ Database not found: {args.db}")
        sys.exit(1)
    
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get new listings
    cursor.execute("""
        SELECT id, title, url, source, address, rent, description
        FROM listings 
        WHERE status='new'
        ORDER BY rent ASC
        LIMIT ?
    """, (args.max,))
    
    listings = cursor.fetchall()
    if not listings:
        print("📭 No new listings to check.")
        return json.dumps({"checked": 0, "dutch_only_ids": [], "safe_ids": [], "unfetchable_ids": []})
    
    results = []
    stats = {"checked": 0, "dutch_only": 0, "safe": 0, "unfetchable": 0, "international": 0, "api_checked": 0}
    
    print(f"\n🔍 Checking {len(listings)} listings for Dutch-only requirements...\n")
    
    for i, l in enumerate(listings):
        listing = dict(l)
        rent = listing.get('rent', 0)
        title_short = (listing.get('title', '') or '')[:60]
        
        print(f"  [{i+1}/{len(listings)}] €{rent:.0f} — {title_short}...", end="", flush=True)
        
        result = check_listing(listing)
        results.append(result)
        stats["checked"] += 1
        
        if result["dutch_only"]:
            print(f" ❌ DUTCH-ONLY (conf={result['confidence']:.2f})")
            stats["dutch_only"] += 1
        elif result["reason"] == "page_unfetchable":
            print(f" ⚠️ unfetchable")
            stats["unfetchable"] += 1
        elif result["reason"].startswith("international"):
            print(f" ✅ International-friendly")
            stats["international"] += 1
        elif result["reason"].startswith("kamernet_"):
            print(f" ✅ Open ({result['reason']})")
            stats["api_checked"] += 1
        else:
            print(f" ✅ Safe")
            stats["safe"] += 1
        
        time.sleep(RATE_LIMIT_DELAY)
    
    print(f"\n{'='*50}")
    print(f"📊 Results: {stats['checked']} checked")
    print(f"   ❌ Dutch-only:      {stats['dutch_only']}")
    print(f"   ✅ International:   {stats['international']}")
    print(f"   ✅ Safe (API/text): {stats['api_checked'] + stats['safe']}")
    print(f"   ⚠️ Unfetchable:     {stats['unfetchable']}")
    print(f"{'='*50}\n")
    
    if args.format == 'table':
        for r in results:
            if r['dutch_only']:
                icon = "❌"
            elif r.get('reason') == 'page_unfetchable':
                icon = "⚠️"
            else:
                icon = "✅"
            print(f"  {icon} €{r['rent']:.0f} [{r['source']}] — {r['title'][:60]}")
            if r['dutch_only'] or r.get('reason') == 'page_unfetchable':
                print(f"     {r['reason'][:60]}")
            print()
    
    conn.close()
    
    # Output summary JSON for cron consumption
    output = {
        "checked": stats["checked"],
        "dutch_only": stats["dutch_only"],
        "safe": stats["safe"] + stats["international"] + stats["api_checked"],
        "unfetchable": stats["unfetchable"],
        "dutch_only_ids": [r["id"] for r in results if r["dutch_only"]],
        "dutch_only_listings": [r for r in results if r["dutch_only"]],
        "safe_listings": [r for r in results if not r["dutch_only"] and r["reason"] != "page_unfetchable"],
        "unfetchable_ids": [r["id"] for r in results if r.get("reason") == "page_unfetchable"],
        "all_results": results,
    }
    
    print("---JSON_OUTPUT---")
    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
