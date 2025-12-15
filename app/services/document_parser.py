"""
Document parsing utilities - extract due dates and amounts from text.
Separated from models for single responsibility principle.
"""
import re


def extract_due_date(text: str | None) -> str | None:
    """Best-effort parse of due date from invoice text."""
    if not text:
        return None
    
    # Common date formats: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD
    date_regex = r"(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})"
    
    # Keywords in English, German, French
    keywords = [
        r"Due\s*date", r"Due\s*by", r"Payable\s*by", r"Payment\s*due",  # English
        r"Fällig\s*am", r"Bezahlbar\s*bis", r"Zahlbar\s*bis", r"Fälligkeitsdatum",  # German
        r"Echéance", r"Payable\s*le"  # French
    ]
    
    # Construct pattern: (?:Due date|Payable by)[:\s]*(date_regex)
    pattern = f"(?:{'|'.join(keywords)})[:\s]*{date_regex}"
    
    match = re.search(pattern, text, re.IGNORECASE)
    if match:
        return match.group(1)
        
    return None


def extract_amount(text: str | None) -> str | None:
    """Extract total amount from invoice text."""
    if not text:
        return None
        
    # Match currency amounts: 123.45 or 123,45 or 1,234.56 or 1.234,56
    amount_regex = r"(\d{1,3}(?:[.,']\d{3})*[.,]\d{2})"
    
    # Keywords in multiple languages
    keywords = [
        r"Total", r"Amount\s*Due", r"Grand\s*Total", r"Balance\s*Due", r"Invoice\s*Total",  # English
        r"Gesamtbetrag", r"Endbetrag", r"Betrag", r"Summe", r"Rechnungsbetrag",  # German
        r"Total\s*TTC", r"Montant"  # French
    ]
    
    pattern = f"(?:{'|'.join(keywords)})[^0-9\n]*{amount_regex}"
    
    match = re.search(pattern, text, re.IGNORECASE)
    if match:
        return match.group(1)
        
    # Fallback: Return last amount found (often total is at bottom)
    matches = re.findall(amount_regex, text)
    if matches:
        return matches[-1]
        
    return None


def derive_paid_status(text: str | None, status: str) -> str:
    """Derive payment status from text and document status."""
    if text:
        lower = text.lower()
        if "bezahlt" in lower or "paid" in lower:
            return "Paid"
    if status == "processed":
        return "Unpaid"
    return "Pending"
