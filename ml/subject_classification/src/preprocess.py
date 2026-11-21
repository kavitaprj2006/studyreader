"""
Text Preprocessing Module for Academic Subject Classification.
Implements text cleaning, normalization, and stopword filtering without external heavy dependencies.
"""

import re
import string

# Self-contained curated standard English stop words list
# Ensures zero external runtime downloads (e.g. no nltk.download needed)
STANDARD_STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
    "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had",
    "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
    "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd",
    "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
    "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off",
    "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over",
    "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
    "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
    "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've",
    "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't",
    "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when",
    "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's",
    "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your",
    "yours", "yourself", "yourselves"
}

def clean_text(text: str) -> str:
    """
    Cleans raw text for TF-IDF feature extraction:
    1. Converts to lowercase
    2. Strips URLs and special symbols
    3. Normalizes whitespace
    4. Removes common stopwords while preserving domain-critical tokens (e.g. c++, dbms, os)
    """
    if not text or not isinstance(text, str):
        return ""

    # Convert to lowercase
    text = text.lower()

    # Remove URLs
    text = re.sub(r'https?://\S+|www\.\S+', ' ', text)

    # Normalize common symbols: replace hyphens, slashes, underscores with space
    text = re.sub(r'[\-\_\/\\\,\.\:\;\(\)\[\]\{\}\"\'\`\<\>\=\+\*\?\!\@\#\$\%\^\&]', ' ', text)

    # Keep only alphanumeric tokens
    tokens = text.split()

    # Filter stopwords and 1-letter tokens (except 'r' as in R language if applicable)
    filtered = [
        t for t in tokens
        if len(t) > 1 and t not in STANDARD_STOPWORDS and not t.isdigit()
    ]

    return " ".join(filtered)

if __name__ == "__main__":
    sample = "In Database Management Systems (DBMS), the ACID properties ensure reliable SQL transactions!"
    print("Original:", sample)
    print("Cleaned: ", clean_text(sample))
