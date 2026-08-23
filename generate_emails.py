#!/usr/bin/env python3
"""
Housing Email Draft Generator
==============================
Queries the room-scraper SQLite database and generates personalized email drafts
for each listing — tailored to price, address, property type, and source platform.

⚠️ IMPORTANT: Edit the placeholders below (USER_NAME, USER_EMAIL, and the email
body content) before using this script. The defaults are example values.

Output: Markdown/text files in ./email-drafts/ and a summary printed to stdout.
Usage: python generate_emails.py [--db path/to/housing.db] [--max N] [--status new] [--source name] [--format markdown|text]
"""

import sqlite3
import os
import argparse
import re
from datetime import datetime, timezone

# --- Configuration ---
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "housing.db")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "email-drafts")
USER_NAME = "YourName"          # CHANGE THIS — replace with your first name
USER_EMAIL = "yourname@example.com"  # CHANGE THIS — replace with your email
MAX_EMAILS = 15

# Campus reference points
CAMPUS_AREAS = ["ut", "university of twente", "campus", "drienerlolaan", "enschede centraal",
                "centrum", "centraal station", "hbo", "saxion"]


def clean_title(raw_title):
    """Clean garbled titles where description was concatenated to the title."""
    if not raw_title:
        return "Unknown Listing"
    title = raw_title.strip()
    # If title is extremely long (description merged in), truncate intelligently
    if len(title) > 100:
        # Try to split at sentence boundaries
        for split_char in ['. ', ', ', ' - ', ' | ', ' – ']:
            idx = title.find(split_char)
            if 20 < idx < 80:
                title = title[:idx].strip()
                break
        else:
            # Still too long, truncate at word boundary
            if len(title) > 80:
                title = title[:77].rsplit(' ', 1)[0] + "..."
    # Remove common junk patterns
    title = re.sub(r'\b(Kamer|Studio|Huis|Appartement)\s+in\s+\w+\s+gevonden\s+voor\s+€[\d.,]+\s*pm\b', '', title, flags=re.IGNORECASE).strip()
    if not title:
        title = raw_title[:60]
    return title


def clean_subject_address(listing):
    """Extract a clean, short address for the subject line."""
    addr = listing.get('address') or ''
    title = listing.get('title', '')
    
    # If address is junk (like "ons"), extract from title
    if not addr or len(addr) < 3 or addr == 'ons':
        # Try to extract street name from title
        for source in ['title']:
            text = listing.get('title', '')
            # Look for patterns like "StreetName 123" or "Streetname"
            match = re.match(r'^([A-Z][a-z]+(?:\s+[A-Za-z]+){0,4})', text)
            if match:
                addr = match.group(1).rstrip(' -–')
                break
        if not addr or len(addr) < 3:
            addr = 'Enschede'
    
    # Clean: take just the street part
    short_addr = addr.split(',')[0].strip().split(' - ')[0].strip()
    # If address looks like a full sentence, take just first words
    words = short_addr.split()
    if len(words) > 6:
        short_addr = ' '.join(words[:4]) + "..."
    if len(short_addr) > 40:
        short_addr = short_addr[:37] + "..."
    
    return short_addr


def subject_line(listing):
    """Generate a subject line based on the listing."""
    rent = listing.get('rent', 0)
    rent_str = f"€{rent:.0f}" if rent > 0 else "listed price"
    addr = clean_subject_address(listing)
    return f"Interest in {addr} — {rent_str}"


def contact_guidance(source):
    """Return platform-specific guidance on how to contact the landlord."""
    guides = {
        'roomspot': "📌 **Via Roomspot**: Click the listing URL below, then use the 'Contact' or 'Reageer' button on the page. Roomspot lets you message the landlord directly through their platform.",
        'marktplaats': "📌 **Via Marktplaats**: Click the listing URL below, then use the 'Bericht sturen' or 'Reageer' button. You may need a Marktplaats account. ⚠️ Note: some Marktplaats listings redirect to huurwoningen.nl which requires a paid subscription.",
        'pararius': "📌 **Via Pararius**: Click the listing URL below. Pararius typically shows the rental agency's contact info — you may need to email or call them directly.",
        'xior': "📌 **Via Xior**: This is likely first-come-first-served. Click the URL and book/apply immediately. Xior uses their own reservation system — act fast.",
        'kamernet': "📌 **Via Kamernet**: Click the listing URL below and use the 'Stuur bericht' button. You need an active Kamernet subscription to contact landlords.",
    }
    return guides.get(source, f"📌 **Via {source}**: Click the listing URL below to view the listing and contact the landlord.")


def email_body(listing, output_format='markdown'):
    """Generate a personalized email body for the listing."""
    rent = listing.get('rent', 0)
    rent_str = f"€{rent:.0f} per month" if rent > 0 else "the listed price"
    addr = listing.get('address', '') or ''
    title = clean_title(listing.get('title', 'the room'))
    listing_type = listing.get('listing_type', 'room')
    source = listing.get('source', 'unknown')
    
    # Determine language based on source
    is_dutch_site = source in ('marktplaats', 'roomspot', 'pararius', 'kamernet')
    
    # Extract city from address
    city = "Enschede"
    combined_text = (addr + ' ' + title).lower()
    if 'enschede' in combined_text:
        city = "Enschede"
    elif 'gronau' in combined_text:
        city = "Gronau"
    elif 'hengelo' in combined_text:
        city = "Hengelo"
    
    if output_format == 'text':
        bold = lambda x: x.upper()
        sep = ""
    else:
        bold = lambda x: f"**{x}**"
        sep = ""
    
    # Build the body based on language
    if is_dutch_site:
        lines = [
            f"Beste verhuurder,",
            f"",
            f"Ik ben {USER_NAME}, een aankomend student aan de Universiteit Twente. Ik zag uw advertentie voor {title} in {city} en ben erg geïnteresseerd.",
            f"",
            f"{bold('Over mij:')}",
            f"- Start binnenkort met mijn studie aan de UT",
            f"- Verhuis naar Nederland voor mijn studie",
            f"- Rustig, netjes en verantwoordelijk",
            f"- Geen huisdieren, niet-roker",
            f"- Op zoek naar woonruimte voor langere tijd",
            f"",
            f"{bold('Waarom deze woning:')}",
            f"De locatie in {city} is perfect voor mijn studie aan de UT. De prijs van {rent_str} past binnen mijn budget.",
            f"",
            f"Ik zou graag meer informatie ontvangen en eventueel een bezichtiging plannen. Ik ben beschikbaar voor een online videogesprek of telefonisch contact.",
            f"",
            f"Met vriendelijke groet,",
            f"{USER_NAME}",
            f"{USER_EMAIL}",
        ]
    else:
        lines = [
            f"Dear landlord,",
            f"",
            f"My name is {USER_NAME}, an incoming student at the University of Twente. I came across your listing for {title} in {city} and I'm very interested.",
            f"",
            f"{bold('About me:')}",
            f"- Starting my degree at UT soon",
            f"- Moving to the Netherlands for my studies",
            f"- Quiet, tidy, and responsible",
            f"- No pets, non-smoker",
            f"- Looking for long-term accommodation",
            f"",
            f"{bold('Why this property:')}",
            f"The location in {city} is ideal for my studies at UT. The rent of {rent_str} fits within my budget.",
            f"",
            f"I would love to receive more information and possibly schedule a viewing. I'm available for an online video call or phone conversation.",
            f"",
            f"Best regards,",
            f"{USER_NAME}",
            f"{USER_EMAIL}",
        ]
    
    return "\n".join(lines)


def needs_manual_contact(source, url):
    """Check if this listing might need manual workarounds."""
    if source == 'marktplaats' and ('huurwoningen' in url.lower() or 'redirect' in url.lower()):
        return True
    return False


# --- Main ---

def get_listings(db_path, status='new', max_listings=15, source=None):
    """Query the database for listings."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    if source:
        query = """
            SELECT id, title, rent, url, source, address, listing_type, 
                   description, date_found, priority, phone
            FROM listings 
            WHERE status = ? AND source = ?
            ORDER BY 
                CASE WHEN priority = 'high' THEN 1 ELSE 2 END,
                rent ASC,
                date_found DESC
            LIMIT ?
        """
        cursor.execute(query, (status, source, max_listings))
    else:
        query = """
            SELECT id, title, rent, url, source, address, listing_type, 
                   description, date_found, priority, phone
            FROM listings 
            WHERE status = ? 
            ORDER BY 
                CASE WHEN priority = 'high' THEN 1 ELSE 2 END,
                rent ASC,
                date_found DESC
            LIMIT ?
        """
        cursor.execute(query, (status, max_listings))
    
    rows = cursor.fetchall()
    conn.close()
    return rows


def generate_email_draft(listing, output_format='markdown'):
    """Generate a complete email draft for a single listing."""
    rent = listing.get('rent', 0)
    # Fix floating point artifacts
    rent = round(rent, 2)
    rent_icon = "🔴" if rent > 0 and rent <= 500 else "🟡" if rent > 0 and rent <= 650 else "⚪"
    priority = listing.get('priority', 'normal')
    source = listing.get('source', 'unknown')
    title = clean_title(listing.get('title', 'Unknown'))
    address = listing.get('address', '') or ''
    if address == 'ons' or len(address) < 3:
        address = ''  # Skip showing junk addresses
    
    if output_format == 'text':
        lines = []
        lines.append(f"{'='*60}")
        lines.append(f"")
        lines.append(f"{rent_icon} {title}")
        lines.append(f"")
        lines.append(f"Rent:       €{rent:.0f}/month")
        if address:
            lines.append(f"Address:    {address}")
        if listing.get('listing_type'):
            lines.append(f"Type:       {listing['listing_type']}")
        lines.append(f"Source:     {source}")
        lines.append(f"Priority:   {priority}")
        lines.append(f"Found:      {listing['date_found'][:10] if listing.get('date_found') else 'N/A'}")
        lines.append(f"")
        lines.append(f"URL: {listing['url']}")
        lines.append(f"")
        lines.append(f"{contact_guidance(source)}")
        lines.append(f"")
        if needs_manual_contact(source, listing['url']):
            lines.append(f"WARNING: This listing may redirect to a subscription-only site (huurwoningen).")
            lines.append(f"")
        lines.append(f"--- EMAIL DRAFT ---")
        lines.append(f"")
        lines.append(f"To: [landlord email — fill in from listing]")
        lines.append(f"Subject: {subject_line(listing)}")
        lines.append(f"")
        lines.append(email_body(listing, output_format='text'))
        lines.append(f"")
        lines.append(f"--- QUICK ACTIONS ---")
        lines.append(f"[ ] Open listing: {listing['url']}")
        lines.append(f"[ ] Copy email draft above")
        lines.append(f"[ ] Find landlord's contact info on the listing page")
        lines.append(f"[ ] Paste and send")
        lines.append(f"")
        lines.append(f"{'='*60}")
        lines.append(f"")
        return "\n".join(lines)
    
    # Markdown format (default)
    lines = []
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## {rent_icon} {title}")
    lines.append(f"")
    lines.append(f"| | |")
    lines.append(f"|---|---|")
    lines.append(f"| **Rent** | €{rent:.0f}/month |")
    if address:
        lines.append(f"| **Address** | {address} |")
    if listing.get('listing_type'):
        lines.append(f"| **Type** | {listing['listing_type']} |")
    lines.append(f"| **Source** | {source} |")
    lines.append(f"| **Priority** | {priority} |")
    if listing.get('date_found'):
        lines.append(f"| **Found** | {listing['date_found'][:10]} |")
    lines.append(f"")
    lines.append(f"**🔗 Listing URL:** {listing['url']}")
    lines.append(f"")
    
    # Contact guidance
    lines.append(f"{contact_guidance(source)}")
    lines.append(f"")
    
    # Warning for paywalled listings
    if needs_manual_contact(source, listing['url']):
        lines.append(f"⚠️ **WARNING:** This listing may redirect to a subscription-only site (huurwoningen). You may need to find the landlord's contact info manually.")
        lines.append(f"")
    
    lines.append(f"### 📧 Email Draft")
    lines.append(f"")
    lines.append(f"**To:** [landlord email — fill in from listing]")
    lines.append(f"**Subject:** {subject_line(listing)}")
    lines.append(f"")
    lines.append(f"```")
    lines.append(email_body(listing))
    lines.append(f"```")
    lines.append(f"")
    lines.append(f"### ⚡ Quick Actions")
    lines.append(f"- [ ] Open listing: {listing['url']}")
    lines.append(f"- [ ] Copy email draft above")
    lines.append(f"- [ ] Find landlord's contact info on the listing page")
    lines.append(f"- [ ] Paste and send")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    
    return "\n".join(lines)


def clean_url(url):
    """Strip tracking params from stored URLs."""
    if not url:
        return url
    # Remove common tracking parameters
    url = re.sub(r'[?&]c=[^&]+', '', url)
    url = re.sub(r'[?&]casData=[^&]+', '', url)
    url = re.sub(r'[?&]utm_[^&]+=[^&]+', '', url)
    url = re.sub(r'[?&]ref=[^&]+', '', url)
    # Clean up trailing ? or &
    url = re.sub(r'\?$', '', url)
    url = re.sub(r'&$', '', url)
    return url


def main():
    parser = argparse.ArgumentParser(description="Generate personalized housing email drafts")
    parser.add_argument('--db', default=DB_PATH, help='Path to housing.db')
    parser.add_argument('--max', type=int, default=MAX_EMAILS, help='Max listings to process')
    parser.add_argument('--status', default='new', help='Filter by status (new, applied, etc.)')
    parser.add_argument('--source', help='Filter by source (roomspot, marktplaats, etc.)')
    parser.add_argument('--format', default='markdown', choices=['markdown', 'text'],
                        help='Output format: markdown (default) or text')
    args = parser.parse_args()
    
    if not os.path.exists(args.db):
        print(f"❌ Database not found: {args.db}")
        return 1
    
    listings = get_listings(args.db, status=args.status, max_listings=args.max, source=args.source)
    
    if not listings:
        print(f"📭 No listings with status '{args.status}' found.")
        return 0
    
    # Stats
    sources = {}
    high_count = 0
    total_rent = 0
    priced_count = 0
    
    for l in listings:
        src = l['source']
        sources[src] = sources.get(src, 0) + 1
        if l['priority'] == 'high':
            high_count += 1
        rent = l['rent']
        if rent > 0:
            total_rent += rent
            priced_count += 1
    
    avg_rent = total_rent / priced_count if priced_count > 0 else 0
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Generate combined draft file
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    ext = "md" if args.format == 'markdown' else "txt"
    output_file = os.path.join(OUTPUT_DIR, f"housing-emails-{timestamp}.{ext}")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(f"# 🏠 Housing Email Drafts — {datetime.now().strftime('%A, %B %d %Y')}")
        f.write(f"\n\n")
        f.write(f"**Summary:** {len(listings)} listings | 🔴 {high_count} high priority | Average rent: €{avg_rent:.0f}/month")
        f.write(f"\n")
        f.write(f"**Sources:** {', '.join(f'{v}x {k}' for k, v in sorted(sources.items()))}")
        f.write(f"\n\n---\n\n")
        
        for listing in listings:
            f.write(generate_email_draft(dict(listing), output_format=args.format))
    
    # Also generate individual files (markdown only for individual)
    for listing in listings:
        safe_title = re.sub(r'[^a-zA-Z0-9]+', '-', listing['title'][:50]).strip('-') or 'listing'
        safe_id = re.sub(r'[^a-zA-Z0-9]+', '-', listing['id'])[:40].strip('-')
        indiv_file = os.path.join(OUTPUT_DIR, f"{safe_title}-{safe_id}.{ext}")
        with open(indiv_file, 'w', encoding='utf-8') as f:
            f.write(generate_email_draft(dict(listing), output_format=args.format))
    
    # Print summary
    print(f"\n{'='*60}")
    print(f"📧 HOUSING EMAIL DRAFTS GENERATED")
    print(f"{'='*60}")
    print(f"Date: {datetime.now().strftime('%A, %B %d %Y')}")
    print(f"Format: {args.format}")
    print(f"Total listings: {len(listings)}")
    print(f"🔴 High priority: {high_count} (under €500)")
    print(f"Average rent: €{avg_rent:.0f}/month")
    print(f"Sources: {', '.join(f'{v}x {k}' for k, v in sorted(sources.items()))}")
    print(f"")
    print(f"📄 Combined file: {output_file}")
    print(f"📁 Individual drafts: {OUTPUT_DIR}/")
    print(f"{'='*60}\n")
    
    # Print each listing summary
    for i, listing in enumerate(listings, 1):
        rent = listing['rent']
        rent = round(rent, 2)
        icon = "🔴" if rent > 0 and rent <= 500 else "🟡"
        short_title = clean_title(listing['title'])[:60]
        print(f"  {i:2d}. {icon} €{rent:.0f} — {short_title}")
        print(f"      {listing['url'][:120]}")
        print()
    
    return 0

if __name__ == '__main__':
    exit(main())