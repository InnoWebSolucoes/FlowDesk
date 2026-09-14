import React from 'react'

/**
 * Plain text with its web addresses turned into links.
 *
 * Messages, descriptions and log entries are stored as plain text, so a link
 * pasted into one arrived as characters that looked like a link and did
 * nothing when tapped. This finds them at render time rather than storing
 * HTML: nothing typed can inject markup, because everything that is not an
 * address is still rendered as text.
 *
 * Matches http(s):// addresses and bare www. ones. Punctuation that ends a
 * sentence (a full stop, a closing bracket without an opening one) is left
 * outside the link, so "see https://x.com." does not link to "x.com.".
 */
const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi

function splitTrailing(url: string): [string, string] {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1]
    if ('.,;:!?\'"'.includes(ch)) {
      end--
      continue
    }
    // A closing bracket belongs to the link only if the link opened one.
    if (ch === ')' && (url.slice(0, end).match(/\(/g)?.length ?? 0) < (url.slice(0, end).match(/\)/g)?.length ?? 0)) {
      end--
      continue
    }
    break
  }
  return [url.slice(0, end), url.slice(end)]
}

export function Linkify({ text, linkClassName }: { text: string; linkClassName?: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  URL_PATTERN.lastIndex = 0

  while ((match = URL_PATTERN.exec(text)) !== null) {
    const [url, trailing] = splitTrailing(match[0])
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (url) {
      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
      parts.push(
        <a
          key={`${match.index}-${url}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          // Inside chat bubbles and cards that open on click: following the
          // link should not also open or select whatever it sits in.
          onClick={(e) => e.stopPropagation()}
          className={linkClassName ?? 'text-primary underline underline-offset-2 break-all hover:opacity-80'}
        >
          {url}
        </a>,
      )
    }
    if (trailing) parts.push(trailing)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))

  return <>{parts}</>
}
