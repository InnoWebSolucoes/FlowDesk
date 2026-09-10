import React, { useEffect, useState } from 'react'
import { faviconSources, faviconLetter } from '../../lib/favicon'

/**
 * A site's icon, trying each source in turn and falling back to a letter.
 *
 * The two places that draw these had the same img with the same onError
 * hiding it and revealing a sibling span — which meant one source, one
 * chance, and a hidden element that had to sit in exactly the right place in
 * the markup. Walking a list needs state, so it needs to be a component.
 */
export function Favicon({
  url,
  name,
  className = '',
  letterClassName = '',
}: {
  url: string
  /** For the letter tile, when the site has no icon anywhere. */
  name?: string
  className?: string
  letterClassName?: string
}) {
  const sources = faviconSources(url)
  const [index, setIndex] = useState(0)

  // A changed address starts the search again, or the tile would keep showing
  // the old site's icon until the page was reloaded.
  useEffect(() => setIndex(0), [url])

  if (index >= sources.length) {
    return <span className={letterClassName}>{faviconLetter(name || url)}</span>
  }

  return (
    <img
      src={sources[index]}
      alt=""
      loading="lazy"
      onError={() => setIndex((i) => i + 1)}
      className={className}
    />
  )
}
