import { useState } from 'react'
import { posterUrl } from '../lib/tmdb'

const SIZES = {
  xs: { w: 'w-10', img: 'w92' },
  sm: { w: 'w-12', img: 'w92' },
  md: { w: 'w-16', img: 'w185' },
  lg: { w: 'w-32', img: 'w342' },
  fill: { w: 'w-full', img: 'w342' },
} as const

/** 2:3 poster with a quiet placeholder when there's no image (or it fails to load offline). */
export function Poster({ path, name, size = 'sm' }: { path: string | null | undefined; name: string; size?: keyof typeof SIZES }) {
  const [failed, setFailed] = useState(false)
  const { w, img } = SIZES[size]
  const src = posterUrl(path, img)
  return (
    <div className={`${w} aspect-[2/3] shrink-0 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800`}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          // CORS request, so the offline cache stores the real image size (see vite.config.ts).
          crossOrigin="anonymous"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] leading-tight text-neutral-400">
          {size === 'xs' || size === 'sm' ? name.slice(0, 1) : name}
        </div>
      )}
    </div>
  )
}
