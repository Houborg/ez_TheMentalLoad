import DOMPurify from 'dompurify';

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'a', 'ul', 'ol', 'li', 'span', 'div'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
  FORBID_ATTR: ['style', 'class'],
};

export function looksLikeHtml(s: string): boolean {
  return /<\s*(p|br|div|span|strong|em|ul|ol|li|a)\b/i.test(s);
}

export function cleanAulaHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG).trim();
}

/** Plain-text excerpt — strips all tags, collapses whitespace, truncates. */
export function htmlExcerpt(html: string, maxLen = 80): string {
  if (!html) return '';
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}
