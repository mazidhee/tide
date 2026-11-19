import { WEB_SITES, type WebCredit } from '@shared/compWeb'
import { openUrl } from '../../lib/linkNav'
import { Icon } from '../Icon'
import { SITE_LOGO } from './sites'

/**
 * Where a web passage came from, shown with it wherever it appears: the site (its own mark), the
 * work and its authors, the licence, whether it is an excerpt, and that it is quoted exactly. The
 * title and the licence open in Tide's browser.
 */

/** A site's own mark: Wikipedia's and arXiv's drawn in their colour (so they show on every theme), Gutenberg's as it is */
export function SiteMark({ site }: { site: WebCredit['site'] }) {
  return <span className={`cp-mark s-${site}`} style={{ ['--src' as string]: `url("${SITE_LOGO[site]}")` }} aria-hidden="true" />
}

const day = (at: number) =>
  new Date(at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })

export function Credit({ web, className }: { web: WebCredit; className?: string }) {
  const site = WEB_SITES[web.site]
  const open = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    openUrl(url)
  }
  const title = web.site === 'gutenberg' ? <i>{web.title}</i> : <>‘{web.title}’</>
  return (
    <p className={`cp-credit${className ? ` ${className}` : ''}`}>
      <span className="cp-credit-src">
        <SiteMark site={web.site} />
        <span>
          {web.site === 'arxiv' ? 'The abstract of ' : web.site === 'wikipedia' ? 'From the Wikipedia article ' : 'From '}
          <a href={web.url} onClick={open(web.url)} title={`Open ${web.url}`}>
            {title}
          </a>
          {web.author ? `, ${web.author}` : ''}
          {web.site === 'gutenberg' ? ', Project Gutenberg' : web.site === 'arxiv' ? `, arXiv ${web.revision ?? ''}` : ''}
        </span>
      </span>
      <span className="cp-credit-terms">
        {web.licenceUrl ? (
          <a href={web.licenceUrl} onClick={open(web.licenceUrl)} title={`${site.name}’s terms`}>
            {web.licence}
          </a>
        ) : (
          <span>{web.licence}</span>
        )}
        <span className="cp-credit-sep" aria-hidden="true">
          ·
        </span>
        <span
          className="cp-credit-exact"
          title={`Fetched ${day(web.fetchedAt)}${web.site === 'wikipedia' && web.revision ? `, revision ${web.revision}` : ''}. Every word checked against the page; nothing reworded.`}
        >
          <Icon name="check" size={11} />
          {web.excerpt ? 'Excerpt, quoted exactly' : 'Quoted exactly'}
        </span>
      </span>
    </p>
  )
}
