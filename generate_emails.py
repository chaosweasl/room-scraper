#!/usr/bin/env python3
"""
Housing Email Draft Generator
==============================
Queries the room-scraper SQLite database and generates personalized email drafts
for each listing — tailored to price, address, property type, and source platform.

⚠️ IMPORTANT: Edit the placeholders below (USER_NAME, USER_EMAIL, and the email
body content) before using this script. The defaults are example values.

Output: Markdown files in ./email-drafts/ and a summary printed to stdout.
Usage: python generate_emails.py [--db path/to/housing.db] [--max N] [--status new]
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

# --- Email Templates ---

def subject_line(listing):
    """Generate a subject line based on the listing."""
    rent_str = f"€{listing['rent']:.0f}" if listing['rent'] > 0 else "listed price"
    addr = listing.get('address', 'Enschede') or listing.get('title', 'the property')
    # Clean address — take just the street part
    short_addr = addr.split(',')[0].strip().split('-')[0].strip()
    if len(short_addr) > 40:
        short_addr = short_addr[:37] + "..."
    return f"Interest in {short_addr} — {rent_str}"

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

def email_body(listing):
    """Generate a personalized email body for the listing."""
    rent = listing['rent']
    rent_str = f"€{rent:.0f} per month" if rent > 0 else "the listed price"
    addr = listing.get('address', '') or ''
    title = listing.get('title', 'the room')
    listing_type = listing.get('listing_type', 'room')
    description = listing.get('description', '') or ''
    source = listing.get('source', 'unknown')
    
    # Determine language based on source
    is_dutch_site = source in ('marktplaats', 'roomspot', 'pararius', 'kamernet')
    
    # Extract city from address
    city = "Enschede"
    if 'enschede' in (addr + title).lower():
        city = "Enschede"
    elif 'gronau' in (addr + title).lower():
        city = "Gronau"
    
    # Build the body based on language
    if is_dutch_site:
        body = f"""Beste verhuurder,

Ik ben {USER_NAME}, een aankomend student aan de Universiteit Twente. Ik zag uw advertentie voor {title} op {city} en ben erg geïnteresseerd.

**Over mij:**
- Start binnenkort met mijn studie aan de UT
- Verhuis naar Nederland voor mijn studie
- Rustig, netjes en verantwoordelijk
- Geen huisdieren, niet-roker
- Op zoek naar woonruimte voor langere tijd

**Waarom deze kamer/studio:**
De locatie in {city} is perfect voor mijn studie aan de UT. De prijs van {rent_str} past binnen mijn budget.

Ik zou graag meer informatie ontvangen en eventueel een bezichtiging plannen. Ik ben beschikbaar voor een online videogesprek of telefonisch contact.

Met vriendelijke groet,
{USER_NAME}
{USER_EMAIL}"""
    else:
        body = f"""Dear landlord,

My name is {USER_NAME}, an incoming student at the University of Twente. I came across your listing for {title} in {city} and I'm very interested.

**About me:**
- Starting my degree at UT soon
- Moving to the Netherlands for my studies
- Quiet, tidy, and responsible
- No pets, non-smoker
- Looking for long-term accommodation

**Why this room/studio:**
The location in {city} is ideal for my studies at UT. The rent of {rent_str} fits within my budget.

I would love to receive more information and possibly schedule a viewing. I'm available for an online video call or phone conversation.

Best regards,
{USER_NAME}
{USER_EMAIL}"""
    
    return body.strip()

def needs_manual_contact(source, url):
    """Check if this listing might need manual workarounds."""
    if source == 'marktplaats' and ('huurwoningen' in url.lower() or 'redirect' in url.lower()):
        return True
    return False

# --- Main ---

def get_listings(db_path, status='new', max_listings=15):
    """Query the database for listings."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
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

def generate_email_draft(listing):
    """Generate a complete email draft markdown for a single listing."""
    rent = listing['rent']
    rent_icon = "🔴" if rent > 0 and rent <= 500 else "🟡" if rent > 0 and rent <= 650 else "⚪"
    priority = listing.get('priority', 'normal')
    source = listing['source']
    
    lines = []
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## {rent_icon} {listing['title']}")
    lines.append(f"")
    lines.append(f"| | |")
    lines.append(f"|---|---|")
    lines.append(f"| **Rent** | €{rent:.0f}/month |")
    if listing.get('address'):
        lines.append(f"| **Address** | {listing['address']} |")
    if listing.get('listing_type'):
        lines.append(f"| **Type** | {listing['listing_type']} |")
    lines.append(f"| **Source** | {source} |")
    lines.append(f"| **Priority** | {priority} |")
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

def main():
    parser = argparse.ArgumentParser(description="Generate personalized housing email drafts")
    parser.add_argument('--db', default=DB_PATH, help='Path to housing.db')
    parser.add_argument('--max', type=int, default=MAX_EMAILS, help='Max listings to process')
    parser.add_argument('--status', default='new', help='Filter by status (new, applied, etc.)')
    parser.add_argument('--source', help='Filter by source (roomspot, marktplaats, etc.)')
    args = parser.parse_args()
    
    if not os.path.exists(args.db):
        print(f"❌ Database not found: {args.db}")
        return 1
    
    listings = get_listings(args.db, status=args.status, max_listings=args.max)
    
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
        if l['rent'] > 0:
            total_rent += l['rent']
            priced_count += 1
    
    avg_rent = total_rent / priced_count if priced_count > 0 else 0
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Generate combined draft file
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    output_file = os.path.join(OUTPUT_DIR, f"housing-emails-{timestamp}.md")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(f"# 🏠 Housing Email Drafts — {datetime.now().strftime('%A, %B %d %Y')}")
        f.write(f"\n\n")
        f.write(f"**Summary:** {len(listings)} listings | 🔴 {high_count} high priority | Average rent: €{avg_rent:.0f}/month")
        f.write(f"\n")
        f.write(f"**Sources:** {', '.join(f'{v}x {k}' for k, v in sorted(sources.items()))}")
        f.write(f"\n\n---\n\n")
        
        for listing in listings:
            f.write(generate_email_draft(dict(listing)))
    
    # Also generate individual files
    for listing in listings:
        safe_title = re.sub(r'[^a-zA-Z0-9]+', '-', listing['title'][:50]).strip('-')
        indiv_file = os.path.join(OUTPUT_DIR, f"{safe_title}.md")
        with open(indiv_file, 'w', encoding='utf-8') as f:
            f.write(generate_email_draft(dict(listing)))
    
    # Print summary
    print(f"\n{'='*60}")
    print(f"📧 HOUSING EMAIL DRAFTS GENERATED")
    print(f"{'='*60}")
    print(f"Date: {datetime.now().strftime('%A, %B %d %Y')}")
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
        icon = "🔴" if rent > 0 and rent <= 500 else "🟡"
        short_title = listing['title'][:60]
        print(f"  {i:2d}. {icon} €{rent:.0f} — {short_title}")
        print(f"      {listing['url']}")
        print()
    
    return 0

if __name__ == '__main__':
    exit(main())
